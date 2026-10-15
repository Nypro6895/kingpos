import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { prepareCommentRequest, completeCommentRequest } from "../lib/comment-request.ts";
import { withRequestTimeout } from "../lib/request-timeout.ts";

const post = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const request = "33333333-3333-4333-8333-333333333333";
function loadIdentityModule(path, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, require: name => dependencies[name] });
  return exports;
}
const userDisplay = loadIdentityModule("lib/deleted-user-display.ts");
const commentIdentity = loadIdentityModule("lib/comment-identity.ts", { "@/lib/deleted-user-display": userDisplay });
function serverHarness() {
  const rows = new Map();
  let filters = {};
  const client = {
    rpc: async name => ({ data: name === "get_public_salon_profile" ? [{salon_name:"King Nails"}] : name === "get_public_post_comments" ? [...rows.values()] : rows.size, error: null }),
    from() {
      filters = {};
      let changes = null;
      return {
        update(payload) { changes = payload; return this; },
        async single() {
          const row = rows.get(filters.id);
          if (row && changes) Object.assign(row, changes);
          return { data: row ?? null, error: null };
        },
        insert(payload) {
          return { select: () => ({ single: async () => {
            if (rows.has(payload.id)) return { error: { code: "23505" }, data: null };
            const row = { ...payload, created_at: "2026-09-24", updated_at: "2026-09-24" };
            rows.set(payload.id, row);
            return { data: row, error: null };
          } }) };
        },
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        async maybeSingle() {
          const row = rows.get(filters.id);
          return { data: row && (!filters.author_user_id || row.author_user_id === filters.author_user_id) ? row : null, error: null };
        },
      };
    },
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync("lib/post-comments.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, console, require(name) {
    if (name.includes("abuse-server")) return { assertAbuseRequest: async () => {} };
    if (name.includes("supabase/server")) return { createAuthenticatedSupabaseServerClient: async () => client, createSupabaseServerClient: () => client };
    if (name.includes("current-user")) return { getCurrentKingUser: async () => ({ id: user, display_name: "Test" }) };
    if (name.includes("deleted-user-display")) return userDisplay;
    if (name.includes("comment-identity")) return commentIdentity;
    if (name.includes("types/post-comments")) return { POST_COMMENT_TARGET_TYPES: ["beauty_post"] };
    return {};
  } });
  return { create: exports.createPostComment, update: exports.updatePostComment, load: exports.loadPostCommentsPage, rows };
}
const input = { requestId: request, body: "Test", target: { sourceType: "beauty_post", sourceId: post } };

test("retrying a committed comment returns the existing row without another insert", async () => {
  const h = serverHarness();
  const first = await h.create(input);
  const retry = await h.create(input);
  assert.equal(first.comment.authorDisplayName, "Test");
  assert.equal(retry.comment.authorDisplayName, "Test");
  assert.equal(first.comment.id, retry.comment.id);
  assert.equal(retry.totalCount, 1);
  assert.equal(h.rows.size, 1);
});
test("create, load and edit preserve personal identity using the real resolver", async () => {
  const h = serverHarness();
  const created = await h.create(input);
  const loaded = await h.load({target:input.target});
  const edited = await h.update({commentId:created.comment.id,body:"Edited",target:input.target});
  assert.equal(created.comment.authorDisplayName,"Test");
  assert.equal(loaded.items[0].authorDisplayName,"Test");
  assert.equal(edited.comment.authorDisplayName,"Test");
});
test("official replies consistently stand behind the salon instead of the actor", async () => {
  const h = serverHarness();
  const target = {...input.target,salonId:post};
  const created = await h.create({...input,target,asSalonReply:true});
  const loaded = await h.load({target});
  const edited = await h.update({commentId:created.comment.id,body:"Edited",target});
  for (const comment of [created.comment,loaded.items[0],edited.comment]) {
    assert.equal(comment.authorDisplayName,"King Nails");
    assert.equal(comment.authorUserId,user);
    assert.equal(comment.isSalonReply,true);
  }
});
test("a reused request ID cannot submit a different body or target", async () => {
  const h = serverHarness();
  await h.create(input);
  await assert.rejects(h.create({ ...input, body: "Changed" }), /already been used/);
  await assert.rejects(h.create({ ...input, target: { ...input.target, sourceId: user } }), /already been used/);
  assert.equal(h.rows.size, 1);
});
test("a duplicate ID owned by another user is never returned", async () => {
  const h = serverHarness();
  await h.create(input);
  h.rows.get(request).author_user_id = post;
  await assert.rejects(h.create(input), /already been used/);
});
test("invalid request IDs fail before writing", async () => {
  const h = serverHarness();
  await assert.rejects(h.create({ ...input, requestId: "invalid" }), /not valid/);
  assert.equal(h.rows.size, 0);
});
test("blocked storage still preserves retry identity, and success permits a new comment", () => {
  const storage = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  const payload = { body: "Draft", parentCommentId: null, asSalonReply: false };
  const a = prepareCommentRequest("storage-test", payload, storage, randomUUID);
  assert.equal(prepareCommentRequest("storage-test", payload, storage, randomUUID).id, a.id);
  assert.notEqual(prepareCommentRequest("another-user", payload, storage, randomUUID).id, a.id);
  completeCommentRequest(a.key, storage);
  assert.notEqual(prepareCommentRequest("storage-test", payload, storage, randomUUID).id, a.id);
});
test("a stalled request times out and a late rejection is handled", async () => {
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  await assert.rejects(withRequestTimeout(pending, 5), /took too long/);
  reject(Error("late network failure"));
  await new Promise(resolve => setTimeout(resolve, 5));
});

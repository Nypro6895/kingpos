import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { prepareCommentRequest, completeCommentRequest } from "../lib/comment-request.ts";
import { withRequestTimeout } from "../lib/request-timeout.ts";

function commentHarness(create, load = async () => ({ items: [], totalCount: 0, hasMore: false, nextOffset: null, error: null })) {
  const states = [], refs = [], pending = [], effects = [];
  const timers = new Map();
  let si = 0, ri = 0, ei = 0, timerId = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync("app/post-comments/post-comment-thread.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    crypto: { randomUUID },
    URLSearchParams,
    document: { visibilityState: "visible", getElementById: () => null },
    window: { sessionStorage: null, location: { search: "" }, addEventListener() {}, removeEventListener() {},
      setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
      clearTimeout(id) { timers.delete(id); } },
    require(name) {
      if (name === "@/lib/comment-request") return { prepareCommentRequest, completeCommentRequest };
      if (name === "@/lib/request-timeout") return { withRequestTimeout };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "react") return {
        createElement: (type, props, ...children) => ({ type, props: { ...props, ...(children.length ? { children } : {}) } }),
        useState(initial) {
          const index = si++;
          if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
          return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
        },
        useRef(initial) { return refs[ri++] ??= { current: initial }; },
        useEffect(callback) { effects[ei++] ??= callback; }, useMemo: callback => callback(),
        useTransition: () => [false, callback => pending.push(callback())],
      };
      if (name === "next/navigation") return { useRouter: () => ({ refresh() {} }) };
      if (name.includes("post-comments/actions")) return { createPostCommentAction: create, loadPostCommentsAction: load };
      if (name.includes("supabase/browser")) return { createSupabaseBrowserClient: () => null };
      throw new Error(name);
    },
  });
  const props = {
    target: { sourceId: "post", sourceType: "beauty_post" },
    viewer: { isAuthenticated: true, userId: "user", canReplyAsSalon: false, canModerate: false },
  };
  function render() {
    si = ri = ei = 0;
    const outer = exports.PostCommentThread(props);
    return outer.type(outer.props);
  }
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  }
  const find = type => nodes(render()).find(node => node.type === type).props;
  return {
    mount: () => { render(); effects.forEach(callback => callback()); },
    flushTimers: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); },
    commentBodies: () => nodes(render()).filter(node => node.props?.comment).map(node => node.props.comment.body),
    write: value => find("textarea").onChange({ currentTarget: { value } }),
    submit: () => find("form").onSubmit({ preventDefault() {} }),
    body: () => find("textarea").value,
    status: () => nodes(render()).find(node => node.props?.["aria-live"] === "polite").props.children,
    settle: () => Promise.all(pending),
  };
}

test("comment transport failure restores draft and allows a later explicit retry", async () => {
  let calls = 0;
  const ui = commentHarness(async () => { calls++; throw new TypeError("Failed to fetch"); });
  ui.write("audit draft"); ui.submit();
  assert.equal(ui.body(), "");
  await ui.settle();
  assert.equal(ui.body(), "audit draft");
  assert.match(ui.status(), /Refresh to check/);
  ui.submit(); await ui.settle();
  assert.equal(calls, 2);
});

test("a stale comment load cannot overwrite a successful send", async () => {
  let finishLoad;
  const posted = { id: "saved", body: "New comment", targetId: "post", targetType: "beauty_post", createdAt: "2026-09-24", parentCommentId: null };
  const ui = commentHarness(async () => ({ error: null, comment: posted, totalCount: 1 }),
    () => new Promise(resolve => { finishLoad = resolve; }));
  ui.mount();
  ui.write("New comment"); ui.submit();
  await new Promise(resolve => setTimeout(resolve, 0));
  finishLoad({ items: [], totalCount: 0, hasMore: false, nextOffset: null, error: null });
  await ui.settle();
  assert.deepEqual(ui.commentBodies(), ["New comment"]);
});

test("a second submit while a comment is pending does not create a duplicate", async () => {
  let calls = 0, complete;
  const ui = commentHarness(() => {
    calls++;
    return new Promise(resolve => { complete = resolve; });
  });
  ui.write("first"); ui.submit();
  ui.write("second"); ui.submit();
  assert.equal(calls, 1);
  complete({ error: "Rejected" });
  await ui.settle();
  assert.equal(ui.body(), "second", "a rejected earlier send must preserve the newer draft");
});

test("explicit retry after a lost response reuses the same request ID", async () => {
  const ids = [];
  const ui = commentHarness(async input => { ids.push(input.requestId); throw new TypeError("offline"); });
  ui.write("idempotent draft"); ui.submit(); await ui.settle();
  ui.submit(); await ui.settle();
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.match(ids[0], /^[0-9a-f-]{36}$/);
});

test("mixed feeds preserve personal post counts while enriching salon counts", async () => {
  const exports = {};
  const source = readFileSync("lib/explore-feed.ts", "utf8") + "\nexport { attachFeedCommentCounts };";
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require(name) {
      if (name === "@/lib/post-comments") return {
        getPostCommentCounts: async () => new Map([["salon", 5]]),
        getPostCommentCount: (counts, target) => counts.get(target.sourceId) ?? 0,
      };
      return {};
    },
  });
  const items = await exports.attachFeedCommentCounts([
    { sourceType: "personal", caption: "Personal", commentCount: 3, saveTarget: { sourceId: "personal", sourceType: "beauty_post" } },
    { sourceType: "salon", caption: "Salon", commentCount: 0, saveTarget: { sourceId: "salon", sourceType: "salon_profile_look" } },
  ]);
  assert.equal(items[0].commentCount, 3);
  assert.equal(items[1].commentCount, 5);
});

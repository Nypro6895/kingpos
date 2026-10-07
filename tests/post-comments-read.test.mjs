import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function moduleAt(path, globals) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, ...globals });
  return exports;
}

test("comment reader uses an independent uncached request with same-origin credentials", async () => {
  let request;
  const page = { items: [], totalCount: 0, hasMore: false, nextOffset: null, error: null };
  const api = moduleAt("lib/post-comments-client.ts", {
    URLSearchParams, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { request = { url, options }; return { ok: true, json: async () => page }; },
  });
  assert.equal(await api.fetchPostCommentsPage({ target: { sourceType: "beauty_post", sourceId: "post" }, offset: 10, pageSize: 10 }), page);
  assert.match(request.url, /^\/api\/post-comments\?/);
  assert.match(request.url, /offset=10/);
  assert.equal(request.options.credentials, "same-origin");
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.signal.aborted, false);
});

test("comment read timeout aborts the network request", async () => {
  let expire, signal, cleared = false;
  const api = moduleAt("lib/post-comments-client.ts", {
    URLSearchParams, AbortController,
    setTimeout: callback => { expire = callback; return 1; },
    clearTimeout: () => { cleared = true; },
    fetch: (_url, options) => new Promise((_resolve, reject) => {
      signal = options.signal;
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
  });
  const promise = api.fetchPostCommentsPage({ target: { sourceType: "beauty_post", sourceId: "post" }, offset: 0, pageSize: 10 });
  expire();
  await assert.rejects(promise, /took too long/);
  assert.equal(signal.aborted, true);
  assert.equal(cleared, true);
});

test("read endpoint delegates to the existing permission-aware loader and forbids caching", async () => {
  let input;
  const api = moduleAt("app/api/post-comments/route.ts", {
    URL, Response, performance,
    require: () => ({
      isPostCommentTargetType: value => value === "beauty_post",
      normalizePostCommentTarget: target => target.sourceId === "valid" ? target : null,
      loadPostCommentsPage: async value => { input = value; return { items: [], error: null }; },
    }),
  });
  const response = await api.GET(new Request("http://localhost/api/post-comments?sourceType=beauty_post&sourceId=valid&offset=10&pageSize=10"));
  assert.equal(response.status, 200);
  assert.equal(input.target.sourceId, "valid");
  assert.equal(input.offset, 10);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(response.headers.get("server-timing"), /comments;dur=/);
  input = null;
  assert.equal((await api.GET(new Request("http://localhost/api/post-comments?sourceType=beauty_post&sourceId=invalid"))).status, 400);
  assert.equal(input, null);
});

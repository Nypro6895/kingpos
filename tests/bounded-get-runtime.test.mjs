import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Request, Response, Headers, URL, AbortController, AbortSignal, DOMException, Uint8Array, setTimeout, clearTimeout, fetch, console, require: name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  } });
  return exports;
}
const api = load("lib/bounded-get.ts");
const auth = load("lib/supabase/auth-rest.ts", { "@/lib/bounded-get": api });

test("a stalled request and a stalled JSON body both finish at the deadline even when transport ignores abort", async () => {
  let calls = 0;
  await assert.rejects(api.fetchBoundedGet("https://test.invalid", {}, { timeoutMs: 20, totalTimeoutMs: 60, retryDelayMs: 0, maxAttempts: 2, fetcher: async () => { calls++; return new Promise(() => {}); } }), api.ReadConnectionError);
  assert.equal(calls, 2);
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"scope":')); }, cancel() { cancelled = true; } });
  await assert.rejects(api.fetchBoundedGet("https://test.invalid", {}, { timeoutMs: 20, maxAttempts: 1, fetcher: async () => new Response(body) }), api.ReadConnectionError);
  assert.equal(cancelled, true);
});

test("safe GET retries a temporary503 and preserves the body and response metadata", async () => {
  let calls = 0;
  const response = await api.fetchBoundedGet("https://test.invalid", { headers: { "If-None-Match": '"old"' } }, { timeoutMs: 100, retryDelayMs: 0, fetcher: async (_, init) => {
    calls++;
    assert.equal(init.headers["If-None-Match"], '"old"');
    return Response.json(calls === 1 ? { error: "Unavailable" } : { scope: "verified" }, { status: calls === 1 ? 503 : 200 });
  } });
  assert.equal(calls, 2);
  assert.equal((await response.json()).scope, "verified");
  assert.equal(response.headers.get("content-type"), "application/json");
});

test("401,403,409 and304 are never retried and mutations are transmitted exactly once", async () => {
  for (const status of [401, 403, 409, 304]) {
    let calls = 0;
    const response = await api.fetchBoundedGet("https://test.invalid", {}, { fetcher: async () => { calls++; return new Response(status === 304 ? null : "Denied", { status }); } });
    assert.equal(response.status, status);
    assert.equal(calls, 1);
  }
  assert.throws(() => api.fetchBoundedGet("https://test.invalid", { method: "POST" }), error => error.name === "TypeError");
  for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
    let calls = 0;
    const response = await api.fetchWithDeadline("https://test.invalid", { method, body: "exact request body" }, { fetcher: async (_, init) => { calls++; assert.equal(init.body, "exact request body"); return new Response("Busy", { status: 503 }); } });
    assert.equal(response.status, 503);
    assert.equal(calls, 1);
  }
});

test("scope cancellation stops retry and never accepts an obsolete response", async () => {
  const controller = new AbortController();
  let complete, calls = 0;
  const response = api.fetchBoundedGet("https://test.invalid", { signal: controller.signal }, { timeoutMs: 1000, retryDelayMs: 0, fetcher: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(response, error => error.name === "AbortError");
  complete(Response.json({ scope: "obsolete" }));
  assert.equal(calls, 1);
});

test("response bytes and outer read-model waits remain bounded", async () => {
  let calls = 0;
  await assert.rejects(api.fetchBoundedGet("https://test.invalid", {}, { maxBodyBytes: 4, fetcher: async () => { calls++; return new Response("oversize body"); } }), error => error.kind === "body-limit");
  assert.equal(calls, 1);
  await assert.rejects(api.runReadWithDeadline(new Promise(() => {}), 10), error => error.kind === "timeout");
  assert.equal(await api.runReadWithDeadline(Promise.resolve("verified"), 50), "verified");
});

test("auth failures distinguish unavailable verification from confirmed rejection", () => {
  for (const error of [{ status: 503 }, { status: 429 }, { code: "", message: "TypeError: fetch failed" }, { code: "08006" }, new api.ReadConnectionError("timeout")]) {
    assert.equal(auth.isAuthTemporarilyUnavailable(error, error.status), true);
    assert.throws(() => auth.assertAuthAvailable(error, error.status), auth.AuthAvailabilityError);
  }
  for (const error of [{ status: 401 }, { status: 403 }, { status: 400, code: "bad_jwt" }, { code: "PGRST301" }]) {
    assert.equal(auth.isAuthTemporarilyUnavailable(error, error.status), false);
    assert.doesNotThrow(() => auth.assertAuthAvailable(error, error.status));
  }
  assert.doesNotThrow(() => auth.assertAuthAvailable(null));
  assert.throws(() => auth.assertAuthAvailable({ code: "42P01" }, 404, "Account status"), auth.AuthAvailabilityError);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../lib/pos-draft-outbox.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const { DraftOutbox } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
function create(t, overrides = {}) {
  let sequence = 0;
  const saved = [];
  const queue = new DraftOutbox({ version: 4, id: () => `operation-${++sequence}`,
    online: () => true, persist: (state) => saved.push(structuredClone(state)),
    send: async (operation) => ({ kind: "ok", version: operation.expectedVersion + 1 }), ...overrides });
  t.after(() => queue.stop());
  return { queue, saved };
}

test("rapid edits coalesce, but never mutate or overlap an in-flight operation", async (t) => {
  const first = deferred(); const sent = [];
  const { queue, saved } = create(t, { send: async (operation) => {
    sent.push(structuredClone(operation));
    assert.equal(saved.at(-1).head.id, operation.id, "persist before sending");
    return sent.length === 1 ? first.promise : { kind: "ok", version: 6 };
  } });
  queue.enqueue({ total: 10 }); const running = queue.pump();
  queue.enqueue({ total: 20 }); queue.enqueue({ total: 30 }); await queue.pump();
  assert.equal(sent.length, 1); assert.equal(sent[0].payload.total, 10);
  first.resolve({ kind: "ok", version: 5 }); await running; await queue.pump();
  assert.equal(sent.length, 2); assert.equal(sent[1].payload.total, 30);
  assert.equal(sent[1].expectedVersion, 5); assert.equal(queue.pending, false);
});

test("lost responses retry the identical id and payload after a reload", async (t) => {
  const { queue, saved } = create(t, { send: async () => { throw new Error("connection lost"); } });
  queue.enqueue({ total: 40 }); await queue.pump(); queue.stop();
  const persisted = saved.at(-1); const received = [];
  const { queue: restarted } = create(t, { restored: persisted,
    send: async (operation) => { received.push(operation); return { kind: "ok", version: 5 }; } });
  await restarted.pump();
  assert.deepEqual(received[0], persisted.head); assert.equal(restarted.pending, false);
});

test("offline edits remain durable and submit cannot flush them", async (t) => {
  let online = false; let calls = 0;
  const { queue, saved } = create(t, { online: () => online, send: async () => { calls++; return { kind: "ok", version: 5 }; } });
  queue.enqueue({ total: 50 }); await queue.pump();
  assert.equal(calls, 0); assert.equal(saved.at(-1).next.total, 50);
  assert.equal(await queue.flush(10), false);
  online = true; await queue.pump(); assert.equal(calls, 1); assert.equal(queue.pending, false);
});

test("conflict retains edits and stops automatic retries and finalization", async (t) => {
  let calls = 0;
  const { queue } = create(t, { send: async () => { calls++; return { kind: "blocked", message: "Receipt changed" }; } });
  queue.enqueue({ total: 60 }); await queue.pump(); queue.enqueue({ total: 70 });
  await queue.pump(); assert.equal(calls, 1); assert.equal(queue.pending, true);
  assert.equal(queue.state.next.total, 70); assert.equal(await queue.flush(10), false);
});

test("incoming versions never silently rebase unsent local work", (t) => {
  const { queue } = create(t);
  queue.observeVersion(6); assert.equal(queue.state.version, 6);
  queue.enqueue({ total: 1 }); queue.observeVersion(8); assert.equal(queue.state.version, 6);
});

test("storage failure is visible without freezing local edits", (t) => {
  const { queue } = create(t, { persist: () => { throw new Error("Quota exceeded"); } });
  queue.enqueue({ total: 80 }); assert.equal(queue.storageError, true); assert.equal(queue.pending, true);
});

test("logout stops late responses from recreating cleared storage", async (t) => {
  const response = deferred(); const { queue, saved } = create(t, { send: () => response.promise });
  queue.enqueue({ total: 90 }); const running = queue.pump(); const writes = saved.length;
  queue.stop(); response.resolve({ kind: "ok", version: 5 }); await running;
  assert.equal(saved.length, writes);
});

test("a slow request times out finalization without starting a second request", async (t) => {
  const response = deferred(); let calls = 0;
  const { queue } = create(t, { send: () => { calls++; return response.promise; } });
  queue.enqueue({ total: 100 });
  assert.equal(await queue.flush(10), false); assert.equal(calls, 1);
  response.resolve({ kind: "ok", version: 5 });
});

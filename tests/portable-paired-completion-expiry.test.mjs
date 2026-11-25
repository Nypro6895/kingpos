import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Execute the owning effect unchanged. Only time and the two transport edges
// are controlled; the completion choice, deadline and cleanup are product code.
const filename = "app/pos/pos-desk-client.tsx";
const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let owningEffect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useEffect") {
    const effect = node.arguments[0];
    if (effect && effect.getText(source).includes("connectLocalReceipt(liveDraftToken, callbacks)")) {
      assert.equal(owningEffect, undefined, "one original receipt transport effect");
      owningEffect = effect;
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.ok(owningEffect, "execute the original receipt transport owner");
const compiled = ts.transpileModule(`export const mount = ${owningEffect.getText(source)};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function controlledClock() {
  let now = Date.parse("2026-11-25T18:00:00.000Z"), sequence = 0;
  const tasks = new Map();
  const schedule = (callback, delay, interval = false) => { const id = ++sequence; tasks.set(id, { callback, due: now + delay, period: interval ? delay : null }); return id; };
  return {
    now: () => now,
    setTimeout: (callback, delay) => schedule(callback, delay),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clear: id => tasks.delete(id),
    pending: () => tasks.size,
    advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...tasks].filter(([, task]) => task.due <= end).sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
        if (!next) break;
        const [id, task] = next; now = task.due;
        if (task.period === null) tasks.delete(id); else task.due += task.period;
        task.callback();
      }
      now = end;
    },
  };
}
function mountReceipt({ paired = true } = {}) {
  const clock = controlledClock(), frames = { local: [], paired: [] }, closed = { local: 0, paired: 0 };
  const payload = { token: "private-local-token", selectedStaffId: null, staffLines: [], customer: null, subtotal: 0, totalBeforeTip: 0, total: 0, tax: 0, discount: 0, tip: 0 };
  const completed = { cartId: "submitted-cart", revision: "submitted-revision", payload: { ...payload, subtotal: 35, totalBeforeTip: 35, total: 35 }, completedAt: new Date(clock.now()).toISOString(), resetAt: new Date(clock.now() + 500).toISOString() };
  const localCartId = { current: "next-idle-cart" }, completedLocalReceipt = { current: completed }, currentPortablePayload = { current: JSON.stringify(payload) }, pairedReceiptPublisher = { current: null };
  const exports = {};
  class ClockDate extends Date { static now() { return clock.now(); } }
  const unexpectedMutation = () => { throw Error("Expiration must not mutate the durable receipt/outbox or employee input."); };
  vm.runInNewContext(compiled, {
    exports, Date: ClockDate, crypto: { randomUUID: () => "generated-cart" },
    setTimeout: clock.setTimeout, clearTimeout: clock.clear, setInterval: clock.setInterval, clearInterval: clock.clear,
    localFirstDraft: true, portableDraftReady: true, liveDraftToken: payload.token, pairedWorkstation: paired,
    localCartId, completedLocalReceipt, currentPortablePayload, pairedReceiptPublisher,
    submitLockedRef: { current: false }, resetInFlightRef: { current: false }, localDisplaySeenAt: { current: 0 },
    portableWorkspaceState: { scope: "synthetic-salon:synthetic-key" }, portableDraftStates: new Map(),
    workstationDirty: { current: false }, workstationPending: { current: false },
    localRecovery: { current: { draft: {} } }, persistLocalPortableDraft: unexpectedMutation, setLiveCustomer: unexpectedMutation, setDraft: unexpectedMutation,
    connectLocalReceipt: () => ({ publish(value) { frames.local.push({ at: clock.now(), value: structuredClone(value) }); }, close() { closed.local++; } }),
    connectPairedStaffReceipt: () => { assert.equal(paired, true); return { publish(value) { frames.paired.push({ at: clock.now(), value: structuredClone(value) }); }, close() { closed.paired++; } }; },
  });
  const cleanup = exports.mount();
  return { clock, frames, closed, cleanup, completedLocalReceipt, currentPortablePayload, pairedReceiptPublisher, payload };
}

test("actual receipt effect publishes the next idle paired draft at completion expiry without employee input", () => {
  const f = mountReceipt(), start = f.clock.now();
  assert.equal(f.frames.paired.length, 1);
  assert.equal(f.frames.paired[0].value.cartId, "submitted-cart");
  f.clock.advance(500);
  assert.equal(f.frames.paired.length, 1, "keep the completed receipt through its display deadline");
  f.clock.advance(1);
  assert.equal(f.frames.paired.length, 2);
  assert.equal(f.frames.paired[1].at - start, 501);
  assert.equal(f.frames.paired[1].value.cartId, "next-idle-cart");
  assert.equal(f.frames.paired[1].value.payload.total, 0);
  assert.equal(f.frames.paired[1].value.completedAt, undefined);
  assert.deepEqual(f.frames.local.map(frame => frame.at - start), [0, 500], "Windows keeps its existing 100 ms observation cadence");
  f.clock.advance(3000);
  assert.equal(f.frames.paired.length, 2, "idle time does not create further paired receipt events");
  f.cleanup(); assert.equal(f.clock.pending(), 0);
  assert.deepEqual(f.closed, { local: 1, paired: 1 });
  assert.equal(f.pairedReceiptPublisher.current, null);
});
test("Windows without pairing retains the original local completion fallback and creates no paired timer", () => {
  const f = mountReceipt({ paired: false }), start = f.clock.now();
  assert.equal(f.clock.pending(), 1, "only the original Windows observation interval exists");
  f.clock.advance(500);
  assert.deepEqual(f.frames.local.map(frame => frame.at - start), [0, 500]);
  assert.equal(f.frames.local.at(-1).value.cartId, "next-idle-cart");
  assert.deepEqual(f.frames.paired, []);
  f.cleanup(); assert.equal(f.clock.pending(), 0);
  assert.deepEqual(f.closed, { local: 1, paired: 0 });
});
test("leaving the desk before completion expiry cancels its paired deadline and later publication", () => {
  const f = mountReceipt();
  f.clock.advance(100); f.cleanup();
  const counts = [f.frames.local.length, f.frames.paired.length];
  f.clock.advance(10000);
  assert.deepEqual([f.frames.local.length, f.frames.paired.length], counts);
  assert.equal(f.clock.pending(), 0);
});
test("an explicit new receipt cancels the earlier completed receipt deadline", () => {
  const f = mountReceipt();
  f.clock.advance(100);
  f.completedLocalReceipt.current = null;
  f.currentPortablePayload.current = JSON.stringify({ ...f.payload, subtotal: 12, totalBeforeTip: 12, total: 12 });
  f.pairedReceiptPublisher.current();
  assert.equal(f.frames.paired.at(-1).value.payload.total, 12);
  f.clock.advance(1000);
  assert.equal(f.frames.paired.length, 2, "the retired deadline cannot overwrite the newer receipt");
  f.cleanup();
});

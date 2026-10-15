import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../ios/Reylumi/NativeBridge.js", import.meta.url), "utf8");
const nonce = "12345678-1234-4234-8234-123456789abc";
function fixture(path = "/explore") {
  const messages = [], frames = [], events = new Map(), documentEvents = new Map();
  let shells = [], observer;
  const location = new URL(`https://reylumi.com${path}`);
  const document = {
    visibilityState: "visible",
    querySelectorAll: selector => selector.startsWith("[data-reylumi") ? shells : [],
    addEventListener: (name, fn) => documentEvents.set(name, fn),
  };
  const window = { webkit: { messageHandlers: { reylumi: { postMessage: body => messages.push(JSON.parse(JSON.stringify(body))) } } }, addEventListener: (name, fn) => events.set(name, fn) };
  vm.runInNewContext(source, {
    window, document, location, URL, navigator: {},
    history: { pushState() {}, replaceState() {} },
    requestAnimationFrame: callback => frames.push(callback),
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
  });
  const frame = () => { for (const callback of frames.splice(0)) callback(); };
  return {
    messages, window, document, location,
    context: (overrides = {}) => window.__reylumiStartup.setNavigationContext({ origin: location.origin, generation: 1, nonce, ...overrides }),
    ready: () => events.get("reylumi:screen-ready")(),
    paint: () => { frame(); frame(); }, frame,
    showShells: visibility => { shells = visibility.map(visible => ({ getClientRects: () => visible ? [{}] : [] })); observer(); },
    visible: value => { document.visibilityState = value ? "visible" : "hidden"; documentEvents.get("visibilitychange")(); },
  };
}

test("native readiness waits for mounted core UI and two paint frames", () => {
  const f = fixture();
  assert.equal(f.context(), true);
  f.paint();
  assert.deepEqual(f.messages, [], "committing HTML alone does not mark the interactive shell ready");
  f.ready();
  f.frame();
  assert.deepEqual(f.messages, []);
  f.frame();
  assert.deepEqual(f.messages, [{ action: "screen-ready", nonce, generation: 1, origin: "https://reylumi.com" }]);
  f.ready(); f.paint();
  assert.equal(f.messages.length, 1, "repeat layout effects must not send duplicate readiness");
});

test("core readiness arriving before didCommit waits for the native context", () => {
  const f = fixture();
  f.ready(); f.paint();
  assert.deepEqual(f.messages, []);
  f.context(); f.paint();
  assert.equal(f.messages.length, 1);
});

test("visible DOM marker works while hidden Activity markers do not unlock launch", () => {
  const f = fixture();
  f.context(); f.paint();
  f.showShells([false]); f.paint(); f.paint();
  assert.deepEqual(f.messages, []);
  f.showShells([false, true]); f.paint(); f.paint();
  assert.equal(f.messages.length, 1);
});

test("readiness requires matching HTTPS origin, nonce and positive integer generation", () => {
  for (const invalid of [
    { origin: "https://other.test" }, { nonce: "" }, { nonce: "not-a-nonce" },
    { generation: 0 }, { generation: -1 }, { generation: 1.5 }, { generation: "1" },
  ]) {
    const f = fixture(); f.ready();
    assert.equal(f.context(invalid), false, JSON.stringify(invalid));
    f.paint();
    assert.deepEqual(f.messages, []);
  }
});

test("old generation cannot replace a new native navigation context", () => {
  const f = fixture();
  assert.equal(f.context({ generation: 3 }), true);
  assert.equal(f.context({ generation: 2, nonce: "12345678-1234-4234-8234-123456789abd" }), false);
  f.ready(); f.paint();
  assert.equal(f.messages[0].generation, 3);
  assert.equal(f.messages[0].nonce, nonce);
});

test("hidden document defers readiness until visible", () => {
  const f = fixture();
  f.visible(false); f.context(); f.ready(); f.paint();
  assert.deepEqual(f.messages, []);
  f.visible(true); f.paint();
  assert.equal(f.messages.length, 1);
});

test("excluded documents cannot mark themselves ready or inherit public readiness", () => {
  const excluded = fixture("/admin");
  excluded.ready();
  assert.equal(excluded.context(), false);
  excluded.paint();
  assert.deepEqual(excluded.messages, []);
  const f = fixture();
  f.context(); f.ready(); f.location.pathname = "/api/admin/users"; f.paint();
  assert.deepEqual(f.messages, []);
});

test("Swift startup source retains bounded safe retry and protected bridge entry", () => {
  const controller = readFileSync("ios/Reylumi/ReylumiViewController.swift", "utf8");
  const state = readFileSync("ios/Reylumi/ReylumiStartupState.swift", "utf8");
  const shell = readFileSync("ios/Reylumi/ReylumiLaunchView.swift", "utf8");
  assert.ok(!controller.includes("webView.reload()"), "reload may replay the last POST");
  assert.match(controller, /\.now\(\) \+ 18/);
  assert.match(controller, /message\.frameInfo\.isMainFrame/);
  assert.match(controller, /policy\.isInternal\(url\), !policy\.isExcluded\(url\)/);
  assert.match(controller, /startup\.ready\(nonce: nonce, generation: generation\)/);
  assert.match(controller, /isForMainFrame[\s\S]*http\.statusCode >= 400/);
  assert.match(state, /request\.httpBody == nil, request\.httpBodyStream == nil/);
  assert.match(state, /timeoutInterval: 15/);
  assert.match(state, /timeIntervalSince\(lastProcessRecovery\) < 60/);
  for (const id of ["reylumi.launch.search", "reylumi.launch.explore", "reylumi.launch.market"]) assert.ok(shell.includes(id));
  assert.match(shell, /if search\.isFirstResponder \{ revealDeferred = true; return \}/);
  assert.match(controller, /onEditingFinished[\s\S]*startup\.hasUsablePage, !self\.startup\.isWaiting/);
});

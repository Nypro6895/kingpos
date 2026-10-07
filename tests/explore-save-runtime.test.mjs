import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Run the real component handlers with deterministic hooks and transport.
class TestCustomEvent { constructor(type, init) { this.type = type; this.detail = init.detail; } }
function eventBus() {
  const listeners = new Map();
  return {
    dispatchEvent(event) { for (const fn of listeners.get(event.type) ?? []) fn(event); },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    matchMedia: () => ({ matches: true }),
  };
}
function harness(props, saveAction, inheritedAuth, bus = eventBus()) {
  const states = [], refs = [], pending = [], effects = [];
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    createContext: () => ({}),
    useContext: () => inheritedAuth,
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef(initial) { const index = refIndex++; return refs[index] ??= { current: initial }; },
    useId: () => "test-tooltip",
    useEffect: callback => { effects[effectIndex++] ??= callback; },
    useTransition: () => [false, callback => { pending.push(callback()); }],
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync("app/saved-post/save-post-button.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name.includes("saved-post/actions")) return { setAccountSavedPostAction: saveAction };
      if (name.includes("types/saved-post")) return { savedPostKey: target => target.sourceId };
      if (name.includes("auth-intent-prompt")) return { AuthIntentPrompt: "AuthIntentPrompt" };
      if (name.includes("explore-account-actions")) return { ExploreReferenceLove: "ExploreReferenceLove", rememberExploreIntent() {}, clearExploreIntent() {} };
      throw new Error(name);
    },
    window: bus,
    CustomEvent: TestCustomEvent,
  });
  function render() {
    stateIndex = 0; refIndex = 0; effectIndex = 0;
    const outer = exports.SavePostButton({ target: { sourceId: "11111111-1111-4111-8111-111111111111", sourceType: "beauty_post" }, ...props });
    if (!outer) return null;
    return typeof outer.type === "function" ? outer.type(outer.props) : outer;
  }
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  }
  return {
    mount() { render(); effects.forEach(callback => callback()); },
    count: () => nodes(render()).find(n => n.type === "span" && typeof n.props.children === "number")?.props.children ?? 0,
    click() { nodes(render()).find(n => n.type === "button").props.onClick({ preventDefault() {}, stopPropagation() {} }); },
    button: () => nodes(render()).find(n => n.type === "button").props,
    message: () => nodes(render()).find(n => n.props?.["aria-live"] === "polite").props.children,
    hasPrompt: () => nodes(render()).some(n => n.type === "AuthIntentPrompt"),
    hasButton: () => nodes(render()).some(n => n.type === "button"),
    settle: () => Promise.all(pending),
  };
}

test("duplicate cards share optimistic, confirmed, and rolled-back save counts", async () => {
  const bus = eventBus();
  let finish;
  const props = { initialSaved: false, isAuthenticated: true, saveCount: 2, size: "toolbar" };
  const a = harness(props, () => new Promise(resolve => { finish = resolve; }), undefined, bus);
  const b = harness(props, async () => ({ error: "Denied" }), undefined, bus);
  a.mount(); b.mount();
  a.click();
  assert.equal(b.button()["aria-pressed"], true);
  assert.equal(b.count(), 3);
  finish({ active: true, saveCount: 9, error: null }); await a.settle();
  assert.equal(a.count(), 9); assert.equal(b.count(), 9);
  b.click();
  assert.equal(a.count(), 8);
  await b.settle();
  assert.equal(a.count(), 9); assert.equal(b.count(), 9);
  assert.equal(a.button()["aria-pressed"], true);
});

test("lost save response rolls back the heart and releases the click lock", async () => {
  let calls = 0;
  const ui = harness({ initialSaved: false, isAuthenticated: true, saveCount: 2 }, async () => {
    calls++;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return { active: true, saveCount: 3, error: null };
  });
  ui.click();
  await ui.settle();
  assert.equal(ui.button()["aria-pressed"], false);
  assert.equal(ui.button()["data-saving"], undefined);
  assert.match(ui.message(), /Connection interrupted/);
  ui.click();
  await ui.settle();
  assert.equal(calls, 2);
  assert.equal(ui.button()["aria-pressed"], true);
});

test("showcase cards never expose a save action for non-database IDs", () => {
  const ui = harness({ target: { sourceId: "showcase-look-1", sourceType: "salon_profile_look" } }, async () => { throw new Error("must not send"); });
  assert.equal(ui.hasButton(), false);
});

test("rapid clicks produce one in-flight mutation", async () => {
  let complete, calls = 0;
  const ui = harness({ initialSaved: false, isAuthenticated: true }, () => {
    calls++;
    return new Promise(resolve => { complete = resolve; });
  });
  ui.click(); ui.click(); ui.click();
  assert.equal(calls, 1);
  complete({ active: true, saveCount: 1, error: null });
  await ui.settle();
  assert.equal(ui.button()["data-saving"], undefined);
});

test("guest sees login prompt without optimistic like or network mutation", async () => {
  let calls = 0;
  const ui = harness({ initialSaved: false, isAuthenticated: false }, async () => { calls++; });
  ui.click();
  assert.equal(calls, 0);
  assert.equal(ui.button()["aria-pressed"], false);
  assert.equal(ui.hasPrompt(), true);
});

test("server rejection rolls back unlike and permits another attempt", async () => {
  const ui = harness({ initialSaved: true, isAuthenticated: true }, async () => ({ error: "Denied", authRequired: false }));
  ui.click();
  await ui.settle();
  assert.equal(ui.button()["aria-pressed"], true);
  assert.equal(ui.button()["data-saving"], undefined);
  assert.equal(ui.message(), "Denied");
});

test("legacy desktop cards inherit guest auth without sending a mutation", () => {
  let calls = 0;
  const ui = harness({ initialSaved: false }, async () => { calls++; }, false);
  ui.click();
  assert.equal(calls, 0);
  assert.equal(ui.button()["aria-pressed"], false);
  assert.equal(ui.hasPrompt(), true);
});

test("feed hydrates the viewer's existing salon save instead of always showing an empty heart", async () => {
  const exports = {};
  const key = target => `${target.sourceType}:${target.sourceId}`;
  const target = { sourceType: "salon_profile_look", sourceId: "existing-look", saved: false };
  const source = readFileSync("lib/explore-feed.ts", "utf8") + "\nexport { attachFeedSaveCounts };";
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports,
    require(name) {
      if (name === "@/lib/account-social") return {
        getAccountSavedPostCounts: async () => new Map([[key(target), 7]]),
        getAccountSavedPostStateKeys: async () => new Set([key(target)]),
      };
      if (name === "@/types/saved-post") return { savedPostKey: key };
      return {};
    },
  });
  const [item] = await exports.attachFeedSaveCounts([{ saveTarget: target }]);
  assert.equal(item.saveTarget.saved, true);
  assert.equal(item.saveTarget.saveCount, 7);
  const ui = harness({ initialSaved: item.saveTarget.saved, isAuthenticated: true }, async (_target, active) => {
    assert.equal(active, false, "first click on a previously saved post must remove the save");
    return { active, saveCount: 6, error: null };
  });
  ui.click(); await ui.settle();
  assert.equal(ui.button()["aria-pressed"], false);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, modules, globals = {}) {
  const exports = {};
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(output, { exports, require: name => modules[name] ?? {}, ...globals });
  return exports;
}
const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const browse = load("app/market/market-browse.ts", {});
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function pageFixture(deadlineRead = promise => promise) {
  const context = deferred(), data = deferred();
  const deadlines = [];
  let reads = 0, loads = 0, revisions = 0;
  const boundary = load("components/experience-page.tsx", {
    "react/jsx-runtime": jsx, "next/server": { connection: async () => {} },
    "./experience-page-boundary": { ExperiencePageBoundary: "boundary" },
  }, { crypto: { randomUUID: () => `revision-${++revisions}` } });
  const page = load("app/(app)/market/page.tsx", {
    "react/jsx-runtime": jsx, react: { Suspense: "suspense" },
    "@/components/experience-page": boundary,
    "@/lib/request-business-context": { getRequestBusinessContext: () => { reads++; return context.promise; } },
    "@/lib/experience-context": { getExperienceContext: value => value },
    "@/lib/market-experience-data": { loadMarketExperienceData: () => { loads++; return data.promise; } },
    "@/lib/experience-live-resource-server": { createLiveResourceSnapshot: value => ({ data: value, revision: "live" }) },
    "@/app/market/market-experience-client": { MarketExperienceClient: "market" },
    "@/app/market/market-startup-view": { MarketStartupView: "public-startup" },
    "@/app/market/market-browse": browse,
    "@/lib/bounded-get": { runReadWithDeadline: (promise, deadline) => { assert.equal(deadline, 20_000); deadlines.push(deadline); return deadlineRead(promise); } },
  });
  return { page: page.default, context, data, deadlines, counts: () => ({ reads, loads, revisions }) };
}

test("ordinary Market emits a public Suspense frame without waiting for any business reads", async () => {
  const f = pageFixture();
  const result = await f.page({ searchParams: Promise.resolve({ q: "Payroll", category: "Payroll" }) });
  assert.equal(result.type, "boundary");
  const suspended = result.props.children;
  assert.equal(suspended.type, "suspense");
  assert.equal(suspended.props.fallback.type, "public-startup");
  assert.deepEqual(clone(suspended.props.fallback.props.initialBrowse), { query: "Payroll", category: "Payroll" });
  assert.deepEqual(f.counts(), { reads: 0, loads: 0, revisions: 1 });
  const pending = suspended.props.children.type(suspended.props.children.props);
  assert.equal(f.counts().reads, 1);
  f.context.resolve({ scope: "authorized-workspace" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.counts().loads, 1);
  assert.deepEqual(f.deadlines, [20_000]);
  f.data.resolve({ paymentReturn: undefined, installationCounts: { paid: 2 }, cardReady: false });
  const authoritative = await pending;
  assert.equal(authoritative.type, "market");
  assert.equal(authoritative.props.context.scope, "authorized-workspace");
  assert.equal(authoritative.props.initial.data.installationCounts.paid, 2);
  assert.deepEqual(clone(authoritative.props.initialBrowse), { query: "Payroll", category: "Payroll" });
});

test("payment and bookingStripe returns await full authoritative data before generating the page revision", async () => {
  for (const query of [{ payment: "received" }, { payment: "cancelled" }, { bookingStripe: "failed" }, { bookingStripe: "received" }, { payment: "" }, { bookingStripe: "" }]) {
    const f = pageFixture();
    let returned = false;
    const pending = f.page({ searchParams: Promise.resolve(query) }).then(result => { returned = true; return result; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(returned, false);
    assert.deepEqual(f.counts(), { reads: 1, loads: 0, revisions: 0 });
    f.context.resolve({ scope: "authorized-workspace" });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.counts(), { reads: 1, loads: 1, revisions: 0 });
    f.data.resolve({ paymentReturn: query.payment });
    const result = await pending;
    assert.equal(result.props.children.type, "market");
    assert.equal(result.props.children.props.transient, true);
    assert.equal(result.props.children.props.initial.data.paymentReturn, query.payment);
    assert.equal(f.counts().revisions, 1);
    assert.deepEqual(f.deadlines, [20_000], "callbacks keep the full authoritative read while bounding a stalled read");
  }
});

test("public GET filters validate against actual Market categories and bound search text", () => {
  assert.equal(browse.marketBrowseFromQuery({}), undefined);
  assert.deepEqual(clone(browse.marketBrowseFromQuery({ q: ["unsafe"], category: "Fake category" })), { query: "", category: "All features" });
  assert.equal(browse.marketBrowseFromQuery({ q: "x".repeat(300) }).query.length, 200);
  for (const category of browse.MARKET_CATEGORIES) assert.equal(browse.marketBrowseFromQuery({ category }).category, category);
});

test("ordinary data timeout leaves the route retry boundary usable without replaying the loader", async () => {
  const bounded = load("lib/bounded-get.ts", {}, { setTimeout, clearTimeout });
  const f = pageFixture(read => bounded.runReadWithDeadline(read, 5));
  const result = await f.page({ searchParams: Promise.resolve({}) });
  const content = result.props.children.props.children;
  const pending = content.type(content.props);
  f.context.resolve({ scope: "current" });
  await assert.rejects(pending, error => error.kind === "timeout");
  assert.equal(f.counts().loads, 1, "bounding read time must not replay loader or actions");
  const retry = () => {};
  const errorView = load("app/(app)/market/error.tsx", {
    "react/jsx-runtime": jsx, "next/navigation": { useSearchParams: () => new URLSearchParams("q=Payroll&category=Payroll") },
    "@/app/market/market-startup-view": { MarketStartupView: "public-startup" }, "@/app/market/market-browse": browse,
  }, { URLSearchParams }).default({ unstable_retry: retry });
  assert.equal(errorView.type, "public-startup");
  assert.equal(errorView.props.retry, retry);
  assert.deepEqual(clone(errorView.props.initialBrowse), { query: "Payroll", category: "Payroll" });
});

test("stalled payment returns time out without a fresh page revision or replaying any read/action", async () => {
  const bounded = load("lib/bounded-get.ts", {}, { setTimeout, clearTimeout });
  for (const query of [{ payment: "received" }, { payment: "cancelled" }, { bookingStripe: "received" }, { bookingStripe: "failed" }]) {
    const f = pageFixture(read => bounded.runReadWithDeadline(read, 5));
    const pending = f.page({ searchParams: Promise.resolve(query) });
    f.context.resolve({ scope: "current" });
    await assert.rejects(pending, error => error.kind === "timeout");
    assert.deepEqual(f.counts(), { reads: 1, loads: 1, revisions: 0 });
    assert.deepEqual(f.deadlines, [20_000]);
  }
});

test("startup typing handoff is consumed once and rejects another route, scope, expired draft or viewer reset", () => {
  let now = 1000;
  const listeners = new Map();
  const window = { location: { pathname: "/market", search: "?q=Payroll" }, addEventListener: (name, listener) => listeners.set(name, listener) };
  const drafts = load("app/market/market-browse.ts", {}, { window, Date: { now: () => now } });
  const input = { query: "Unsent draft", category: "Payroll" };
  drafts.rememberMarketStartupDraft(input, { scope: "viewer:salon", focused: true, selectionStart: 3, selectionEnd: 5 });
  const restored = drafts.takeMarketStartupDraft("viewer:salon");
  assert.deepEqual(clone(restored.browse), input);
  assert.equal(restored.focused, true);
  assert.equal(restored.selectionStart, 3);
  assert.equal(drafts.takeMarketStartupDraft("viewer:salon"), undefined);
  drafts.rememberMarketStartupDraft(input, { scope: "viewer:salon" });
  assert.equal(drafts.takeMarketStartupDraft("other-viewer"), undefined);
  drafts.rememberMarketStartupDraft(input);
  window.location.search = "?q=Another";
  assert.equal(drafts.takeMarketStartupDraft(), undefined);
  window.location.search = "?q=Payroll";
  drafts.rememberMarketStartupDraft(input);
  now += 60001;
  assert.equal(drafts.takeMarketStartupDraft(), undefined);
  drafts.rememberMarketStartupDraft(input);
  listeners.get("reylumi:experience-reset")();
  assert.equal(drafts.takeMarketStartupDraft(), undefined);
});

test("explicit GET filters seed once; warm remembered changes and live updates preserve interactive filters", () => {
  const hooks = []; let index = 0, remembered;
  const react = {
    useState: initial => { const slot = index++; if (!(slot in hooks)) hooks[slot] = typeof initial === "function" ? initial() : initial; return [hooks[slot], value => { hooks[slot] = typeof value === "function" ? value(hooks[slot]) : value; }]; },
    useRef: initial => { const slot = index++; if (!(slot in hooks)) hooks[slot] = { current: initial }; return hooks[slot]; },
    useEffect() {}, useLayoutEffect() {},
  };
  const client = load("app/market/market-client.tsx", {
    react, "react/jsx-runtime": jsx, "next/navigation": { useRouter: () => ({ refresh() {} }) },
    "@/components/workspace-language": { useWorkspaceTranslation: () => value => value },
    "@/types/vietnamese-plugin": { EMPTY_VIETNAMESE_PLUGIN: { installed: false, has_subscription: false } },
    "@/lib/use-remembered-experience": { useRememberedExperience: (_context, options) => { remembered = options; } },
    "@/lib/market-ranking": { rankMarketApps: () => [] }, "./sample-apps": { sampleApps: [] },
    "./market-browse": browse, "./market.module.css": { default: {} },
  });
  const props = { experienceScope: "scope", initialBrowse: { query: "Payroll", category: "Payroll" } };
  let rendered;
  const render = next => { index = 0; rendered = client.MarketClient(next); return clone(remembered.value); };
  const find = (node, predicate) => {
    if (!node || typeof node !== "object") return undefined;
    if (predicate(node)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, predicate); if (found) return found; }
  };
  assert.deepEqual(render(props), { query: "Payroll", category: "Payroll", view: "discover" });
  remembered.onRestore({ query: "Old snapshot", category: "Payments", view: "my-apps" });
  assert.equal(render(props).query, "Payroll", "fresh GET intent takes precedence over an older snapshot");
  find(rendered, node => node.type === "input" && node.props["aria-label"] === "Search features").props.onChange({ target: { value: "Warm user edit" } });
  render(props);
  find(rendered, node => node.type === "button" && node.props.children === "Operations").props.onClick();
  render(props);
  remembered.onEmpty();
  remembered.onRestore({ query: "Stale stored input", category: "Payments", view: "my-apps" });
  assert.deepEqual(render(props), { query: "Warm user edit", category: "Operations", view: "discover" });
  assert.deepEqual(render({ ...props, initialBrowse: { query: "Other server prop", category: "Payments" }, installationCounts: { paid: 5 } }), { query: "Warm user edit", category: "Operations", view: "discover" });
});

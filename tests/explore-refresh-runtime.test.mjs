import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function harness() {
  let snapshot, changed;
  const exports = {};
  const source = ts.transpileModule(readFileSync("app/explore/explore-feed.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "react") return { useState(initial) {
      snapshot ??= initial;
      return [snapshot, next => { snapshot = next; changed = true; }];
    } };
    if (name === "react/jsx-runtime") return { jsx: (type, props, key) => ({ type, props, key }) };
    return {};
  } });
  return props => {
    let tree;
    do { changed = false; tree = exports.ExploreFeed(props); } while (changed);
    return tree;
  };
}
test("local rerenders preserve pagination; a fresh server page replaces the feed session", () => {
  const render = harness();
  const props = { initialPage: { items: [{ feedKey: "old" }], nextCursor: "old-cursor" }, viewer: { userId: "alice" } };
  const first = render(props);
  assert.equal(first.props.restoreSession, true);
  assert.equal(render({ ...props, activeDiscoveryResult: "near_you" }).key, first.key);
  const refreshed = render({ ...props, initialPage: { items: [], nextCursor: null } });
  assert.notEqual(refreshed.key, first.key, "old component and pending pagination must be detached");
  assert.equal(refreshed.props.restoreSession, false, "deleted content must not return from session storage");
  assert.deepEqual(refreshed.props.initialPage.items, []);
});
test("changing viewer replaces feed state even when the page object is unchanged", () => {
  const render = harness();
  const initialPage = { items: [], nextCursor: null };
  const first = render({ initialPage, viewer: { userId: "alice" } });
  const second = render({ initialPage, viewer: { userId: "bob" } });
  assert.notEqual(second.key, first.key);
  assert.equal(second.props.restoreSession, false);
});

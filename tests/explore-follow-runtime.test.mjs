import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function harness(action) {
  const states = [], pending = [];
  let index = 0;
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  const source = ts.transpileModule(readFileSync("app/explore/beauty/beauty-follow-button.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "react") return {
      useState(initial) { const slot = index++; if (!(slot in states)) states[slot] = initial; return [states[slot], value => { states[slot] = typeof value === "function" ? value(states[slot]) : value; }]; },
      useTransition: () => [false, callback => { pending.push(callback()); }],
    };
    if (name.includes("explore/actions")) return { toggleBeautyProfileFollowAction: action };
    if (name.includes("auth-intent-prompt")) return { AuthIntentPrompt: "AuthIntentPrompt" };
    throw new Error(name);
  } });
  const render = () => { index = 0; return exports.BeautyFollowButton({ profileId: "artist", initialFollowing: false, followerCount: 2 }); };
  const children = () => render().props.children;
  return { click: () => children()[0].props.onClick(), children, settle: () => Promise.all(pending.splice(0)) };
}

test("follow transport failure preserves state and permits an explicit retry", async () => {
  let calls = 0;
  const ui = harness(async () => { if (++calls === 1) throw new TypeError("Failed to fetch"); return { active: true, error: null }; });
  ui.click();
  await ui.settle();
  assert.equal(ui.children()[0].props["aria-pressed"], false);
  assert.equal(ui.children()[1].props.children, "2 followers");
  assert.match(ui.children()[2].props.children, /try again/i);
  ui.click();
  await ui.settle();
  assert.equal(ui.children()[0].props["aria-pressed"], true);
  assert.equal(ui.children()[1].props.children, "3 followers");
  assert.equal(calls, 2);
});

test("a guest follow rejection opens sign-in without changing the count", async () => {
  const ui = harness(async () => ({ active: false, error: "Please sign in to follow." }));
  ui.click(); await ui.settle();
  assert.equal(ui.children()[0].props["aria-pressed"], false);
  assert.equal(ui.children()[1].props.children, "2 followers");
  assert.equal(ui.children()[3].type, "AuthIntentPrompt");
});

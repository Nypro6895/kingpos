import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { resolveExploreBookingHref } from "../lib/public-booking-routes.ts";

const salonId = "1650370b-f86d-461e-8d97-6210052eeed7";
function buttonHarness(authenticated, props) {
  const calls = [], stored = new Map(), exports = {};
  const jsx = (type, props) => ({ type, props });
  vm.runInNewContext(ts.transpileModule(readFileSync("components/explore-account-actions.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports, sessionStorage: { setItem: (key, value) => stored.set(key, JSON.parse(value)) },
    window: { dispatchEvent: event => calls.push(event) },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    require(name) {
      if (name === "react") return { createContext: () => ({}), useContext: () => authenticated, useState: () => [false, () => {}] };
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
      if (name === "@/components/workspace-language") return { useWorkspaceTranslation: () => value => value };
      if (name === "@/components/overlay-dismissal") return {useTransientOverlay:()=>{}};
      if (name === "@/lib/quick-booking-client") return { openQuickBooking: href => calls.push(href) };
      if (name === "@/lib/public-booking-routes") return { resolveExploreBookingHref };
      return {};
    },
  });
  const tree = exports.ExploreBookButton(props);
  const button = tree.props.children[0];
  button.props.onClick({ preventDefault() {}, stopPropagation() {} });
  return { calls, stored };
}

test("tagged personal/staff post Book checks the salon instead of falsely declaring it offline", () => {
  const { calls } = buttonHarness(true, { href: null, name: "King Nails Spa LLC", contactHref: `/explore/salons/${salonId}` });
  assert.deepEqual(calls, [`/book/${salonId}`]);
});
test("a recipe link retains its inspiration and source", () => {
  const href = `/book/${salonId}?inspiration=post&source=explore`;
  assert.deepEqual(buttonHarness(true, { href, contactHref: `/explore/salons/${salonId}` }).calls, [href]);
});
test("sign-in remembers the resolved salon route without opening booking early", () => {
  const { calls, stored } = buttonHarness(false, { contactHref: `/explore/salons/${salonId}` });
  assert.equal(calls.length, 0);
  assert.equal(stored.get("reylumi-explore-account-intent").book.href, `/book/${salonId}`);
});
test("showcase posts retain their contact action", () => {
  const { calls } = buttonHarness(true, { contactHref: "/explore/salons/showcase-example" });
  assert.equal(calls[0].type, "reylumi:contact-salon");
});

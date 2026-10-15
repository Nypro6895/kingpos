import test from "node:test";
import assert from "node:assert/strict";
import { transformSync } from "esbuild";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const compiled = transformSync(readFileSync(new URL("../lib/ios-client.ts", import.meta.url), "utf8"), { loader: "ts", format: "cjs" }).code;
const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports });
const { isReylumiIOSClient, isIOSExcludedPath } = module.exports;

test("iOS marker distinguishes native app from Safari and desktop", () => {
  assert.equal(isReylumiIOSClient("Mozilla/5.0 AppleWebKit/605.1.15 ReylumiIOS/1.0"), true);
  for (const ua of [null, "Mozilla/5.0 Safari/605.1.15", "ReylumiIOSFake/1.0", "FakeReylumiIOS/1.0"]) assert.equal(isReylumiIOSClient(ua), false);
});
test("exclude admin and desktop installer, retain salon workspaces", () => {
  for (const path of ["/admin", "/admin/users", "/ADMIN/users", "/%61dmin/users", "/api/admin/users", "/admin%5cusers", "/settings/recovery-back-office", "/api/pos/windows-download", "/%XX"]) assert.equal(isIOSExcludedPath(path), true, path);
  for (const path of ["/pos", "/bookings", "/staff", "/payroll", "/reports", "/settings", "/support", "/administrator", "/api/public-booking/context"]) assert.equal(isIOSExcludedPath(path), false, path);
});
test("native bridge blocks client admin transitions and preserves other navigation", () => {
  const messages = [], navigations = [];
  const history = Object.fromEntries(["pushState", "replaceState"].map(name => [name, (...args) => navigations.push(args)]));
  const link = { href: "https://reylumi.com/admin/users", hidden: false };
  const normalLink = { href: "https://reylumi.com/bookings", hidden: false };
  const context = {
    window: { webkit: { messageHandlers: { reylumi: { postMessage: m => messages.push(m) } } } },
    navigator: {}, history, URL, location: new URL("https://reylumi.com/explore"),
    MutationObserver: class { observe() {} }, requestAnimationFrame: fn => fn(),
    document: { querySelectorAll: () => [link, normalLink], addEventListener: (_, fn) => fn() },
  };
  vm.runInNewContext(readFileSync(new URL("../ios/Reylumi/NativeBridge.js", import.meta.url), "utf8"), context);
  history.pushState({}, "", "/admin/users");
  history.replaceState({}, "", "/%61dmin");
  history.pushState({}, "", "/bookings");
  context.window.print();
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0][2], "/bookings");
  assert.deepEqual(messages.map(m => m.action), ["excluded", "excluded", "print"]);
  assert.equal(link.hidden, true);
  assert.equal(normalLink.hidden, false);
});

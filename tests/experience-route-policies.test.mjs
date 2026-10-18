import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const api = {};
vm.runInNewContext(ts.transpileModule(readFileSync("lib/experience-route-policies.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api, URL });

function routes(directory = "app", segments = []) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return routes(path.join(directory, entry.name), [...segments, entry.name]);
    if (!["page.tsx", "route.ts"].includes(entry.name)) return [];
    return [{ kind: entry.name === "page.tsx" ? "page" : "handler", pathname: "/" + segments.filter((part) => !/^\(.*\)$/.test(part)).join("/") }];
  });
}

test("every actual page and handler has an explicit classified policy", () => {
  const inventory = routes();
  const pages = inventory.filter((route) => route.kind === "page");
  const handlers = inventory.filter((route) => route.kind === "handler");
  assert.ok(pages.length >= 125, `pages inventoried: ${pages.length}`);
  assert.ok(handlers.length >= 77, `handlers inventoried: ${handlers.length}`);
  for (const { pathname, kind } of inventory) {
    const policy = api.getExperienceRoutePolicy(pathname, kind);
    assert.equal(policy.classified, true, `${kind} ${pathname}`);
    if (kind === "handler") {
      assert.equal(policy.retainData, "none", pathname);
      assert.equal(policy.allowPrefetch, false, pathname);
      assert.equal(policy.rememberUi, false, pathname);
    }
  }
});

test("token, authentication, payment, active form and destructive routes never retain a page", () => {
  for (const pathname of [
    "/login", "/signup", "/reset-password", "/account-recovery", "/accept-invite",
    "/ownership/invite/token", "/staff/invite/token", "/booking/manage/token", "/booking-payment/token",
    "/check-in/token", "/visit/token", "/support/guest/token", "/claim/123", "/book/123",
    "/market/orders/order", "/customers/new", "/customers/customer/edit", "/businesses/create",
    "/pos/customer-display?token=secret", "/settings/login-security",
    "/explore?access_token=secret", "/explore?token=secret", "/explore?client_secret=secret",
    "/market?tab=payment", "/market?payment=received", "/market?payment=cancelled", "/market?redirect_status=succeeded",
    "/market?bookingStripe=received", "/market?bookingStripe=cancelled",
    "/campaigns?action=cancel", "/admin/users?password=secret", "/explore#access_token=secret",
  ]) {
    const policy = api.getExperienceRoutePolicy(pathname);
    assert.equal(policy.retainData, "none", pathname);
    assert.equal(policy.resetOnHide, true, pathname);
    assert.equal(api.getExperienceRouteKey(pathname), null, pathname);
  }
});

test("public and private browsing retention is separate from server authorization", () => {
  const explore = api.getExperienceRoutePolicy("/explore/salons/123");
  assert.equal(explore.retainData, "public");
  assert.equal(explore.requiresAuth, false);
  assert.equal(explore.revalidateOnShow, true);
  for (const pathname of ["/admin/users", "/support/123", "/notifications", "/activity", "/campaigns", "/payroll"]) {
    const policy = api.getExperienceRoutePolicy(pathname);
    assert.equal(policy.retainData, "memory", pathname);
    assert.equal(policy.requiresAuth, true, pathname);
    assert.equal(policy.allowPrefetch, false, pathname);
    assert.equal(policy.revalidateOnShow, true, pathname);
    assert.ok(policy.maxAgeMs > policy.refreshAfterMs, pathname);
  }
  assert.equal(api.getExperienceRoutePolicy("/settings").retainData, "none");
  assert.equal(api.getExperienceRoutePolicy("/settings").resetOnHide, false);
  assert.equal(api.getExperienceRoutePolicy("/pos/portable/ticket").resetOnHide, false);
  assert.equal(api.getExperienceRoutePolicy("/pos/portable/ticket").retainData, "none");
  assert.equal(api.getExperienceRoutePolicy("/explore/beauty/user?customerId=private").requiresAuth, true);
  assert.equal(api.getExperienceRoutePolicy("/explore/beauty/user?customerId=private").retainData, "memory");
  assert.equal(api.getExperienceRoutePolicy("/new-unreviewed-feature").classified, false);
  assert.equal(api.getExperienceRoutePolicy("/new-unreviewed-feature").retainData, "none");
});

test("keys reject foreign origins, encoded escapes and secret handoffs, then normalize harmless filters", () => {
  for (const href of ["https://foreign.example/explore", "javascript:alert(1)", "//foreign.example/explore", "/explore%2fadmin", "/explore%252fadmin", "/explore\\admin", "/explore?next=%2Fbook%3Ftoken%3Dsecret"]) {
    assert.equal(api.getExperienceRouteKey(href), null, href);
  }
  assert.equal(api.getExperienceRouteKey("/explore/?sort=recent&area=local"), "/explore?area=local&sort=recent");
  assert.equal(api.getExperienceRouteKey("https://app.example/activity?filter=all", "https://app.example"), "/activity?filter=all");
  for (const href of ["/admin/lookup", "/admin/dashboard/detail", "/admin/users/export", "/workspace/open", "/download/windows"]) {
    assert.equal(api.getExperienceRoutePolicy(href).family, "handler", href);
    assert.equal(api.getExperienceRouteKey(href), null, href);
  }
});

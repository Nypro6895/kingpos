import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function route(name, dependencies) {
  const source = readFileSync(`app/api/staff/${name}/route.ts`, "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, Request, Response, URL, performance, require: name => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  } });
  return exports.POST;
}
const id = "11111111-1111-4111-8111-111111111111";
function request(body, origin = "https://app.test") {
  return new Request("https://app.test/api/staff/test", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("appointment customer search uses one scoped RPC and never refreshes the schedule", async () => {
  const calls = [];
  let authenticated = false, denied = false;
  const post = route("create-appointment", {
    "@/lib/supabase/server": {createAuthenticatedSupabaseServerClient: async () => authenticated ? {rpc: async (name, args) => {
      calls.push({name, args});
      return denied ? {error: {message: "Access denied"}} : {data: [{id: "customer", name: "Customer", phone: "5551234567"}]};
    }} : null},
    "next/cache": {revalidatePath: () => assert.fail("Search must not refresh pages")},
  });
  const input = {salonId: id, action: "customers", query: "Customer"};
  assert.equal((await post(request(input, "https://other.test"))).status, 403);
  assert.equal((await post(request(input))).status, 401);
  authenticated = true;
  assert.deepEqual(await (await post(request({...input, query: "C"}))).json(), []);
  assert.equal(calls.length, 0);
  const response = await post(request(input));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json())[0].name, "Customer");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "staff_booking_customer_suggestions");
  assert.equal(calls[0].args.p_salon, id);
  denied = true;
  assert.equal((await post(request(input))).status, 403);
});

test("preference endpoint rejects cross-origin and unauthenticated requests before RPC", async () => {
  let authenticationCalls = 0;
  const post = route("booking-preferences", {
    "@/lib/supabase/server": { createAuthenticatedSupabaseServerClient: async () => { authenticationCalls++; return null; } },
    "next/cache": { revalidatePath: () => assert.fail("Should not invalidate") },
  });
  assert.equal((await post(request({ salonId: id }, "https://other.test"))).status, 403);
  assert.equal((await post(request({ salonId: "bad" }))).status, 400);
  assert.equal(authenticationCalls, 0);
  assert.equal((await post(request({ salonId: id }))).status, 401);
});

test("preference endpoint makes one scoped RPC, returns saved values, and never refreshes the root layout", async () => {
  const calls = [], invalidations = [];
  const post = route("booking-preferences", {
    "@/lib/supabase/server": { createAuthenticatedSupabaseServerClient: async () => ({ rpc: async (name, args) => {
      calls.push({ name, args }); return { data: { ok: true, online: true, notifications: false } };
    } }) },
    "next/cache": { revalidatePath: path => invalidations.push(path) },
  });
  const response = await post(request({ salonId: id, staffId: "another-staff", preference: "notifications", enabled: false }));
  assert.equal((await response.json()).notifications, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "own_staff_booking_preferences");
  assert.equal(calls[0].args.p_salon_id, id);
  assert.equal(calls[0].args.p_online, null);
  assert.equal(calls[0].args.staffId, undefined);
  assert.deepEqual(invalidations, ["/staff/appointments"]);
  assert.ok(response.headers.get("Server-Timing"));
});

test("confirmation endpoint preserves no-show review and explicit acknowledgement", async () => {
  const calls = [];
  const post = route("confirm-booking", {
    "@/app/staff/appointments/actions": { confirmStaffBookingWithReviewAction: async input => {
      calls.push(input);
      return input.acknowledgeNoShow ? { ok: true } : { ok: false, noShowHistory: [{ id: "history" }] };
    } },
  });
  assert.equal((await post(request({ bookingId: id }, "https://other.test"))).status, 403);
  assert.equal((await post(request({ bookingId: id, acknowledgeNoShow: "yes" }))).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await (await post(request({ bookingId: id }))).json()).noShowHistory.length, 1);
  assert.equal((await (await post(request({ bookingId: id, acknowledgeNoShow: true }))).json()).ok, true);
  assert.equal(calls[1].acknowledgeNoShow, true);
});

test("staff no-show endpoint validates origin, sign-in, classification and scoped RPC", async () => {
  let authenticated = false;
  let rejected = false;
  const calls = [], invalidations = [];
  const post = route("report-no-show", {
    "@/lib/supabase/server": { createAuthenticatedSupabaseServerClient: async () => authenticated ? {rpc: async (name, args) => {
      calls.push({name, args});
      return rejected ? {error: {code: "42501", message: "Not assigned"}} : {data: {ok: true, kind: args.p_kind}};
    }} : null },
    "next/cache": {revalidatePath: path => invalidations.push(path)},
  });
  const input = {bookingId: id, kind: "unexcused", reason: ""};
  assert.equal((await post(request(input, "https://other.test"))).status, 403);
  assert.equal((await post(request({...input, kind: "excused"}))).status, 400);
  assert.equal((await post(request(input))).status, 401);
  assert.equal(calls.length, 0);
  authenticated = true;
  rejected = true;
  assert.equal((await post(request(input))).status, 403);
  assert.equal(invalidations.length, 0);
  rejected = false;
  const response = await post(request({...input, kind: "excused", reason: " Called salon ", staffId: "other"}));
  assert.equal((await response.json()).ok, true);
  assert.equal(calls[1].name, "report_assigned_booking_no_show");
  assert.equal(calls[1].args.p_reason, "Called salon");
  assert.equal(calls[1].args.staffId, undefined);
  assert.ok(!invalidations.includes("/"));
});

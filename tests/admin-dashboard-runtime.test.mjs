import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function load(entry, stubs = {}) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "dashboard-fixture", setup(api) {
    api.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "fixture" }));
    for (const name of Object.keys(stubs)) api.onResolve({ filter: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }, () => ({ path: name, namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path] || "export {};", loader: "js" }));
  } }] });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}
const actorId = "00000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000001";
const otherId = "20000000-0000-4000-8000-000000000001";
const authStub = `export async function getCurrentPlatformAdminContext(){return globalThis.__dashboardActor;} export async function requirePlatformAdmin(permission){const actor=globalThis.__dashboardActor;if(!actor?.permissions.includes(permission))throw new Error('Access denied');return actor;}`;
const rpcStub = `export async function callPlatformAdminRpc(...args){return globalThis.__dashboardRpc(...args)}`;

test("drawer details require per-record access and never expose auth IDs or restricted contacts", async () => {
  const route = await load("app/(app)/admin/dashboard/record/route.ts", {
    "next/server": "export const NextResponse={json:(data,init)=>Response.json(data,init)};",
    "@/lib/platform-admin/auth": authStub, "@/lib/platform-admin/rpc": rpcStub,
    "@/lib/platform-admin/users": `export async function getPlatformAdminUserDetail(){return {user:{id:'${requestId}',display_name:'Test user',email:'private@example.invalid',phone:'private',auth_user_id:'secret-auth-id',status:'active',created_at:'2026-10-07',timezone:'America/Chicago'},organization_memberships:[],salon_memberships:[]}}`,
    "@/lib/platform-admin/locations": "export async function getPlatformAdminLocationDetail(){throw new Error('Must not run')}",
    "@/lib/platform-admin/businesses": "export async function getPlatformAdminBusinessDetail(){throw new Error('Must not run')}",
    "@/lib/platform-admin/attention": "export async function getAdminFollowup(){return null} export async function getAdminAccountActivity(){throw new Error('Must not run')}",
    "@/lib/platform-admin/audit": "export async function searchPlatformAdminAuditLogs(){throw new Error('Must not run')}",
    "@/lib/platform-admin/notes": "export async function listPlatformAdminNotes(){throw new Error('Must not run')}",
    "@/lib/platform-admin/workflows": "export async function getAdminDeletionImpact(){throw new Error('Must not run')}",
  });
  const request = id => ({ nextUrl: new URL(`https://local.invalid/admin/dashboard/record?kind=user&id=${id}`) });
  globalThis.__dashboardActor = { userId:actorId, permissions:["admin.dashboard.read"] };
  assert.equal((await route.GET(request(requestId))).status,403);
  globalThis.__dashboardActor.permissions.push("admin.users.read");
  assert.equal((await route.GET(request("invalid"))).status,400);
  const response = await route.GET(request(requestId)); assert.equal(response.status,200);
  assert.match(response.headers.get("cache-control"),/no-store/);
  const body = await response.text(); assert.ok(!body.includes("private@example.invalid")); assert.ok(!body.includes("secret-auth-id")); assert.match(body,/Restricted by your role/);
});

test("overdue queue filtering uses the documented 48-hour review target", async () => {
  const model = await load("lib/admin-dashboard-model.ts");
  const filters = model.parseDashboardFilters({view:"overdue"});
  const row = createdAt => ({id:createdAt,kind:"cases",title:"Review",reference:"CASE",preview:"",status:"new",priority:"normal",createdAt,assignedUserId:null,assignee:null,href:"/admin/reports"});
  const queue = model.filterDashboardQueue([{kind:"cases",error:null,items:[row("2026-10-05T10:00:00Z"),row("2026-10-06T10:00:00Z")]}],filters,actorId,Date.parse("2026-10-07T10:00:00Z"));
  assert.equal(queue.total,1); assert.equal(queue.counts.overdue,1); assert.equal(queue.items[0].createdAt,"2026-10-05T10:00:00Z");
});

test("account row operations enforce kind-specific permissions and pass validated attention reasons", async () => {
  const calls = [];
  globalThis.__dashboardRpc = async (...args) => { calls.push(args); return {}; };
  const actions = await load("app/(app)/admin/dashboard/account-actions.ts", {
    "next/cache": "export function revalidatePath(){}", "@/lib/platform-admin/auth": authStub,
    "@/lib/platform-admin/rpc": rpcStub,
    "@/lib/platform-admin/users": "export async function suspendPlatformAdminUser(){throw new Error('Unexpected access mutation')} export async function restorePlatformAdminUser(){throw new Error('Unexpected access mutation')}",
    "@/lib/platform-admin/locations": "export async function updatePlatformAdminLocationStatus(){throw new Error('Unexpected location mutation')}",
  });
  const form = new FormData(); form.set("target_id", requestId); form.set("kind", "user"); form.set("operation", "mark"); form.set("reason", "Review this account later");
  globalThis.__dashboardActor = { permissions: ["admin.users.read"] };
  assert.equal((await actions.dashboardAccountAction(form)).ok, false); assert.equal(calls.length, 0);
  globalThis.__dashboardActor = { permissions: ["admin.users.update"] };
  assert.equal((await actions.dashboardAccountAction(form)).ok, true);
  assert.deepEqual(calls[0], ["set_platform_admin_attention", { p_target_type: "user", p_target_id: requestId, p_marked: true, p_reason: "Review this account later" }]);
  form.set("kind", "location"); assert.equal((await actions.dashboardAccountAction(form)).ok, false); assert.equal(calls.length, 1);
  form.set("kind", "user"); form.set("operation", "delete"); assert.equal((await actions.dashboardAccountAction(form)).ok, false); assert.equal(calls.length, 1);
  form.set("operation", "unmark"); form.set("target_id", "invalid"); assert.equal((await actions.dashboardAccountAction(form)).ok, false); assert.equal(calls.length, 1);
});

test("combined queues prioritize, de-duplicate linked moderation work, retain its urgency and assignment, and filter before pagination", async () => {
  const model = await load("lib/admin-dashboard-model.ts");
  const row = (id, kind, priority, createdAt, extra = {}) => ({ id, kind, priority, createdAt, title: id, reference: id, preview: "", status: "waiting", assignedUserId: null, assignee: null, href: "/admin", ...extra });
  const sources = [{ kind: "cases", error: null, items: [row("linked", "cases", "urgent", "2026-10-07", { assignedUserId: actorId, assignee: "Alex" }), row("normal", "cases", "normal", "2026-10-01")] }, { kind: "post_safety", error: null, items: [row("safety", "post_safety", "normal", "2026-10-06", { linkedReportId: "linked" })] }, { kind: "claims", error: null, items: [row("old", "claims", "normal", "2026-09-01")] }, { kind: "inbox", error: "unavailable", items: [] }];
  const filters = model.parseDashboardFilters({ pageSize: "10" });
  const queue = model.filterDashboardQueue(sources, { ...filters, pageSize: 1 }, actorId);
  assert.equal(queue.total, 3); assert.equal(queue.counts.urgent, 1); assert.equal(queue.counts.mine, 1);
  assert.equal(queue.items[0].id, "safety"); assert.equal(queue.items[0].assignee, "Alex");
  assert.equal(model.filterDashboardQueue(sources, { ...filters, pageSize: 1, page: 2 }, actorId).items[0].id, "old");
  assert.equal(model.filterDashboardQueue(sources, { ...filters, kind: "cases" }, actorId).total, 2);
  assert.equal(model.filterDashboardQueue(sources, { ...filters, view: "mine" }, actorId).items[0].id, "safety");
  assert.equal(model.filterDashboardQueue(sources, { ...filters, q: "old", page: 99 }, actorId).page, 1);
  assert.equal(model.filterDashboardQueue(sources, filters, actorId).byKind.inbox, undefined);
  assert.equal(sources[0].items[0].priority, "urgent"); assert.equal(sources[1].items[0].priority, "normal");
});

test("dashboard URLs retain filters, clamp inputs and target links respect read permissions", async () => {
  const model = await load("lib/admin-dashboard-model.ts");
  const filters = model.parseDashboardFilters({ page: "-2", pageSize: "999", q: " x ", kind: "bogus", view: "mine", sort: "newest" });
  assert.deepEqual(filters, { page: 1, pageSize: 10, q: "x", kind: "all", view: "mine", sort: "newest" });
  assert.equal(model.dashboardQueueHref(filters, { page: 2 }), "/admin?q=x&view=mine&sort=newest&page=2");
  assert.equal(model.adminAuditTargetHref("platform_admin_user", actorId, []), null);
  assert.equal(model.adminAuditTargetHref("platform_admin_user", actorId, ["admin.users.read"]), `/admin/users/${actorId}`);
  assert.equal(model.formatDashboardWaiting("invalid", Date.now()), "—");
  assert.equal(model.formatDashboardWaiting("2026-10-07T10:00:00Z", Date.parse("2026-10-07T12:30:00Z")), "2h");
});

test("queue aggregation follows every backend page instead of losing work after the first 100 rows", async () => {
  const workspace = await load("lib/platform-admin/dashboard-workspace.ts", {
    react: "export const cache=fn=>fn;", "./auth": authStub, "./rpc": rpcStub,
    "./inbox": "export async function listSupportInbox(){}", "./reports": "export async function searchPlatformAdminReports(){}",
    "./users": "export async function searchPlatformAdminUsers(){}", "@/lib/supabase/server": "export async function createAuthenticatedSupabaseServerClient(){return null}",
  });
  const calls = [];
  const items = await workspace.collectAdminPages(async page => { calls.push(page); return { page, page_size: 100, total: 301, items: Array.from({ length: page === 4 ? 1 : 100 }, (_, i) => (page - 1) * 100 + i) }; });
  assert.equal(items.length, 301); assert.equal(items[300], 300); assert.deepEqual(calls, [1, 2, 3, 4]);
});

test("lazy detail endpoint rejects missing permissions and invalid IDs and redacts sensitive applicant fields", async () => {
  let calls = 0;
  globalThis.__dashboardRpc = async name => { calls++; return name === "get_business_claim_requests" ? [{ id: requestId, salon_id: otherId, status: "waiting", applicant_email: "private@example.invalid", phone: "private", attachments: [] }] : [{ claim_state: "unclaimed" }]; };
  const detail = await load("app/(app)/admin/dashboard/detail/route.ts", {
    "next/server": "export const NextResponse={json:(data,init)=>Response.json(data,init)};",
    "@/lib/platform-admin/auth": authStub, "@/lib/platform-admin/rpc": rpcStub,
    "@/lib/supabase/server": "export async function createAuthenticatedSupabaseServerClient(){return {}}",
    "@/lib/platform-admin/inbox": "export async function getSupportThread(){}",
    "@/lib/platform-admin/reports": "export async function getPlatformAdminReportDetail(){}",
    "@/lib/platform-admin/users": "export async function getPlatformAdminUserDetail(){}",
    "@/lib/platform-admin/notes": "export async function listPlatformAdminNotes(){return {items:[]}}",
    "@/lib/support-email": "export async function getSupportEmailConfig(){};export function supportEmailReady(){return false}",
  });
  const req = id => ({ nextUrl: new URL(`https://local.invalid/admin/dashboard/detail?kind=claims&id=${id}`) });
  globalThis.__dashboardActor = { userId: actorId, permissions: ["admin.dashboard.read"] };
  assert.equal((await detail.GET(req(requestId))).status, 403); assert.equal(calls, 0);
  globalThis.__dashboardActor.permissions.push("admin.locations.read");
  assert.equal((await detail.GET(req("not-a-uuid"))).status, 400); assert.equal(calls, 0);
  const response = await detail.GET(req(requestId));
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const data = await response.json(); assert.equal(data.request.applicant_email, null); assert.equal(data.request.phone, null); assert.equal(data.canApprove, true);
});

async function actionModule() {
  return load("app/(app)/admin/dashboard/actions.ts", {
    "next/cache": "export function revalidatePath(){}", "@/lib/platform-admin/auth": authStub, "@/lib/platform-admin/rpc": rpcStub,
    "@/app/claim/actions": "export async function reviewBusinessClaimAction(){return {error:null}}",
    "@/app/settings/salon-verification-actions": "export async function reviewSalonVerificationAction(){return {error:null}}",
    "@/app/settings/recovery-back-office/actions": "export async function updateRecoveryBackOfficeCaseAction(){return {error:null}};export async function secureRecoveryBackOfficeAccountAction(){return {error:null}}",
    "../actions": "export async function assignAdminReportAction(form){globalThis.__dashboardAssigned.push(Object.fromEntries(form));return {ok:true,message:'Saved'}};export async function updateAdminReportAction(){};export async function resolveAdminReportAction(){};export async function closeAdminReportAction(){};export async function createAdminNoteAction(){}",
    "../workflow-actions": "export async function cancelAdminDeletionAction(){}", "../inbox/actions": "export async function updateSupportThreadAction(){return {ok:true,message:'Saved'}}",
    "@/lib/platform-admin/inbox": "export async function getSupportThread(){return {thread:{status:'new'}}}",
    "@/lib/platform-admin/reports": "export async function getPlatformAdminReportDetail(){return {report:{status:'new'}}}",
    "../post-safety/actions": "export async function reviewPostSafetyAction(){return {ok:true,message:'Saved'}}",
  });
}

test("request-info uses the actual applicant and idempotency key and rejects stale requests", async () => {
  const actions = await actionModule();
  let sent;
  globalThis.__dashboardActor = { userId: actorId, permissions: ["admin.locations.update_status", "admin.notifications.send"] };
  let status = "waiting";
  globalThis.__dashboardRpc = async (name, args) => name === "get_business_claim_requests" ? [{ id: requestId, applicant_user_id: otherId, status }] : (sent = args, { status: "delivered" });
  const form = new FormData();
  for (const [key, value] of Object.entries({ kind: "claims", request_id: requestId, decision: "request_info", user_id: actorId, body: "Please supply proof of ownership.", reason: "Need proof", notification_request_id: actorId })) form.set(key, value);
  assert.equal((await actions.reviewDashboardRequestAction(form)).ok, true);
  assert.equal(sent.p_user_id, otherId); assert.equal(sent.p_request_id, actorId);
  sent = null; status = "approved";
  assert.equal((await actions.reviewDashboardRequestAction(form)).ok, false); assert.equal(sent, null);
  status = "waiting"; globalThis.__dashboardActor.permissions = ["admin.locations.update_status"];
  assert.equal((await actions.reviewDashboardRequestAction(form)).ok, false); assert.equal(sent, null);
});

test("bulk assignment checks all permissions before mutation and uses the current actor's membership", async () => {
  const actions = await actionModule();
  globalThis.__dashboardAssigned = [];
  globalThis.__dashboardActor = { userId: actorId, membershipId: otherId, permissions: ["admin.dashboard.read", "admin.reports.assign"] };
  const form = new FormData(); form.set("assignment", "me"); form.set("reason", "Team follow-up");
  form.set("selection", JSON.stringify([{ id: requestId, kind: "cases" }, { id: otherId, kind: "inbox" }]));
  assert.equal((await actions.dashboardBulkAssignAction(form)).ok, false); assert.equal(globalThis.__dashboardAssigned.length, 0);
  form.set("selection", JSON.stringify([{ id: requestId, kind: "cases" }]));
  assert.equal((await actions.dashboardBulkAssignAction(form)).ok, true);
  assert.equal(globalThis.__dashboardAssigned[0].assigned_membership_id, otherId);
});

test("global search searches only permitted groups and isolates backend failures", async () => {
  const search = await load("app/(app)/admin/dashboard/search/route.ts", {
    "next/server": "export const NextResponse={json:(data,init)=>Response.json(data,init)};", "@/lib/platform-admin/auth": authStub,
    "@/lib/platform-admin/users": "export async function searchPlatformAdminUsers(){return {items:[{id:'u1',display_name:'Alex',status:'active'}]}}",
    "@/lib/platform-admin/businesses": "export async function searchPlatformAdminBusinesses(){throw new Error('offline')}",
    "@/lib/platform-admin/locations": "export async function searchPlatformAdminLocations(){throw new Error('must not query')}",
    "@/lib/platform-admin/reports": "export async function searchPlatformAdminReports(){throw new Error('must not query')}",
    "@/lib/platform-admin/inbox": "export async function listSupportInbox(){throw new Error('must not query')}",
  });
  globalThis.__dashboardActor = { permissions: ["admin.access", "admin.users.read", "admin.businesses.read"] };
  const result = await search.GET({ nextUrl: new URL("https://local.invalid/admin/dashboard/search?q=Alex") });
  const body = await result.json(); assert.equal(result.status, 200); assert.equal(body.groups.length, 2); assert.equal(body.groups[0].items[0].href, "/admin/users/u1"); assert.equal(body.groups[1].unavailable, true);
  assert.deepEqual(await (await search.GET({ nextUrl: new URL("https://local.invalid/admin/dashboard/search?q=x") })).json(), { groups: [] });
});

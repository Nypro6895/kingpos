import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";


const require = createRequire(import.meta.url);
const ts = require("typescript");
const membershipExports = {};
vm.runInNewContext(ts.transpileModule(readFileSync("lib/membership-permissions.ts", "utf8"), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {exports:membershipExports, require(name){assert.equal(name,"./workspace-read-graph");return {currentWorkspaceReadGraph:()=>undefined};}});
const {loadMembershipPermissionCodes}=membershipExports;

export function contextFixture(source = readFileSync("lib/current-context.ts", "utf8"), delayMs = 0, useGraph = false) {
  const calls = [];
  const account = id => ({ id, name: id, status: "active" });
  const salon = { id: "salon", account_id: "business", name: "Salon", status: "active" };
  const rows = {
    account_memberships: [
      { id: "personal-grant", account_id: "personal", user_id: "user", role_id: "personal-owner", status: "active" },
      { id: "business-grant", account_id: "business", user_id: "user", role_id: "business-owner", status: "active" },
    ],
    salon_memberships: [{ id: "salon-grant", account_id: "business", salon_id: "salon", user_id: "user", role_id: "business-owner", status: "active" }],
    accounts: [account("personal"), account("business")],
    roles: ["personal-owner", "business-owner"].map(id => ({ id, code: "OWNER", name: "Owner" })),
    locations: [salon],
    salon_settings: [{ salon_id: "salon", public_profile_logo_path: null }],
    staff: [],
    role_permissions: [
      { role_id: "personal-owner", permission_id: "create" },
      { role_id: "business-owner", permission_id: "staff" },
      { role_id: "business-owner", permission_id: "book" },
    ],
    permissions: [{ id: "create", code: "salons.create" }, { id: "staff", code: "staff.view" }, { id: "book", code: "booking.view" }],
  };
  async function reply(label, data) {
    calls.push(label);
    if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
    return { data, error: null };
  }
  const client = {
    auth: { getUser: () => reply("auth", { user: { id: "auth-user" } }) },
    rpc: name => reply(name, []),
    from(table) {
      let data = rows[table];
      assert.ok(data, `Unexpected table ${table}`);
      const query = {
        select() { return query; },
        eq(column, value) { data = data.filter(row => row[column] === value); return query; },
        in(column, values) { data = data.filter(row => values.includes(row[column])); return query; },
        order() { return query; },
        returns: () => reply(table, data),
      };
      return query;
    },
  };
  const user = { id: "user", status: "active", display_name: "Test" };
  let activeGraph;
  const graphValue=()=>({version:1,userId:"user",bootstrapRequired:false,accountMemberships:rows.account_memberships,salonMemberships:rows.salon_memberships,accounts:rows.accounts,roles:rows.roles,locations:rows.locations,staff:rows.staff.map(({id,salon_id})=>({id,salon_id})),profiles:rows.salon_settings,grants:[]});
  const dependencies = {
    "server-only": {}, "react": { cache: fn => fn },
    "./scoped-business-context": { scopedBusinessContext: () => null },
    "./workspace-read-graph": { currentWorkspaceReadGraph: () => activeGraph, loadWorkspaceReadGraph:async()=>useGraph?graphValue():null, runWithWorkspaceReadGraph:async(value,read)=>{const previous=activeGraph;activeGraph=value;try{return await read();}finally{activeGraph=previous;}} },
    "./read-context-scope": { memoizeReadContext: (_key,load)=>load(), getReusableReadValidationToken:()=>undefined },
    "@/lib/staff-profile": { getStaffProfilePhotoUrl: path => path ? `https://media.test/${path}` : null },
    "@/lib/routes": { routes: { salons: { list: () => "/salons", create: () => "/salons/new" } } },
    "@/lib/membership-permissions": { loadMembershipPermissionCodes },
    "@/lib/salon-lifecycle-rules": { isActiveSalonLifecycle: status => status === "active", isHistoricalSalonLifecycle: status => status !== "active", normalizeSalonLifecycleStatus: status => status || "active" },
    "@/lib/supabase/server": { createUserScopedSupabaseServerClient: () => client },
    "@/lib/supabase/auth-rest": { assertAuthAvailable(error) { if (error) throw error; } },
    "@/lib/salon-profile-media": { normalizeSalonProfileMediaPath: path => path },
    "@/lib/users/account-status": { isDeniedKingUserStatus: status => status === "suspended" },
    "@/lib/users/current-user": { getKingUserForAuthUser: async () => user },
    "next/headers": {},
  };
  const exports = {};
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(outputText, { exports, console, require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return { calls, rows, run: workspace => exports.getCurrentBusinessContext({ accessToken: "test", cookieStore: { get: name => name === "kingpos-selected-workspace" ? { value: workspace } : undefined } }) };
}

test("full owner context batches duplicate grants and keeps personal permissions out of the salon", async () => {
  const fixture = contextFixture();
  const context = await fixture.run("manage:salon");
  assert.equal(context.currentSalon.id, "salon");
  assert.equal(context.currentMembership.id, "salon-grant");
  assert.deepEqual([...context.permissionCodes], ["booking.view", "staff.view"]);
  assert.equal(fixture.calls.filter(table => table === "role_permissions").length, 1);
  assert.equal(fixture.calls.filter(table => table === "permissions").length, 1);
  assert.equal(fixture.calls.filter(table => table !== "auth").length, 11);
});

test("personal stays personal after the context loaders run in parallel", async () => {
  const fixture = contextFixture();
  const context = await fixture.run("personal");
  assert.equal(context.workspaceType, "personal");
  assert.equal(context.currentSalon, null);
  assert.equal(context.permissionCodes.length, 0);
  assert.ok(context.workspaceOptions.some(workspace => workspace.id === "manage:salon"));
});

test("removed workspace selection cannot restore owner access", async () => {
  const context = await contextFixture().run("manage:removed");
  assert.equal(context.workspaceType, "personal");
  assert.equal(context.currentSalon, null);
  assert.equal(context.permissionCodes.length, 0);
});

 test("Staff workspace uses its linked salon profile and suppresses ambiguous identities", async () => {
  const f = contextFixture();
  f.rows.staff.push({ id: "staff", salon_id: "salon", account_user_id: "user", is_active: true, display_name: "Staff-Ny", public_profile_photo_path: "staff/ny.jpg" });
  let context = await f.run("staff:salon");
  assert.equal(context.currentWorkspace.staffDisplayName, "Staff-Ny");
  assert.equal(context.currentWorkspace.staffAvatarUrl, "https://media.test/staff/ny.jpg");
  f.rows.staff[0].public_profile_photo_path = null;
  context = await f.run("staff:salon");
  assert.equal(context.currentWorkspace.staffAvatarUrl, null);
  f.rows.staff.push({ ...f.rows.staff[0], id: "duplicate", display_name: "Other" });
  context = await f.run("staff:salon");
  assert.equal(context.currentWorkspace.staffDisplayName, null);
  assert.equal(context.currentWorkspace.staffAvatarUrl, null);
});

 test("deployed ID-only graph still loads the active self-linked Staff header fields", async()=>{const f=contextFixture(undefined,0,true);f.rows.staff.push({id:"staff",salon_id:"salon",account_user_id:"user",is_active:true,display_name:"Staff-Ny",public_profile_photo_path:"staff/ny.jpg"});const context=await f.run("staff:salon");assert.equal(context.currentWorkspace.staffDisplayName,"Staff-Ny");assert.equal(context.currentWorkspace.staffAvatarUrl,"https://media.test/staff/ny.jpg");assert.equal(f.calls.filter(t=>t==="staff").length,1);});

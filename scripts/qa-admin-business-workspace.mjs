import { build } from "esbuild";
import { chromium } from "playwright-core";
import fs from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const names = [
  "Luna Nail Studio",
  "Bloom Salon",
  "Lumi Beauty Bar",
  "All About Nails",
  "Studio Eleven",
  "Zora Nail Care",
];
const items = names.map((name, i) => ({
  id: id(i + 100),
  name,
  status: i === 4 ? "inactive" : "active",
  created_at: "2026-10-08T15:00:00Z",
  updated_at: "2026-10-08T15:00:00Z",
  address_line1: `${120 + i} State Street`,
  address_line2: null,
  city: "Madison",
  state: "WI",
  postal_code: "53703",
  country: "US",
  phone: "+1 (608) 555-0134",
  account_id: id(90),
  owners:
    i === 3
      ? []
      : [{ id: id(2), name: "Emma Nguyen", contact: "emma@example.test" }],
  creator: { id: id(3), name: "Michael Tran", contact: "michael@example.test" },
  ownership: i === 3 ? "unclaimed" : i === 1 ? "pending" : "claimed",
  verification: i === 1 ? "waiting" : i === 3 ? "none" : "approved",
  needs_review: i === 1,
  marked: i === 0,
  followup_reason: "Confirm business contact details",
  due_at: "2026-10-08T18:00:00Z",
  assignee: "Platform owner",
  overdue: false,
}));
const data = {
  items,
  total: 607,
  page: 1,
  counts: {
    all: 607,
    active: 601,
    new: 3,
    unclaimed: 42,
    review: 8,
    followup: 6,
  },
  cities: ["Madison"],
  reviews: [
    {
      request_id: id(50),
      location_id: items[1].id,
      name: items[1].name,
      kind: "claims",
      label: "Ownership claim",
      created_at: "2026-10-08T12:00:00Z",
      assigned_user_id: null,
      assignee: null,
    },
  ],
  review_total: 1,
  missing_contacts: [],
  missing_contact_total: 0,
  followup_due_total: 1,
  followups: [items[0]],
};
const aliases = {
  "next/link": `export default function Link({href,children,...p}){return <a href={href} {...p}>{children}</a>}`,
  "next/navigation": `export const useSearchParams=()=>new URLSearchParams(window.location.search);export const useRouter=()=>({push:(url)=>{window.__calls.push({navigation:url});history.pushState(null,'',url)},refresh:()=>window.__calls.push({refresh:true})});`,
  "../dashboard/dashboard-detail": `export const DashboardDetailPanel=()=> <div>Review details</div>`,
  "../dashboard/account-actions": `export const dashboardAccountAction=async f=>{window.__calls.push({action:'account',data:Object.fromEntries(f)});return {ok:true,message:'Saved'}};export const saveDashboardFollowupAction=async f=>{window.__calls.push({action:'followup',data:Object.fromEntries(f)});return {ok:true,message:'Saved'}}`,
  "../actions": `export const updateAdminLocationProfileAction=async f=>{window.__calls.push({action:'edit',data:Object.fromEntries(f)});return {ok:true,message:'Saved'}};export const createAdminNoteAction=async f=>{window.__calls.push({action:'note',data:Object.fromEntries(f)});return {ok:true,message:'Saved'}}`,
  "./workspace-actions": `export const takeBusinessReviewAction=async f=>{window.__calls.push({action:'take',data:Object.fromEntries(f)});return {ok:true,message:'Saved'}};export const bulkBusinessFollowupAction=async f=>{window.__calls.push({action:'bulk',data:{ids:f.getAll('ids'),reason:f.get('reason')}});return {ok:true,message:'Saved'}};export const businessStatusAction=async f=>{window.__calls.push({action:'status',data:Object.fromEntries(f)});return {ok:true,message:'Saved'}}`,
};
const entry = `import React from 'react';import {createRoot} from 'react-dom/client';import {BusinessesWorkspace} from './app/(app)/admin/locations/businesses-workspace';import {PLATFORM_ADMIN_PERMISSIONS as P} from './types/platform-admin';window.__calls=[];window.__permissions=Object.values(P);createRoot(document.getElementById('root')).render(<div className="admin-workspace"><aside className="admin-sidebar"><strong className="brand">REYLUMI</strong><nav className="admin-navigation">${["Dashboard", "Users", "Businesses", "Post safety", "Support cases", "Recovery", "Ownership claims", "Salon verification", "Attention", "Notifications", "Support inbox", "Advertising", "Audit log", "Admin team", "Settings"].map((n) => `<a className="admin-nav-link" aria-current="${n === "Businesses" ? "page" : "false"}">${n}</a>`).join("")}</nav><small className="role">Platform Owner</small></aside><div><header className="admin-topbar"><input placeholder="Search users, businesses, cases…"/><span>Platform owner ▾</span></header><main><BusinessesWorkspace data={${JSON.stringify(data)}} permissions={Object.values(P)} actorId="${id(1)}"/></main></div></div>);`;
const result = await build({
  stdin: { contents: entry, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true,
  write: false,
  outdir: "artifacts/admin-business-workspace",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "fixture",
      setup(api) {
        api.onResolve({ filter: /.*/ }, (args) =>
          aliases[args.path]
            ? { path: args.path, namespace: "fixture" }
            : undefined,
        );
        api.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: aliases[args.path],
          loader: "tsx",
          resolveDir: process.cwd(),
        }));
      },
    },
  ],
});
const js = result.outputFiles.find((f) => f.path.endsWith(".js")).text,
  css = result.outputFiles.find((f) => f.path.endsWith(".css")).text;
const base = `*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#fcfdff}button,input,textarea,select{font:inherit}button{background:transparent;border:0}a{color:inherit;text-decoration:none}h1,h2,h3,p,dl,dd{margin:0}fieldset{padding:0;border:0}.admin-workspace{display:grid;grid-template-columns:208px 1fr}.admin-sidebar{height:100vh;position:sticky;top:0;border-right:1px solid #e1e7ee;padding:25px 15px;background:#fff}.brand{color:#f87819;font-size:25px;letter-spacing:1px}.admin-navigation{display:grid;margin-top:30px;gap:5px}.admin-nav-link{padding:10px;border-radius:4px;color:#65748b}.role{position:absolute;bottom:24px;left:25px}.admin-topbar{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e1e7ee;padding:0 25px;background:white}.admin-topbar input{border:1px solid #e1e7ee;border-radius:4px;padding:8px;width:55%;font-size:11px}.admin-topbar span{font-size:11px;color:#697a92}@media(max-width:1000px){.admin-workspace{grid-template-columns:1fr}.admin-sidebar{display:none}}`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/admin/locations/workspace") {
    const b = items.find((b) => b.id === url.searchParams.get("id"));
    res.setHeader("Content-Type", "application/json");
    return res.end(
      JSON.stringify({
        business: b,
        kind: "location",
        id: b.id,
        name: b.name,
        status: b.status,
        createdAt: b.created_at,
        href: `/admin/locations/${b.id}`,
        permissions: globalThis.permissions,
        followup: b.marked
          ? {
              reason: b.followup_reason,
              assigned_user_id: id(1),
              assignee: "Platform owner",
              due_at: b.due_at,
              updated_at: "2026-10-08T16:00:00Z",
            }
          : null,
        assignees: [{ id: id(1), name: "Platform owner" }],
        activity: [
          {
            id: id(60),
            title: "Business created",
            reason: "Business account registration",
            actor: "Michael Tran",
            createdAt: b.created_at,
          },
        ],
        notes: [],
        errors: [],
      }),
    );
  }
  res.end(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${base}\n${css}</style></head><body><div id="root"></div><script>${js.replaceAll("</script>", "<\\/script>")}</script></body></html>`,
  );
});
const p = await build({
  entryPoints: ["types/platform-admin.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
globalThis.permissions = Object.values(
  (
    await import(
      "data:text/javascript;base64," +
        Buffer.from(p.outputFiles[0].text).toString("base64")
    )
  ).PLATFORM_ADMIN_PERMISSIONS,
);
fs.mkdirSync("artifacts/admin-business-workspace", { recursive: true });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1586, height: 992 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/admin/locations`);
  await page
    .getByRole("heading", { name: "Luna Nail Studio", exact: true })
    .waitFor();
  await page.screenshot({
    path: "artifacts/admin-business-workspace/desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Edit Bloom Salon", { exact: true }).click();
  await page
    .getByRole("button", { name: "Save information", exact: true })
    .waitFor();
  await page.locator('input[name="name"]').fill("Bloom Salon Updated");
  await page.locator('textarea[name="reason"]').fill("Correct business name");
  await page
    .getByRole("button", { name: "Save information", exact: true })
    .click();
  await page.getByRole("status").filter({ hasText: "Saved" }).last().waitFor();
  assert.equal(
    (await page.evaluate(() => window.__calls)).find((c) => c.action === "edit")
      .data.location_id,
    items[1].id,
  );
  await page.getByLabel("Disable Bloom Salon", { exact: true }).click();
  await page.locator('textarea[name="reason"]').fill("Temporary closure");
  await page
    .getByRole("button", { name: "Disable business", exact: true })
    .first()
    .click();
  assert.equal(
    (await page.evaluate(() => window.__calls)).filter(
      (c) => c.action === "status",
    ).length,
    0,
  );
  await page.getByRole("button", { name: "Confirm action" }).click();
  await page.getByRole("status").filter({ hasText: "Saved" }).last().waitFor();
  const status = (await page.evaluate(() => window.__calls)).find(
    (c) => c.action === "status",
  );
  assert.equal(status.data.target_id, items[1].id);
  assert.equal(status.data.status, "inactive");
  assert.equal(status.data.expected_status, "active");
  await page.getByLabel("Select Luna Nail Studio", { exact: true }).check();
  await page.getByLabel("Bulk follow-up reason").fill("Check missing contact");
  await page
    .getByRole("button", { name: "Mark for follow-up", exact: true })
    .click();
  await page.getByRole("button", { name: "Confirm action" }).click();
  await page.getByRole("status").filter({ hasText: "Saved" }).last().waitFor();
  assert.deepEqual(
    (await page.evaluate(() => window.__calls)).find((c) => c.action === "bulk")
      .data.ids,
    [items[0].id],
  );
  await page.getByLabel("Status", { exact: true }).selectOption("inactive");
  assert.ok(
    (await page.evaluate(() => window.__calls)).some((c) =>
      c.navigation?.includes("status=inactive"),
    ),
  );
  await page.getByLabel("Close business details").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Details of Luna Nail Studio", { exact: true }).click();
  await page
    .getByRole("heading", { name: "Luna Nail Studio", exact: true })
    .waitFor();
  await page.screenshot({
    path: "artifacts/admin-business-workspace/mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await page.getByLabel("Business details", { exact: true }).count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Business UI: desktop/mobile, edit, confirmed status, bulk follow-up, filters and Escape passed.",
  );
} finally {
  await browser.close();
  server.close();
}

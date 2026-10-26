// Local-only visual QA harness. Renders the actual dashboard components with isolated
// fixtures; never authenticates against or mutates the application's database.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const port = Number(process.env.DASHBOARD_QA_PORT || 3107);
const root = process.cwd();
const id = n => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000001`;
const now = "2026-10-07T16:30:00.000Z";
const permissions = ["access", "dashboard.read", "users.read", "users.read_sensitive", "users.delete", "users.suspend", "businesses.read", "businesses.update", "locations.read", "locations.update_status", "notes.read", "notes.create", "reports.read", "reports.assign", "reports.update", "reports.resolve", "reports.create", "inbox.read", "inbox.reply", "inbox.manage", "notifications.read", "notifications.send", "audit.read", "recovery.read", "recovery.manage"].map(value => `admin.${value}`);
const actor = { userId: id(1), membershipId: id(2), roleName: "Platform Owner", roleSlug: "platform_owner", roleId: id(3), permissions };
const requests = [
  { id: id(10), kind: "claims", title: "Luna Nail Studio", preview: "Madison, WI · Emma Nguyen", status: "waiting", priority: "normal", createdAt: "2026-10-07T14:00:00Z", href: "/admin/claims?status=waiting" },
  { id: id(11), kind: "inbox", title: "Customer message #1042", preview: "Can you help me update my salon profile?", status: "new", priority: "normal", createdAt: "2026-10-07T15:55:00Z", assignedUserId: id(1), assignee: "You", href: `/admin/inbox/${id(11)}` },
  { id: id(12), kind: "verification", title: "Bloom Salon", preview: "Milwaukee, WI · Application 1", status: "waiting", priority: "normal", createdAt: "2026-10-07T12:30:00Z", href: "/admin/verification?status=waiting" },
  { id: id(13), kind: "post_safety", title: "Reported post · inappropriate content", preview: "User report · beauty post", status: "pending", priority: "normal", createdAt: "2026-10-07T15:30:00Z", linkedReportId: id(14), href: "/admin/post-safety?origin=user" },
  { id: id(14), kind: "cases", title: "Reported post #208", preview: "Post safety", status: "new", priority: "high", createdAt: "2026-10-07T15:30:00Z", assignedUserId: id(1), assignee: "You", href: `/admin/reports/${id(14)}` },
  { id: id(15), kind: "cases", title: "Business profile correction", preview: "Lumi Beauty Bar", status: "under_review", priority: "normal", createdAt: "2026-10-07T16:00:00Z", href: `/admin/reports/${id(15)}` },
  { id: id(16), kind: "pending_deletion", title: "Taylor Chen", preview: "Account in its deletion grace period", status: "pending_deletion", priority: "normal", createdAt: "2026-10-07T15:00:00Z", href: `/admin/users/${id(16)}` },
  { id: id(17), kind: "recovery", title: "Lost access to account", preview: "Account recovery · low risk", status: "open", priority: "normal", createdAt: "2026-10-07T16:15:00Z", href: `/admin/recovery?case=${id(17)}` },
].map(row => ({ reference: row.id.slice(0, 8), assignedUserId: null, assignee: null, ...row }));
const sources = () => ["inbox", "claims", "verification", "cases", "post_safety", "pending_deletion", "recovery"].map(kind => ({ kind, error: null, items: requests.filter(row => row.kind === kind) }));
const overview = { users: { total: 4, active: 4, suspended: 0, new_30d: 1 }, businesses: { total: 610, by_status: { active: 610 } }, locations: { total: 607, by_status: { active: 607 } }, reports: { open: 2, urgent_or_high: 1, assigned_to_me: 1 }, recent_audit: [] };
const audits = [
  { action: "platform_admin.report.resolved", target_type: "platform_admin_report", target_id: id(15), reason: "Reviewed the submitted information", before_data: { status: "under_review" }, after_data: { status: "resolved" } },
  { action: "support.thread.updated", target_type: "support_inbox", target_id: id(11), reason: null, before_data: { status: "new" }, after_data: { status: "in_progress" } },
  { action: "twilio.settings.update", target_type: "system", target_id: null, reason: "Updated settings", before_data: {}, after_data: { enabled: true } },
].map((row, i) => ({ id: id(30 + i), actor_user_id: id(1), actor: { id: id(1), display_name: "Alex" }, created_at: `2026-10-07T${16 - i}:10:00Z`, metadata: {}, request_id: null, ...row }));
function detail(kind, requestId) {
  const row = requests.find(row => row.id === requestId && row.kind === kind);
  if (!row) return null;
  const base = { kind, permissions };
  if (kind === "claims" || kind === "verification") return { ...base, canApprove: true, latest: true, notes: [], request: { id: row.id, salon_id: id(50), salon_name: row.title, applicant_user_id: id(51), applicant_name: "Emma Nguyen", applicant_email: "emma@example.invalid", phone: "+1 555 0100", address: "123 Main Street, Madison, WI", created_at: row.createdAt, submitted_at: row.createdAt, status: row.status, attempt: 1, channel: "support", phone_verified_at: now, attachments: [{ path: "registration.pdf", name: "registration.pdf" }], support_reason: "I manage this business and have attached our registration.", events: [], decisions: [] } };
  if (kind === "inbox") return { ...base, emailReady: true, emailFrom: "support@example.invalid", detail: { assignee: row.assignee, thread: { id: row.id, customer_name: "Emma Nguyen", customer_email: "emma@example.invalid", message: row.preview, status: row.status, assigned_user_id: row.assignedUserId, created_at: row.createdAt, updated_at: now }, messages: [] } };
  if (kind === "cases") return { ...base, detail: { report: { id: row.id, report_number: "CASE-024", summary: row.title, description: "The business owner requested a correction to their listing.", status: row.status, priority: row.priority, assigned_membership_id: null, created_at: row.createdAt, resolution: null }, subject: { id: id(50), type: "location", label: "Lumi Beauty Bar" }, notes: [], timeline: [], assignee: null, reporter: null }, assignees: [{ id: actor.membershipId, name: "Alex", role: "Platform Owner" }] };
  if (kind === "post_safety") return { ...base, detail: { id: row.id, reason: "inappropriate_content", source_type: "beauty_post", source_id: id(60), origin: "user", created_at: row.createdAt, author_user_id: id(51), platform_report_id: row.linkedReportId, matched_keywords: [], content_snapshot: { caption: "A customer reported this post. Inspect the context before making a decision." }, status: row.status }, mediaUrls: [] };
  if (kind === "pending_deletion") return { ...base, detail: { user: { id: row.id, display_name: row.title, status: row.status, deletion_requested_at: row.createdAt, deletion_scheduled_for: "2026-11-06T15:00:00Z" }, organization_memberships: [], salon_memberships: [], related_reports: [] } };
  return { ...base, detail: { id: row.id, user_id: id(51), request_type: "lost_access", status: row.status, priority: row.priority, risk_level: "low", assigned_to_user_id: null, details: "Cannot access the original sign-in email.", resolution_summary: null, contact_email: null, contact_phone: null, created_at: row.createdAt }, events: [] };
}
const fixtureData = `export const actor=${JSON.stringify(actor)};export async function requirePlatformAdmin(){return actor}export async function getPlatformAdminDashboard(){return ${JSON.stringify(overview)}};export async function loadAdminDashboardWorkspace(){return (await fetch('/qa/sources')).json()};export async function searchPlatformAdminAuditLogs(){return {items:${JSON.stringify(audits)}}};`;
const actionExports = ["reviewDashboardRequestAction", "dashboardCaseAction", "dashboardCancelDeletionAction", "dashboardLocationNoteAction", "dashboardRecoveryAction", "dashboardSafetyAction", "dashboardBulkAssignAction", "updateSupportThreadAction", "resolveSupportDeliveryAction", "addSupportNoteAction", "sendSupportReplyAction", "sendAdminNotificationAction"];
const actions = actionExports.map(name => `export async function ${name}(form){return (await fetch('/qa/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'${name}',data:Object.fromEntries(form)})})).json()}`).join("\n");
const aliases = {
  "@/lib/platform-admin/auth": fixtureData, "@/lib/platform-admin/dashboard": fixtureData,
  "@/lib/platform-admin/dashboard-workspace": fixtureData, "@/lib/platform-admin/audit": fixtureData,
  "next/link": `import React from 'react';export default function Link({href,children,prefetch,scroll,...props}){return React.createElement('a',{href,...props,onClick:e=>{props.onClick?.(e);if(!e.defaultPrevented && !e.ctrlKey && !e.metaKey && String(href).startsWith('/')){e.preventDefault();history.pushState({},'',href);window.dispatchEvent(new Event('dashboard:navigate'))}}},children)}`,
  "next/form": `import React from 'react';export default function Form(props){return React.createElement('form',props)}`,
  "next/image": `import React from 'react';export default function Image({unoptimized,priority,fill,...props}){return React.createElement('img',props)}`,
  "next/navigation": `import {useSyncExternalStore} from 'react';const subscribe=fn=>{window.addEventListener('dashboard:navigate',fn);return ()=>window.removeEventListener('dashboard:navigate',fn)};function navigate(href){history.pushState({},'',href);window.dispatchEvent(new Event('dashboard:navigate'))}export function useRouter(){return {push:navigate,replace:navigate,refresh:()=>window.dispatchEvent(new Event('dashboard:navigate'))}}export function usePathname(){return useSyncExternalStore(subscribe,()=>location.pathname)};`,
};
const actionPaths = new Set(["app/(app)/admin/dashboard/actions", "app/(app)/admin/inbox/actions", "app/(app)/admin/workflow-actions"].map(file => path.resolve(root, file)));
const attachmentPaths = new Set(["app/claim/actions", "app/settings/salon-verification-actions"].map(file => path.resolve(root, file)));
const result = await build({ stdin: { resolveDir: root, sourcefile: "dashboard-preview.tsx", loader: "tsx", contents: `import React from 'react';import {createRoot} from 'react-dom/client';import AdminPage from './app/(app)/admin/page';import {AdminShell} from './app/(app)/admin/_components/admin-ui';import {actor} from '@/lib/platform-admin/auth';const root=createRoot(document.getElementById('root'));async function render(){const params=Object.fromEntries(new URLSearchParams(location.search));const page=await AdminPage({searchParams:Promise.resolve(params)});root.render(<><div style={{position:'fixed',right:12,bottom:8,zIndex:100,fontSize:10,color:'#64748b',background:'#fff',padding:4}}>QA preview · Simulated data and actions</div><AdminShell context={actor} counts={{'/admin/inbox':1,'/admin/claims':1,'/admin/verification':1,'/admin/post-safety':1}}>{page}</AdminShell></>)}window.addEventListener('dashboard:navigate',render);window.addEventListener('popstate',render);render();` }, bundle: true, write: false, format: "iife", platform: "browser", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "qa-stubs", setup(api) {
  api.onResolve({ filter: /.*/ }, args => {
    if (aliases[args.path]) return { path: args.path, namespace: "fixture" };
    const absolute = args.path.startsWith("@/") ? path.resolve(root, args.path.slice(2)) : path.resolve(args.resolveDir, args.path);
    if (actionPaths.has(absolute)) return { path: "actions", namespace: "fixture" };
    if (attachmentPaths.has(absolute)) return { path: "attachments", namespace: "fixture" };
    if (args.path === "server-only") return { path: "empty", namespace: "fixture" };
  });
  api.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "js", resolveDir: root, contents: args.path === "actions" ? actions : args.path === "attachments" ? "export async function reviewBusinessClaimAction(){return {error:null}};export async function businessClaimAttachmentAction(){return '/qa/document'};export async function salonVerificationAttachmentAction(){return '/qa/document'};" : aliases[args.path] || "export {};" }));
} }] });
const js = result.outputFiles[0].text;
// Reuse the dev server's generated Tailwind stylesheet, avoiding a second app build.
const stylesDir = ".next/dev/static/css/app";
const styleFiles = [];
function visit(directory) { if (!fs.existsSync(directory)) return; for (const item of fs.readdirSync(directory, { withFileTypes: true })) { const file = path.join(directory, item.name); if (item.isDirectory()) visit(file); else if (file.endsWith(".css")) styleFiles.push(file); } }
visit(stylesDir);
const tailwind = styleFiles.map(file => fs.readFileSync(file, "utf8")).filter(css => css.includes(".lg\\:pl-64") || css.includes("tailwindcss")).slice(0, 1).join("\n");
const fallback = `*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}a{color:inherit;text-decoration:none}button,input,textarea,select{font:inherit}button{border:0;background:transparent}h1,h2,h3,p,dl,dd{margin:0}fieldset{border:0;padding:0;margin:0}.sr-only{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip:rect(0,0,0,0)}.admin-workspace>aside{position:fixed;inset:0 auto 0 0;width:256px;padding:20px 16px;border-right:1px solid #e3e8ee;background:white}.admin-workspace>aside>a:first-child{display:block}.admin-workspace>aside>a:first-child img{width:144px;height:auto}.admin-workspace>aside>a:first-child span{display:block;font-size:11px;color:#64748b;margin-top:5px}.admin-navigation{display:grid}.admin-navigation>div>p{font-size:10px;color:#64748b;padding:0 12px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.08em}.admin-nav-link{display:flex;gap:12px;align-items:center;padding:10px 12px;font-size:12px}.admin-nav-link svg{width:18px;height:18px}.admin-workspace>div{padding-left:256px}.admin-workspace main{max-width:1440px;margin:auto;padding:32px}@media(min-width:1024px){.admin-workspace>div>header{display:none}}.hidden{display:none}.grid{display:grid;gap:12px}.flex{display:flex;gap:8px}.text-sm{font-size:12px}.text-xs{font-size:11px}.text-zinc-500{color:#64748b}.rounded-lg{border-radius:5px}.border{border:1px solid #d7dfe8}.p-2{padding:8px}.p-3{padding:12px}.p-4{padding:16px}.bg-white{background:white}.bg-zinc-950{background:#00848e}.text-white{color:white}@media(max-width:1023px){.admin-workspace>div{padding-left:0}.admin-workspace>aside{display:none}.admin-workspace main{padding:24px 16px}}`;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const send = (type, body) => { res.setHeader("Content-Type", type); res.setHeader("Cache-Control", "no-store"); res.end(body); };
  if (url.pathname === "/preview.js") return send("text/javascript", js);
  if (url.pathname === "/preview.css") return send("text/css", `${fallback}\n${tailwind}\n${fs.readFileSync("app/(app)/admin/admin.css", "utf8")}`);
  if (url.pathname === "/qa/sources") return send("application/json", JSON.stringify(sources()));
  if (url.pathname === "/admin/dashboard/detail") { const result = detail(url.searchParams.get("kind"), url.searchParams.get("id")); if (!result) res.statusCode = 404; return send("application/json", JSON.stringify(result || { error: "Request not found." })); }
  if (url.pathname === "/admin/dashboard/search" || url.pathname === "/admin/lookup") return send("application/json", JSON.stringify({ groups: [{ label: "Users", items: [{ id: id(51), label: "Emma Nguyen", detail: "active", href: `/admin/users/${id(51)}` }], unavailable: false }], items: [{ id: id(51), label: "Emma Nguyen" }] }));
  if (url.pathname === "/qa/action" && req.method === "POST") {
    let body = ""; for await (const chunk of req) body += chunk;
    const { name, data } = JSON.parse(body);
    const row = requests.find(row => row.id === (data.request_id || data.report_id || data.user_id || data.caseId || data.thread_id));
    if (row && ((name === "reviewDashboardRequestAction" && data.decision !== "request_info") || name === "dashboardCancelDeletionAction" || name === "dashboardSafetyAction" || name === "dashboardCaseAction" && ["resolve", "close"].includes(data.operation))) { const at = requests.indexOf(row); requests.splice(at, 1); }
    if (row && name === "updateSupportThreadAction") { row.status = data.status; if (data.assignment === "me") { row.assignedUserId = actor.userId; row.assignee = "You"; } if (data.assignment === "unassign") { row.assignedUserId = null; row.assignee = null; } }
    return send("application/json", JSON.stringify({ ok: true, message: "QA action saved. No real account or message was changed." }));
  }
  if (url.pathname.startsWith("/brand/")) { const file = path.resolve(root, "public", url.pathname.slice(1)); if (file.startsWith(path.resolve(root, "public") + path.sep) && fs.existsSync(file)) return send("image/png", fs.readFileSync(file)); }
  if (url.pathname === "/qa/document") return send("text/html", "<h1>QA document</h1><p>Mock attachment. No real business evidence.</p>");
  send("text/html", '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin dashboard QA preview</title><link rel="stylesheet" href="/preview.css"></head><body><div id="root"></div><script src="/preview.js"></script></body></html>');
});
server.listen(port, "127.0.0.1", () => console.log(`Dashboard QA preview: http://127.0.0.1:${port}/admin`));

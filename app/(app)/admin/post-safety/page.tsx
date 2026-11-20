import { withExperiencePage } from "@/components/experience-page";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS } from "@/lib/platform-admin/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { AdminActionForm } from "../_components/action-form";
import { saveSafetyKeywordAction } from "./actions";

import {loadAdminPostReviewWorkspace} from "@/lib/platform-admin/post-safety";
import {PostReviewWorkspace} from "./review-workspace";

async function PostSafetyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await requirePlatformAdmin(PLATFORM_ADMIN_PERMISSIONS.reportsRead);
  const params = await searchParams;
  const reviewParams=Object.fromEntries(Object.entries(params).map(([key,value])=>[key,typeof value === "string" ? value : undefined]));
  const origin = params.origin === "automatic" ? "automatic" : "user";
  const client = await createAuthenticatedSupabaseServerClient();
  const [cases, keywords] = await Promise.all([
    loadAdminPostReviewWorkspace(origin, typeof params.case === "string" && /^[0-9a-f-]{36}$/i.test(params.case) ? params.case : undefined, undefined, reviewParams).then(data => ({data,error:null})).catch(() => ({data:null,error:"Unable to load the review queue."})),
    client?.from("post_safety_keywords").select("*").order("category"),
  ]);
  // Mutations also enforce permissions inside the database.
  const canReview = context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.reportsUpdate);
  return <div className="grid gap-5">
    {cases.error || !cases.data ? <div role="alert" className="rounded-lg border p-4">The review queue could not be loaded. Refresh this page to try again.</div> : <PostReviewWorkspace key={JSON.stringify(reviewParams)} data={cases.data} origin={origin} initialCaseId={typeof params.case === "string" ? params.case : undefined} initialParams={reviewParams} viewerId={context.userId} canReview={canReview} canSuspend={context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.usersSuspend)} canContact={context.permissions.includes(PLATFORM_ADMIN_PERMISSIONS.notificationsSend)}/>}
    {origin === "automatic" ? <section className="grid gap-3 rounded-xl border bg-white p-5"><h2 className="font-semibold">Keyword rules</h2><p className="text-sm text-zinc-500">Text matching flags possible violations for human review. It does not analyze images. New rules apply when posts are created or edited.</p>
      <div className="flex flex-wrap gap-2">{keywords?.data?.map(rule => <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs" key={rule.id}>{rule.phrase} · {rule.category} · {rule.enabled ? "On" : "Off"}</span>)}</div>
      {canReview ? <AdminActionForm action={saveSafetyKeywordAction} className="flex flex-wrap items-center gap-3"><input required minLength={3} maxLength={100} name="phrase" aria-label="Keyword or phrase" placeholder="Keyword or phrase" className="rounded-lg border p-2"/><select name="category" aria-label="Rule category" className="rounded-lg border p-2">{["violence", "sexual", "harassment", "scam", "minor_safety"].map(value => <option key={value}>{value}</option>)}</select><label><input name="enabled" type="checkbox" defaultChecked/> Enabled</label><button className="rounded-lg bg-zinc-950 px-4 py-2 text-white">Save rule</button></AdminActionForm> : null}
    </section> : null}
  </div>;
}

export default withExperiencePage(PostSafetyPage, { admin: true });

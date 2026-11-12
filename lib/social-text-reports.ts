import "server-only";
import type { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { SocialTextReportTarget } from "@/types/social-text-reports";

type Client = NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const kinds = new Set(["comment", "review", "experience", "review_reply", "experience_reply", "own_review_reply", "own_experience_reply"]);

export async function submitSocialTextReport(client: Client, input: {
  target: SocialTextReportTarget; requestId: string; reason: string;
}) {
  const target = input?.target;
  if (!target || !kinds.has(target.kind) || typeof target.id !== "string" || !uuid.test(target.id)
      || typeof input.requestId !== "string" || !uuid.test(input.requestId)
      || typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 1000)
    throw Error("Please choose the content and enter a reason of 3–1000 characters.");
  let path = "/explore";
  if (target.kind === "comment") {
    // Authenticated RLS, never a service-role query or a caller-supplied author.
    const { data, error } = await client.from("salon_profile_comments")
      .select("id,salon_id,look_id,update_id,beauty_post_id,status").eq("id", target.id).eq("status", "published").maybeSingle();
    if (error || !data) throw Error("This content is unavailable.");
    if (data.salon_id) path = `/explore/salons/${data.salon_id}#comment-${data.id}`;
  } else if (target.kind.startsWith("own_")) {
    // A customer's own history can include an unpublished salon. Preserve its
    // existing actor-scoped access instead of requiring a public projection.
    const {data, error} = await client.rpc("get_my_visit_experiences", {p_limit:11,p_offset:0,p_experience:target.id});
    const source = target.kind === "own_review_reply" ? "legacy_review" : "experience";
    const rows = Array.isArray(data) ? data as Array<{id:string;source:string;reply_body:string|null}> : [];
    if (error || !rows.some(row => row.id === target.id && row.source === source && !!row.reply_body)) throw Error("This content is unavailable.");
    path = `/more/reviews?experience=${target.id}`;
  } else {
    if (typeof target.salonId !== "string" || !uuid.test(target.salonId)) throw Error("This content is unavailable.");
    // The existing public projection enforces salon visibility and blocks, even
    // for reply tables that intentionally have no direct client grants.
    const { data, error } = await client.rpc("get_public_salon_profile_experiences", { target_salon_id: target.salonId });
    const rows = Array.isArray(data) ? data as Array<{id:string;source:string;reply_id:string|null;reply_body:string|null}> : [];
    const reply = target.kind.endsWith("_reply");
    const source = target.kind.startsWith("review") ? "legacy_review" : "experience";
    const row = rows.find(row => row.source === source && (reply ? row.reply_id === target.id && !!row.reply_body : row.id === target.id));
    if (error || !row) throw Error("This content is unavailable.");
    path = `/explore/salons/${target.salonId}#experience-${row.id}`;
  }
  const { data: reportId, error } = await client.rpc("submit_user_support_case", {
    p_request_id: input.requestId, p_category: "review_dispute",
    p_summary: target.kind.startsWith("own_") ? "Report salon reply" : `Report ${target.kind.replaceAll("_", " ")}`,
    p_message: `Content: ${target.kind} ${target.id}\nReason: ${input.reason.trim()}`,
    p_context: { path, module: "social_content_report", content_type: target.kind, content_id: target.id },
  });
  if (error || typeof reportId !== "string" || !uuid.test(reportId)) throw Error("Your report could not be sent. Please retry.");
  return { supportHref: `/support/${reportId}` };
}

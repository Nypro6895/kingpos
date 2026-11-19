import "server-only";
import { createHash } from "node:crypto";
import { AD_REPORT_REASONS, type AdAdmissionTrace, type AdDisclosureActor, type AdDisclosureProofPayload, type AdKind, type AdReportReceipt, type AdReportSubmission, type AdSelectionDisclosure } from "@/types/ad-disclosure";
import { adDisclosureScope, adReportActorKey, readAdDisclosureProof, sealAdDisclosureProof } from "@/lib/ad-disclosure-ticket";

export const AD_REPORT_COOKIE = { owner_campaign: "reylumi-owner-ad-report", platform_campaign: "reylumi-platform-ad-report" } as const;
export const AD_REPORT_HEADERS = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export async function readAdRequestJson(request: Request, limit = 40000): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";",1)[0].trim().toLowerCase() !== "application/json" || Number(request.headers.get("content-length")) > limit) throw new Error("Invalid ad request.");
  const reader=request.body?.getReader(); if (!reader) throw new Error("Invalid ad request.");
  const chunks:Uint8Array[]=[]; let bytes=0;
  try { while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>limit){await reader.cancel();throw new Error("Invalid ad request.");}chunks.push(chunk.value);} }
  finally {reader.releaseLock();}
  const body=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(body));
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function reportActor(userId: string | null, cookie: string | undefined): AdDisclosureActor | null {
  if (userId) return UUID.test(userId) ? { kind: "user", id: userId } : null;
  return cookie && UUID.test(cookie) ? { kind: "guest", id: cookie } : null;
}
export function createAdDisclosure(payload: AdDisclosureProofPayload, actor: AdDisclosureActor): AdSelectionDisclosure {
  return { kind: payload.target.kind, selectionId: payload.selectionId, selectedAt: payload.snapshot.selectedAt,
    ...payload.disclosure, reportScope: adDisclosureScope(actor, payload.target.kind), proof: sealAdDisclosureProof(payload, actor) };
}
export function parseAdReportSubmission(value: unknown): AdReportSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid ad report.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join("|") !== ["requestId", "kind", "proof", "reason", "details"].sort().join("|") ||
      typeof input.requestId !== "string" || !UUID.test(input.requestId) || !["owner_campaign", "platform_campaign"].includes(String(input.kind)) ||
      typeof input.proof !== "string" || input.proof.length > 33000 || !AD_REPORT_REASONS.includes(input.reason as AdReportSubmission["reason"]) ||
      typeof input.details !== "string" || input.details.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.details)) throw new Error("Invalid ad report.");
  return input as AdReportSubmission;
}
type RpcResult = { data: unknown; error: { code?: string } | null };
type Dependencies = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
  admit: () => Promise<unknown>;
  now?: number;
  secret?: string;
};
export type AdReportResult = { ok: true; receipt: AdReportReceipt; supportHref: string | null } |
  { ok: false; outcome: "rejected" | "unknown"; error: string };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function receipt(value: unknown): AdReportReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid receipt");
  const row = value as Record<string, unknown>;
  if (typeof row.reportId !== "string" || !UUID.test(row.reportId) || typeof row.reference !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(row.reference) || row.guestThreadId !== null) throw new Error("Invalid receipt");
  return { reportId: row.reportId, reference: row.reference, guestThreadId: null };
}
/** Authenticates the frozen selection first; a completed exact replay precedes new admission/expiry. */
export async function submitAdReport(input: AdReportSubmission, actor: AdDisclosureActor, deps: Dependencies): Promise<AdReportResult> {
  let payload: AdDisclosureProofPayload;
  try { parseAdReportSubmission(input); payload = readAdDisclosureProof(input.proof, input.kind, actor, { now: deps.now, secret: deps.secret, allowExpired: true }); }
  catch { return { ok: false, outcome: "rejected", error: "This ad selection could not be verified. Reload the page before starting a new report." }; }
  const actorKey = adReportActorKey(actor, { secret: deps.secret });
  const hash = createHash("sha256").update(canonical({ target: payload.target, snapshot: payload.snapshot, summary: payload.summary, reason: input.reason, details: input.details })).digest("hex");
  const common = { p_request_id: input.requestId, p_actor_user_id: actorKey.actorUserId, p_guest_actor_key: actorKey.guestActorKey, p_payload_sha256: hash };
  const success = (value: unknown): AdReportResult => { const saved = receipt(value); return { ok: true, receipt: saved, supportHref: actor.kind === "user" ? `/support/${saved.reportId}` : null }; };
  try {
    const existing = await deps.rpc("get_verified_ad_report_receipt", common);
    if (existing.error) return { ok: false, outcome: ["22023", "42501"].includes(existing.error.code ?? "") ? "rejected" : "unknown", error: "Report status could not be checked. Retry this same report." };
    if (existing.data) return success(existing.data);
  } catch { return { ok: false, outcome: "unknown", error: "Report status could not be checked. Retry this same report." }; }
  if (payload.expiresAt <= (deps.now ?? Date.now())) return { ok: false, outcome: "rejected", error: "This ad selection has expired. Reload the page before starting a new report." };
  try { await deps.admit(); }
  catch { return { ok: false, outcome: "rejected", error: "The security check could not admit this report. Try again or visit /security-check." }; }
  try {
    const result = await deps.rpc("submit_verified_ad_report", { ...common, p_target: payload.target, p_snapshot: payload.snapshot, p_summary: payload.summary, p_reason: input.reason, p_details: input.details });
    if (result.error) return { ok: false, outcome: ["22023", "42501", "P0001", "PT429"].includes(result.error.code ?? "") ? "rejected" : "unknown", error: "The report was not confirmed. Retry this same report or check Support." };
    return success(result.data);
  } catch { return { ok: false, outcome: "unknown", error: "The report was not confirmed. Retry this same report." }; }
}
export function safeAdDestination(href: string): string | null {
  const pathname = href.split(/[?#]/, 1)[0];
  return /^\/(?!\/)[a-zA-Z0-9_/-]*$/.test(pathname) && pathname.length <= 512 ? pathname : null;
}
export function selectionActor(kind: AdKind, userId: string | null, cookie: string | undefined) {
  const guestId = userId ? undefined : reportActor(null, cookie)?.id ?? crypto.randomUUID();
  return { actor: reportActor(userId, guestId)!, cookieName: AD_REPORT_COOKIE[kind], guestId };
}
/** Only own-session counters and redacted repeat decisions can enter the public disclosure. */
export function withAdAdmissionTrace(payload: AdDisclosureProofPayload, value: unknown): AdDisclosureProofPayload {
  const trace=value as AdAdmissionTrace;
  const exact=(v:unknown,keys:string[])=>v&&typeof v==="object"&&!Array.isArray(v)&&Object.keys(v).sort().join("|")===keys.sort().join("|");
  const count=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=1000000;
  if (!exact(trace,["version","admittedAt","limits","session","popup","repeat"])||trace.version!==1||typeof trace.admittedAt!=="string"||!Number.isFinite(Date.parse(trace.admittedAt))||
    !exact(trace.limits,["maxTotal","maxPopups","minPopupGapSeconds","sessionMinutes"])||!Object.values(trace.limits).every(count)||trace.limits.sessionMinutes<1||
    !exact(trace.session,["viewsBefore","reservationsBefore","totalBefore","sameCampaignViewed"])||![trace.session.viewsBefore,trace.session.reservationsBefore,trace.session.totalBefore].every(count)||trace.session.sameCampaignViewed!==false||trace.session.totalBefore!==trace.session.viewsBefore+trace.session.reservationsBefore||
    !exact(trace.popup,["applicable","viewsBefore","reservationsBefore","totalBefore","priorPopupAt","gapSatisfied"])||typeof trace.popup.applicable!=="boolean"||
    !exact(trace.repeat,["rule","checked","eligible","historyScope","timeZone"])||!["always","once","daily"].includes(trace.repeat.rule)||typeof trace.repeat.checked!=="boolean"||trace.repeat.eligible!==true||trace.repeat.historyScope!=="visitor_key_may_be_shared_network"||trace.repeat.timeZone!=="America/Chicago") throw new Error("Display trace unavailable.");
  if(trace.popup.applicable ? ![trace.popup.viewsBefore,trace.popup.reservationsBefore,trace.popup.totalBefore].every(count)||trace.popup.totalBefore!==Number(trace.popup.viewsBefore)+Number(trace.popup.reservationsBefore)||trace.popup.gapSatisfied!==true||trace.popup.priorPopupAt!==null&&!Number.isFinite(Date.parse(trace.popup.priorPopupAt)) : [trace.popup.viewsBefore,trace.popup.reservationsBefore,trace.popup.totalBefore,trace.popup.priorPopupAt,trace.popup.gapSatisfied].some(v=>v!==null)) throw new Error("Display trace unavailable.");
  const admittedAt=new Date(trace.admittedAt).toISOString(),now=Date.now();
  const details=[...payload.disclosure.details,
    {label:"Display admitted at",value:admittedAt},
    {label:"This display session before this promotion",value:trace.session.viewsBefore+" confirmed views and "+trace.session.reservationsBefore+" active display reservations; "+trace.session.totalBefore+" in total. This promotion had not been viewed in this session."},
    {label:"Limits checked at display admission",value:"Up to "+trace.limits.maxTotal+" promotions and "+trace.limits.maxPopups+" popups per display session; at least "+trace.limits.minPopupGapSeconds+" seconds between popups. Configured session cookie window: "+trace.limits.sessionMinutes+" minutes."},
    ...(trace.popup.applicable ? [{label:"Popup checks for this display",value:trace.popup.viewsBefore+" confirmed popups and "+trace.popup.reservationsBefore+" active popup reservations before this promotion. Previous popup in this session: "+(trace.popup.priorPopupAt ? new Date(trace.popup.priorPopupAt).toISOString() : "none")+". The popup gap requirement was satisfied."}] : []),
    {label:"Repeat and history checks",value:trace.repeat.checked ? "The "+trace.repeat.rule+" popup rule passed against browser/network-associated history (America/Chicago). A shared network identifier may represent more than one person; other people’s viewing activity is not shown." : "No once/daily popup exclusion applied to this display. Session limits and one-view-per-promotion rules still applied."},
  ];
  return {...payload,issuedAt:now,expiresAt:now+600000,summary:{...payload.summary,selectionRuleCodes:[...new Set([...payload.summary.selectionRuleCodes,"display_session_caps","one_view_per_session"]) ]},disclosure:{...payload.disclosure,details}};
}

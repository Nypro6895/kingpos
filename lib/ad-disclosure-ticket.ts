import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { AdDisclosureActor, AdDisclosureProofPayload, AdKind } from "@/types/ad-disclosure";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 24000;
const TTL = 600000;
type Options = { secret?: string; now?: number; allowExpired?: boolean };
function failure(): never { throw new Error("This ad selection could not be verified. Reload the page before starting a new report."); }
function key(options: Options, purpose: string) {
  const secret = options.secret ?? process.env.ADVERTISING_IP_HASH_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return failure();
  return createHmac("sha256", secret).update(`reylumi:ad-disclosure:v1:${purpose}`).digest();
}
function actorText(actor: AdDisclosureActor) {
  if (!actor || !["user", "guest"].includes(actor.kind) || !UUID.test(actor.id)) return failure();
  return `${actor.kind}:${actor.id.toLowerCase()}`;
}
function object(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) failure();
}
function text(value: unknown, max: number, min = 0): asserts value is string {
  if (typeof value !== "string" || value.length < min || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) failure();
}
function date(value: unknown) { text(value, 32, 20); if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) failure(); }
function oneOf(value: unknown, options: readonly unknown[]) { if (!options.includes(value)) failure(); }
function validate(value: unknown): asserts value is AdDisclosureProofPayload {
  object(value, ["version", "selectionId", "issuedAt", "expiresAt", "target", "snapshot", "summary", "disclosure"]);
  if (value.version !== 1 || !UUID.test(String(value.selectionId)) || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || Number(value.expiresAt) <= Number(value.issuedAt) || Number(value.expiresAt) - Number(value.issuedAt) > TTL) failure();
  const target = value.target;
  object(target, ["kind", "campaignId", "sourceType", "sourceId", "salonId"]);
  oneOf(target.kind, ["owner_campaign", "platform_campaign"]);
  if (!UUID.test(String(target.campaignId)) || !UUID.test(String(target.sourceId)) || target.salonId !== null && !UUID.test(String(target.salonId))) failure();
  oneOf(target.sourceType, ["custom", "beauty_post", "salon_profile_look", "salon_profile_update", "explore_campaign"]);
  if (target.kind === "platform_campaign" ? target.sourceType !== "explore_campaign" || target.sourceId !== target.campaignId || target.salonId !== null : target.sourceType === "explore_campaign" || target.salonId === null) failure();
  const snapshot = value.snapshot;
  object(snapshot, ["advertiserName", "title", "caption", "mediaBucket", "mediaPath", "destinationPath", "selectedAt"]);
  text(snapshot.advertiserName, 200, 1); text(snapshot.title, 200); text(snapshot.caption, 5000); date(snapshot.selectedAt);
  oneOf(snapshot.mediaBucket, [null, "campaign-creatives", "beauty-profile-media", "salon-profile-media"]);
  if ((snapshot.mediaPath === null) !== (snapshot.mediaBucket === null)) failure();
  if (snapshot.mediaPath !== null) { text(snapshot.mediaPath, 1000, 1); if (/\.\.|[?#\\]/.test(snapshot.mediaPath) || snapshot.mediaPath.startsWith("/")) failure(); }
  if (snapshot.destinationPath !== null) { text(snapshot.destinationPath, 512, 1); if (!/^\/(?!\/)[a-zA-Z0-9_/-]*$/.test(snapshot.destinationPath)) failure(); }
  const summary = value.summary;
  object(summary, ["locationSource", "areaLabel", "searchKind", "searchCategory", "page", "device", "audience", "selectionRuleCodes", "selectedAt"]);
  oneOf(summary.locationSource, ["gps", "manual", "search", "none"]);
  if (summary.areaLabel !== null) text(summary.areaLabel, 200);
  oneOf(summary.searchKind, [null, "service", "style", "name"]);
  if (summary.searchCategory !== null) text(summary.searchCategory, 80);
  text(summary.page, 100, 1); if (!/^[a-zA-Z0-9_/-]+$/.test(summary.page)) failure();
  oneOf(summary.device, [null, "mobile", "desktop"]); oneOf(summary.audience, [null, "guest", "personal", "staff", "owner"]);
  if (!Array.isArray(summary.selectionRuleCodes) || summary.selectionRuleCodes.length > 24 || summary.selectionRuleCodes.some(code => typeof code !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(code))) failure();
  date(summary.selectedAt);
  const disclosure = value.disclosure;
  object(disclosure, ["advertiserName", "primaryReasons", "details"]); text(disclosure.advertiserName, 200, 1);
  if (!Array.isArray(disclosure.primaryReasons) || disclosure.primaryReasons.length !== 2) failure();
  disclosure.primaryReasons.forEach(reason => text(reason, 500, 1));
  if (!Array.isArray(disclosure.details) || disclosure.details.length > 40) failure();
  disclosure.details.forEach(detail => { object(detail, ["label", "value"]); text(detail.label, 100, 1); text(detail.value, 2000); });
  if (summary.selectedAt !== snapshot.selectedAt || snapshot.advertiserName !== disclosure.advertiserName) failure();
}
export function adReportActorKey(actor: AdDisclosureActor, options: Options = {}) {
  const identity = actorText(actor);
  return actor.kind === "user" ? { actorUserId: actor.id, guestActorKey: null } : {
    actorUserId: null, guestActorKey: createHmac("sha256", key(options, "report-actor")).update(identity).digest("hex"),
  };
}
export function adDisclosureScope(actor: AdDisclosureActor, kind: AdKind, options: Options = {}) {
  oneOf(kind, ["owner_campaign", "platform_campaign"]);
  return createHmac("sha256", key(options, "browser-scope")).update(actorText(actor)).digest("hex");
}
export function sealAdDisclosureProof(payload: AdDisclosureProofPayload, actor: AdDisclosureActor, options: Options = {}) {
  validate(payload);
  const now = options.now ?? Date.now();
  if (payload.issuedAt > now + 30000 || payload.expiresAt <= now) failure();
  const raw = Buffer.from(JSON.stringify(payload)); if (raw.length > MAX_BYTES) failure();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(options, "encryption"), iv);
  cipher.setAAD(Buffer.from(`${actorText(actor)}:${payload.target.kind}:v1`));
  const encrypted = Buffer.concat([cipher.update(raw), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}
export function readAdDisclosureProof(proof: string, kind: AdKind, actor: AdDisclosureActor, options: Options = {}): AdDisclosureProofPayload {
  try {
    oneOf(kind, ["owner_campaign", "platform_campaign"]);
    if (typeof proof !== "string" || proof.length > 33000 || !/^v1\.[a-zA-Z0-9_-]+$/.test(proof)) failure();
    const raw = Buffer.from(proof.slice(3), "base64url");
    if (raw.length < 29 || raw.length > MAX_BYTES + 28 || raw.toString("base64url") !== proof.slice(3)) failure();
    const decipher = createDecipheriv("aes-256-gcm", key(options, "encryption"), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28)); decipher.setAAD(Buffer.from(`${actorText(actor)}:${kind}:v1`));
    const value: unknown = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
    validate(value);
    const now = options.now ?? Date.now();
    if (value.target.kind !== kind || value.issuedAt > now + 30000 || !options.allowExpired && value.expiresAt <= now) failure();
    return value;
  } catch { return failure(); }
}

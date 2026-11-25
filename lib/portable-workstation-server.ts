import "server-only";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createHash, createHmac, createPrivateKey, createPublicKey, randomBytes, randomInt, randomUUID, sign } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { portableWorkstationSigningPayload, validWorkstationPreview } from "@/lib/portable-workstation-protocol";
import type { PortableWorkstationDescriptor, PortableWorkstationEnvelope, PortableWorkstationEventKind, PortableWorkstationSession, PortableWorkstationSummary } from "@/types/portable-workstation";
import type { PosLiveDraftView } from "@/types/pos-desk";

export const PORTABLE_WORKSTATION_STAFF_COOKIE = "reylumi-portable-workstation";
export const PORTABLE_WORKSTATION_CUSTOMER_COOKIE = "reylumi-customer-workstation";
const ATTEMPT_COOKIE = "reylumi-workstation-pair-attempt";
const YEAR = 31_536_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type RecordValue = Record<string, unknown>;
type Station = {
  id: string; salon_id: string; key_id: string; draft_id: string; label: string;
  generation: number; event_sequence: number; topic: string; writer_hash: string; writer_device: string;
  lease_until: string | null; heartbeat_at: string | null; dirty: boolean; pending: boolean;
  customer_hash: string | null; latest_envelope: PortableWorkstationEnvelope | null;
  cart_id: string | null; revision: string | null; code_expires_at?: string;
};
type StaffActor = { role: "staff"; keyId: string; salonId: string; deviceId: string; credentialHash: string; workstationId?: string };
type CustomerActor = { role: "customer"; credentialHash: string; workstationId: string };
type Actor = StaffActor | CustomerActor | { role: "pair"; attemptHash: string; networkHash: string };
type StaffContext = { actor: StaffActor; secret: string; signature: string; deviceId: string };

export class PortableWorkstationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function serverSecret() {
  const secret = process.env.PORTABLE_WORKSTATION_SIGNING_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new PortableWorkstationError("Workstation pairing is temporarily unavailable.", 503);
  return secret;
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function keyedHash(purpose: string, value: string) { return createHmac("sha256", serverSecret()).update(purpose + ":" + value).digest("hex"); }
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new PortableWorkstationError("Workstation pairing is temporarily unavailable.", 503);
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function signingKey() {
  const seed = createHmac("sha256", serverSecret()).update("portable-workstation-ed25519-v1").digest();
  return createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
}
export function portableWorkstationVerificationKey() { return createPublicKey(signingKey()).export({ format: "der", type: "spki" }).toString("base64"); }
function cookieOptions(request?: Request) {
  return { httpOnly: true, sameSite: "lax" as const, secure: request ? new URL(request.url).protocol === "https:" : process.env.NODE_ENV === "production", path: "/", maxAge: YEAR };
}
function readEnrollment(value?: string) {
  if (!value) return null;
  const [id, secret, extra] = value.split(".");
  return UUID.test(id ?? "") && /^[a-f0-9]{64}$/.test(secret ?? "") && !extra ? { id, secret } : null;
}
async function command<T>(action: string, actor: Actor, input: RecordValue = {}): Promise<T> {
  const { data, error } = await serviceClient().rpc("portable_workstation_command", { p_action: action, p_actor: actor, p_input: input }).abortSignal(AbortSignal.timeout(10_000));
  if (error) throw new PortableWorkstationError("Workstation pairing is temporarily unavailable.", 503);
  if (data?.error) throw new PortableWorkstationError(String(data.error), Number(data.status) || 400);
  return data as T;
}
async function staffContext(request?: Request): Promise<StaffContext> {
  const store = await cookies();
  const keyId = store.get("kingpos-portable-pos-key-id")?.value;
  const signature = store.get("kingpos-portable-pos-session")?.value;
  if (!keyId || !signature || store.get("kingpos-portable-local-lock")?.value === "1") throw new PortableWorkstationError("Sign in with a Portable POS ID first.", 401);
  const client = createSupabaseServerClient();
  if (!client) throw new PortableWorkstationError("Portable POS is temporarily unavailable.", 503);
  const { data, error } = await client.rpc("get_pos_portable_access_context", { p_key_id: keyId, p_session_signature: signature });
  if (error) throw new PortableWorkstationError("Portable POS is temporarily unavailable.", 503);
  if (!data || data.key_id !== keyId || !data.salon_id || !Array.isArray(data.capabilities) || !data.capabilities.includes("portable.pos.use")) throw new PortableWorkstationError("Portable POS access is unavailable. Sign in again.", 401);
  const enrolled = readEnrollment(store.get(PORTABLE_WORKSTATION_STAFF_COOKIE)?.value);
  const secret = enrolled?.secret ?? randomBytes(32).toString("hex");
  let deviceId = store.get("kingpos-workspace-device")?.value ?? "";
  if (!UUID.test(deviceId)) {
    if (!request) throw new PortableWorkstationError("Prepare this POS device first.", 409);
    deviceId = randomUUID(); store.set("kingpos-workspace-device", deviceId, cookieOptions(request));
  }
  return { secret, signature, deviceId, actor: { role: "staff", keyId, salonId: data.salon_id, deviceId, credentialHash: hash(secret), ...(enrolled ? { workstationId: enrolled.id } : {}) } };
}
async function customerContext() {
  const enrolled = readEnrollment((await cookies()).get(PORTABLE_WORKSTATION_CUSTOMER_COOKIE)?.value);
  if (!enrolled) throw new PortableWorkstationError("Pair this customer screen first.", 401);
  const actor: CustomerActor = { role: "customer", workstationId: enrolled.id, credentialHash: hash(enrolled.secret) };
  const station = await command<Station>("current", actor);
  return { actor, station, enrolled };
}
function summary(station: Station): PortableWorkstationSummary {
  const now = Date.now();
  const preview = station.latest_envelope?.payload;
  const receipt = preview && isRecord(preview.payload) ? preview.payload : null;
  const emptyPreview = preview?.cartId === station.cart_id && preview?.revision === station.revision && receipt && Array.isArray(receipt.staffLines) && receipt.staffLines.length === 0 && receipt.total === 0 && receipt.customer === null;
  return { id: station.id, label: station.label, generation: station.generation, customerPaired: !!station.customer_hash,
    staffOnline: !!station.lease_until && Date.parse(station.lease_until) > now,
    canHandover: !!station.heartbeat_at && Date.parse(station.heartbeat_at) > now - 20_000 && !station.dirty && !station.pending && !!station.cart_id && !!station.revision && !!emptyPreview };
}
function descriptor(station: Station, role: "staff" | "customer"): PortableWorkstationDescriptor {
  const state = summary(station);
  return { ...state, role, sequence: Number(station.event_sequence), topic: station.topic, verificationKey: portableWorkstationVerificationKey(), latestEnvelope: role === "customer" && !state.staffOnline ? null : station.latest_envelope };
}
async function draftToken(station: Station) {
  const { data, error } = await serviceClient().from("pos_live_drafts").select("token").eq("id", station.draft_id).eq("salon_id", station.salon_id).single();
  if (error || !data?.token) throw new PortableWorkstationError("The workstation receipt is unavailable.", 503);
  return String(data.token);
}
/** Never return the legacy bearer in a snapshot, nested result, URL or revision. */
export function sanitizePairedCustomerResult<T>(value: T, token: string): T {
  if (typeof value === "string") return value.split(token).join("") as T;
  if (Array.isArray(value)) return value.map(item => sanitizePairedCustomerResult(item, token)) as T;
  if (!value || typeof value !== "object") return value;
  const result: RecordValue = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && item === token) continue;
    result[key] = sanitizePairedCustomerResult(item, token);
  }
  return result as T;
}
async function customerSession(station: Station): Promise<PortableWorkstationSession> {
  const token = await draftToken(station);
  const [{ getPublicPosDisplaySettingsByToken }, actions] = await Promise.all([import("@/lib/pos-settings"), import("@/app/pos/actions")]);
  const online = summary(station).staffOnline;
  const [settings, serviceCatalog, snapshot] = await Promise.all([
    getPublicPosDisplaySettingsByToken(token), actions.getCustomerDisplayServiceCatalog(token), online ? actions.getPosLiveDraft(token) : null,
  ]);
  return sanitizePairedCustomerResult({ role: "customer", current: descriptor(station, "customer"), settings, serviceCatalog, snapshot: snapshot?.ok ? snapshot.data : null }, token);
}

export async function getPortableWorkstationSession(request?: Request, explicitRole?: "staff" | "customer"): Promise<PortableWorkstationSession> {
  const store = await cookies();
  const requestedRole = explicitRole ?? (request ? new URL(request.url).searchParams.get("role") : null);
  const useCustomer = requestedRole === "customer" || requestedRole !== "staff" && !store.get("kingpos-portable-pos-session")?.value && !!store.get(PORTABLE_WORKSTATION_CUSTOMER_COOKIE)?.value;
  if (useCustomer) {
    const { station, enrolled } = await customerContext();
    if (request) store.set(PORTABLE_WORKSTATION_CUSTOMER_COOKIE, `${enrolled.id}.${enrolled.secret}`, cookieOptions(request));
    return customerSession(station);
  }
  let context: StaffContext;
  try { context = await staffContext(request); } catch (error) {
    if (error instanceof PortableWorkstationError && error.status === 401) return { role: null, current: null };
    throw error;
  }
  const workstations = await command<PortableWorkstationSummary[]>("list", context.actor);
  if (!context.actor.workstationId) return { role: "staff", current: null, workstations };
  try {
    const station = await command<Station>("current", context.actor);
    if (request) {
      store.set(PORTABLE_WORKSTATION_STAFF_COOKIE, `${station.id}.${context.secret}`, cookieOptions(request));
      store.set("kingpos-workspace-device", context.deviceId, cookieOptions(request));
    }
    return { role: "staff", current: descriptor(station, "staff"), workstations };
  } catch (error) {
    if (error instanceof PortableWorkstationError && [403, 404, 409].includes(error.status)) return { role: "staff", current: null, workstations, attention: error.message };
    throw error;
  }
}

function isRecord(value: unknown): value is RecordValue { return !!value && typeof value === "object" && !Array.isArray(value); }
function validEvent(kind: PortableWorkstationEventKind, payload: RecordValue) {
  if (kind === "preview") return validWorkstationPreview(payload) && !JSON.stringify(payload).includes('"token"');
  if (kind === "presence") return typeof payload.online === "boolean";
  if (!UUID.test(String(payload.id ?? "")) || typeof payload.cartId !== "string" || !payload.cartId || payload.cartId.length > 128 || typeof payload.revision !== "string" || !payload.revision || payload.revision.length > 128) return false;
  if (kind === "ack") return typeof payload.accepted === "boolean";
  if (kind !== "intent") return false;
  if (payload.kind === "tip") return typeof payload.amount === "number" && Number.isFinite(payload.amount) && payload.amount >= 0 && payload.amount <= 100_000;
  if (payload.kind === "dismiss") return true;
  return payload.kind === "customer" && isRecord(payload.customer) && typeof payload.customer.id === "string" && typeof payload.customer.name === "string" && payload.customer.name.length <= 200;
}
async function sendEvent(actor: StaffActor | CustomerActor, kind: PortableWorkstationEventKind, payload: RecordValue, messageId?: string) {
  if (!validEvent(kind, payload)) throw new PortableWorkstationError("Invalid workstation event.", 400);
  const station = await command<Station>("reserveEvent", actor, { kind, payload });
  // The bearer is never permitted in the customer-facing preview or revision.
  if (JSON.stringify(payload).includes(await draftToken(station))) throw new PortableWorkstationError("Invalid workstation preview.", 400);
  const now = Date.now();
  const unsigned: Omit<PortableWorkstationEnvelope, "signature"> = { version: 1, workstationId: station.id, generation: station.generation, sequence: Number(station.event_sequence), kind,
    messageId: messageId && UUID.test(messageId) ? messageId : randomUUID(), issuedAt: now, expiresAt: now + (kind === "preview" ? 86_400_000 : 30_000), payload };
  const envelope: PortableWorkstationEnvelope = { ...unsigned, signature: sign(null, Buffer.from(portableWorkstationSigningPayload(unsigned)), signingKey()).toString("base64") };
  const committed = await command<Station>("commitEvent", actor, { envelope });
  const client = serviceClient();
  const channel = client.channel(committed.topic);
  try { await channel.httpSend("portable-workstation", envelope); }
  finally { await client.removeChannel(channel); }
  return { envelope };
}

async function notifyRetiredChannel(station: Station, reason: "replaced" | "revoked" | "handover") {
  const now = Date.now();
  const unsigned: Omit<PortableWorkstationEnvelope, "signature"> = { version: 1, workstationId: station.id, generation: station.generation, sequence: Number(station.event_sequence) + 1,
    kind: "revoked", messageId: randomUUID(), issuedAt: now, expiresAt: now + 30_000, payload: { reason } };
  const envelope = { ...unsigned, signature: sign(null, Buffer.from(portableWorkstationSigningPayload(unsigned)), signingKey()).toString("base64") };
  const client = serviceClient(), channel = client.channel(station.topic);
  try { await channel.httpSend("portable-workstation", envelope); }
  finally { await client.removeChannel(channel); }
}

async function runCustomerAction(commandName: string, input: RecordValue) {
  const { station, actor } = await customerContext();
  if (!summary(station).staffOnline) throw new PortableWorkstationError("The staff POS is disconnected. Please wait for staff to sign in.", 409);
  const token = await draftToken(station);
  const actions = await import("@/app/pos/actions");
  const scoped = { ...input, token };
  let result: unknown;
  switch (commandName) {
    case "read": result = await actions.getPosLiveDraft(token); break;
    case "phone": {
      if (input.localCheckout === true) {
        const preview = station.latest_envelope?.payload;
        if (!summary(station).staffOnline || !preview || preview.cartId !== input.cartId || preview.revision !== input.revision || preview.busy || preview.completedAt) throw new PortableWorkstationError("The receipt changed. Please enter your phone again.", 409);
        const found = typeof input.name === "string" && input.name.trim()
          ? await actions.createLiveDraftCustomer({ name: input.name.trim(), phone: String(input.phone ?? ""), token })
          : await actions.findLiveDraftCustomerByPhone({ phone: String(input.phone ?? ""), token });
        if (!found.ok) { result = found; break; }
        if (!found.data) { result = { ok: false, code: "profile_required", error: "Enter your name to continue." }; break; }
        await command("allowCustomer", actor, { cartId: input.cartId, revision: input.revision, customer: found.data });
        const baseline = await actions.getPosLiveDraft(token);
        if (!baseline.ok || !baseline.data) throw new PortableWorkstationError("The receipt is unavailable. Please try again.", 409);
        result = { ok: true, data: { mode: "checkout", visit: null, snapshot: { ...baseline.data, ...(isRecord(preview.payload) ? preview.payload : {}), customer: found.data } } };
      } else result = await actions.submitCustomerDisplayPhone(scoped as Parameters<typeof actions.submitCustomerDisplayPhone>[0]);
      break;
    }
    case "search": result = await actions.searchCustomerDisplayLiveDraftCustomers(scoped as Parameters<typeof actions.searchCustomerDisplayLiveDraftCustomers>[0]); break;
    case "find": result = await actions.findLiveDraftCustomerByPhone(scoped as Parameters<typeof actions.findLiveDraftCustomerByPhone>[0]); break;
    case "createCustomer": result = await actions.createLiveDraftCustomer(scoped as Parameters<typeof actions.createLiveDraftCustomer>[0]); break;
    case "services": result = await actions.saveCustomerDisplayRequestedServices(scoped as Parameters<typeof actions.saveCustomerDisplayRequestedServices>[0]); break;
    // A paired tip/reset must go through the owning cart's validated intent and
    // durable acknowledgment. The cloud draft may lag the live staff preview.
    case "tip": case "reset": throw new PortableWorkstationError("Use the connected receipt to complete this action.", 409);
    case "tipOptions": result = await actions.getCustomerDisplayLiveDraftTipOptions({ token }); break;
    case "activity": result = await actions.touchCustomerDisplayLiveDraftActivity(scoped); break;
    default: {
      const { runPairedCustomerExtension } = await import("@/lib/portable-workstation-customer-actions");
      const extension = await runPairedCustomerExtension(commandName, input, token);
      if (!extension.handled) throw new PortableWorkstationError("Unknown customer action.", 400);
      result = extension.value;
    }
  }
  // A concurrent replacement may not receive even the response to an old request.
  await customerContext();
  return sanitizePairedCustomerResult(result, token);
}

export async function handlePortableWorkstationRequest(request: Request, input: RecordValue): Promise<unknown> {
  const action = String(input.action ?? "");
  const store = await cookies();
  if (action === "pair") {
    if (typeof input.code !== "string" || !/^\d{8}$/.test(input.code.replace(/\s/g, ""))) throw new PortableWorkstationError("Enter the eight-digit pairing code.", 400);
    const attemptSecret = store.get(ATTEMPT_COOKIE)?.value ?? randomBytes(32).toString("hex");
    store.set(ATTEMPT_COOKIE, attemptSecret, cookieOptions(request));
    const secret = randomBytes(32).toString("hex");
    const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
    const station = await command<Station>("pair", { role: "pair", attemptHash: keyedHash("pair-browser", attemptSecret), networkHash: keyedHash("pair-network", address) }, { codeHash: keyedHash("pair-code", input.code.replace(/\s/g, "")), customerHash: hash(secret) });
    store.set(PORTABLE_WORKSTATION_CUSTOMER_COOKIE, `${station.id}.${secret}`, cookieOptions(request));
    // Pairing grants only a customer credential. Existing independent staff
    // cookies can coexist when two windows deliberately share a browser profile.
    return customerSession(station);
  }
  if (action === "customerAction") {
    if (!isRecord(input.input ?? {})) throw new PortableWorkstationError("Invalid customer action.", 400);
    return runCustomerAction(String(input.command ?? ""), (input.input ?? {}) as RecordValue);
  }
  if (action === "intent") {
    const { actor } = await customerContext();
    return sendEvent(actor, "intent", isRecord(input.payload) ? input.payload : {}, typeof input.messageId === "string" ? input.messageId : undefined);
  }
  if (action === "unpair") {
    store.delete(PORTABLE_WORKSTATION_CUSTOMER_COOKIE);return { role: null, current: null };
  }
  const context = await staffContext(request);
  if (action === "create" || action === "select") {
    let station: Station;
    if (action === "create") {
      const client = createSupabaseServerClient()!;
      const { data, error } = await client.rpc("get_pos_workspace_draft", { p_key: context.actor.keyId, p_signature: context.signature, p_device: context.deviceId });
      if (error || !data?.token) throw new PortableWorkstationError("Open the staff POS before creating a workstation.", 409);
      station = await command<Station>("create", context.actor, { label: input.label, draftToken: data.token });
    } else {
      if (typeof input.workstationId !== "string" || !UUID.test(input.workstationId)) throw new PortableWorkstationError("Choose a workstation.", 400);
      // A staff member in the same POS key may list/select, but only the current
      // writer can read the private channel. The selected record is returned by
      // the transaction; a server-only pre-read supplies the retired topic.
      const old = await serviceClient().from("portable_workstations").select("*").eq("id", input.workstationId).eq("key_id", context.actor.keyId).eq("salon_id", context.actor.salonId).maybeSingle();
      station = await command<Station>("select", context.actor, { workstationId: input.workstationId });
      if (old.data && old.data.topic !== station.topic) await notifyRetiredChannel(old.data as Station, "handover");
    }
    store.set(PORTABLE_WORKSTATION_STAFF_COOKIE, `${station.id}.${context.secret}`, cookieOptions(request));
    return { role: "staff", current: descriptor(station, "staff"), workstations: await command("list", context.actor) };
  }
  if (action === "list" || action === "current") return getPortableWorkstationSession(request);
  if (!context.actor.workstationId) throw new PortableWorkstationError("Create or select a workstation first.", 409);
  if (action === "code" || action === "revoke") {
    const previous = await command<Station>("current", context.actor);
    const code = String(randomInt(0, 100_000_000)).padStart(8, "0");
    const station = await command<Station>(action, context.actor, { codeHash: keyedHash("pair-code", code), replace: input.replace === true });
    await notifyRetiredChannel(previous, action === "revoke" ? "revoked" : "replaced");
    return { ...(action === "code" ? { code, expiresAt: station.code_expires_at } : {}), role: "staff", current: descriptor(station, "staff") };
  }
  if (action === "heartbeat") {
    const station = await command<Station>(input.online === false ? "logout" : "heartbeat", context.actor, input);
    const event = await sendEvent(context.actor, "presence", { online: input.online !== false, staffOnline: input.online !== false });
    return { current: descriptor(station, "staff"), ...event };
  }
  if (action === "preview" || action === "ack") return sendEvent(context.actor, action, isRecord(input.payload) ? input.payload : {}, typeof input.messageId === "string" ? input.messageId : undefined);
  throw new PortableWorkstationError("Unknown workstation action.", 400);
}

/** No Owner cookie is consulted. No selection preserves the existing Windows path. */
export async function assertPortableWorkstationWriter({ keyId, deviceId, token }: { keyId: string; deviceId?: string; token?: string }) {
  const store = await cookies();
  if (!store.get(PORTABLE_WORKSTATION_STAFF_COOKIE)?.value) {
    if (token) {
      const client = serviceClient();
      const draft = await client.from("pos_live_drafts").select("id").eq("token", token).maybeSingle();
      if (draft.error) throw new PortableWorkstationError("Unable to validate this workstation.", 503);
      if (draft.data) {
        const enrolled = await client.from("portable_workstations").select("id").eq("draft_id", draft.data.id).maybeSingle();
        if (enrolled.error) throw new PortableWorkstationError("Unable to validate this workstation.", 503);
        if (enrolled.data) throw new PortableWorkstationError("Select this workstation before editing its receipt.", 409);
      }
    }
    return null;
  }
  const context = await staffContext();
  if (context.actor.keyId !== keyId || deviceId && context.deviceId !== deviceId) throw new PortableWorkstationError("The workstation belongs to another POS session.", 403);
  const station = await command<Station>("current", context.actor);
  if (token && await draftToken(station) !== token) throw new PortableWorkstationError("This receipt belongs to another workstation.", 409);
  return station;
}
export async function resolvePortableWorkstationDraft({ keyId, deviceId, liveDraft }: { keyId: string; signature?: string; deviceId?: string; liveDraft: PosLiveDraftView | null }) {
  const station = await assertPortableWorkstationWriter({ keyId, deviceId });
  if (!station) return liveDraft;
  const { getPosLiveDraft } = await import("@/app/pos/actions");
  const result = await getPosLiveDraft(await draftToken(station));
  if (!result.ok || !result.data) throw new PortableWorkstationError("The workstation receipt is unavailable.", 503);
  return result.data;
}
export async function logoutPortableWorkstationWriter() {
  const store = await cookies();
  if (!store.get(PORTABLE_WORKSTATION_STAFF_COOKIE)?.value) return;
  const context = await staffContext();
  if (context.actor.workstationId) {
    await command("logout", context.actor);
    await sendEvent(context.actor, "presence", { online: false, staffOnline: false });
  }
}

const STATION_DRAFT_RPCS = new Set([
  "sync_pos_portable_draft", "update_pos_portable_live_draft", "update_pos_portable_live_draft_customer",
  "select_pos_portable_customer_visit_for_live_draft", "finalize_pos_portable_live_draft", "submit_pos_portable_receipt", "replay_pos_portable_operation",
]);
/** Elevation is restricted to a validated enrolled draft and an exact RPC list. */
export function portableWorkstationRpcClient<T extends NonNullable<ReturnType<typeof createSupabaseServerClient>>>(original: T, context: { keyId: string; deviceId?: string }): T {
  return new Proxy(original, { get(target, property, receiver) {
    if (property !== "rpc") return Reflect.get(target, property, receiver);
    return (name: string, args: RecordValue = {}, options?: RecordValue) => {
      const payload = isRecord(args.p_receipt) ? args.p_receipt : isRecord(args.p_payload) ? args.p_payload : null;
      const token = typeof args.p_token === "string" ? args.p_token : typeof payload?.liveDraftToken === "string" ? payload.liveDraftToken : null;
      if (!token || !STATION_DRAFT_RPCS.has(name)) return target.rpc(name, args, options);
      return (async () => {
        if (args.p_key_id !== context.keyId) throw new PortableWorkstationError("This POS session cannot edit that receipt.", 403);
        const station = await assertPortableWorkstationWriter({ ...context, token });
        return (station ? serviceClient() : target).rpc(name, args, options);
      })();
    };
  } });
}

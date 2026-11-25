"use client";

import { getAppLocalHost, appLocalRequestId } from "@/lib/app-local-host";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { LocalReceiptPreview } from "@/lib/pos-local-display";
import type { PortableWorkstationDescriptor, PortableWorkstationEnvelope, PortableWorkstationSession } from "@/types/portable-workstation";
import { validWorkstationPreview, workstationSignedBody, type WorkstationAck, type WorkstationIntent, type WorkstationPreview } from "./portable-workstation-protocol";
import { verifyPortableWorkstationSignature } from "./portable-workstation-signature";

export const PORTABLE_WORKSTATION_CHANGED = "kingpos:workstation-changed";
export type PortableWorkstationAction = Record<string, unknown>;
export async function workstationRequest<T = PortableWorkstationSession>(input?: PortableWorkstationAction, role?: "staff" | "customer"): Promise<T> {
  const host = getAppLocalHost();
  if (host.isNative) return host.command<T>("portable.workstation", { method: input ? "POST" : "GET", role, ...(input ? { input } : {}) });
  const response = await fetch("/api/pos/workstation" + (!input && role ? "?role=" + role : ""), { method: input ? "POST" : "GET", credentials: "same-origin", cache: "no-store", headers: input ? { "Content-Type": "application/json" } : undefined, ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok || result.ok === false) throw Object.assign(new Error(result.error || "The POS connection could not be confirmed."), { status: response.status });
  return result as T;
}
export function workstationChanged() { window.dispatchEvent(new Event(PORTABLE_WORKSTATION_CHANGED)); }
export async function verifyWorkstationEnvelope(envelope: PortableWorkstationEnvelope, descriptor: PortableWorkstationDescriptor, now = Date.now()): Promise<boolean> {
  if (!envelope || envelope.version !== 1 || envelope.workstationId !== descriptor.id || envelope.generation !== descriptor.generation ||
      !Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0 ||
      !Number.isFinite(envelope.issuedAt) || !Number.isFinite(envelope.expiresAt) || envelope.issuedAt > now + 30000 || envelope.expiresAt < now || envelope.expiresAt - envelope.issuedAt > (envelope.kind === "preview" ? 86400000 : 300000) || typeof envelope.messageId !== "string") return false;
  try {
    return await verifyPortableWorkstationSignature(descriptor.verificationKey, envelope.signature, workstationSignedBody(envelope));
  } catch { return false; }
}
export async function workstationRevision(revision: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(revision));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type WorkstationCallbacks = {
  role?: "staff" | "customer";
  enrollmentLost?: () => void;
  session?: (session: PortableWorkstationSession) => void;
  event?: (envelope: PortableWorkstationEnvelope) => void | Promise<void>;
  status?: (status: "connected" | "connecting" | "reconnecting" | "waiting") => void;
};
/** Full signed frames travel over realtime. HTTP is only admission/reconnect recovery. */
export function connectWorkstation(callbacks: WorkstationCallbacks) {
  let active = true, enrollmentLost = false, epoch = 0, descriptor: PortableWorkstationDescriptor | null = null;
  let channel: ReturnType<NonNullable<ReturnType<typeof createSupabaseBrowserClient>>["channel"]> | null = null;
  let chain = Promise.resolve(), retry: ReturnType<typeof setTimeout> | null = null;
  const seen = new Set<string>(), lastSequence = new Map<string, number>();
  const supabase = createSupabaseBrowserClient();
  const loseEnrollment = () => {
    enrollmentLost = true; epoch++; descriptor = null;
    if (retry) { clearTimeout(retry); retry = null; }
    if (channel && supabase) { void supabase.removeChannel(channel); channel = null; }
    callbacks.status?.("waiting"); callbacks.enrollmentLost?.();
  };
  const ingest = (envelope: PortableWorkstationEnvelope, expected: PortableWorkstationDescriptor, ticket: number) => {
    chain = chain.then(async () => {
      const identity = envelope?.kind + ":" + envelope?.messageId;
      if (!active || ticket !== epoch || descriptor !== expected || seen.has(identity) || !(await verifyWorkstationEnvelope(envelope, expected))) return;
      if (!active || ticket !== epoch) return;
      const sequence = envelope.sequence;
      if (sequence <= (lastSequence.get(envelope.kind) ?? -1)) return;
      lastSequence.set(envelope.kind, sequence);
      seen.add(identity); if (seen.size > 512) seen.delete(seen.values().next().value!);
      await callbacks.event?.(envelope);
      if (envelope.kind === "revoked") { callbacks.status?.("waiting"); void refresh(); }
    }).catch(() => callbacks.status?.("reconnecting"));
  };
  async function refresh() {
    const ticket = ++epoch;
    callbacks.status?.("connecting");
    if (channel && supabase) { void supabase.removeChannel(channel); channel = null; }
    descriptor = null; seen.clear(); lastSequence.clear();
    try {
      const session = await workstationRequest<PortableWorkstationSession>(undefined, callbacks.role);
      if (!active || ticket !== epoch) return;
      callbacks.session?.(session); descriptor = session.current;
      if (!descriptor) { callbacks.status?.("waiting"); return; }
      const expected = descriptor;
      if (expected.latestEnvelope) ingest(expected.latestEnvelope, expected, ticket);
      if (!supabase) { callbacks.status?.("reconnecting"); return; }
      channel = supabase.channel(expected.topic, { config: { broadcast: { ack: false, self: true } } }).on("broadcast", { event: "portable-workstation" }, (message: { payload: PortableWorkstationEnvelope }) => ingest(message.payload, expected, ticket)).subscribe(status => {
        if (!active || ticket !== epoch) return;
        if (status === "SUBSCRIBED") {
          callbacks.status?.("connected");
          // Close the admission -> subscription race once, without refetching
          // a snapshot for individual receipt edits or customer intents.
          void workstationRequest<PortableWorkstationSession>(undefined, callbacks.role).then(session => {
            if (active && ticket === epoch && session.current?.id === expected.id && session.current.generation === expected.generation && session.current.latestEnvelope) ingest(session.current.latestEnvelope, expected, ticket);
          }).catch(error => { if (active && ticket === epoch && callbacks.role === "customer" && error?.status === 401) loseEnrollment(); });
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          callbacks.status?.("reconnecting");
          if (!retry) retry = setTimeout(() => { retry = null; void refresh(); }, 2500);
        }
      });
    } catch (error) { if (active && ticket === epoch) {
      if (callbacks.role === "customer" && (error as { status?: number })?.status === 401) { loseEnrollment(); return; }
      callbacks.status?.("reconnecting"); retry = setTimeout(() => { retry = null; void refresh(); }, 5000);
    } }
  }
  const resume = () => { if (!enrollmentLost && document.visibilityState !== "hidden") void refresh(); };
  window.addEventListener("online", resume); window.addEventListener(PORTABLE_WORKSTATION_CHANGED, resume); document.addEventListener("visibilitychange", resume);
  void refresh();
  return {
    current: () => descriptor,
    async send(action: string, payload: unknown, messageId = appLocalRequestId()) {
      if (!active || !descriptor) throw new Error("Connect this POS before continuing.");
      const expected = descriptor, ticket = epoch;
      const result = await workstationRequest<{ envelope?: PortableWorkstationEnvelope }>({ action, payload, messageId });
      if (!active || ticket !== epoch || descriptor !== expected) throw new Error("The POS connection changed. Please try again.");
      if (result.envelope) ingest(result.envelope, expected, ticket);
      return result;
    },
    close() { active = false; epoch++; if (retry) clearTimeout(retry); if (channel && supabase) void supabase.removeChannel(channel); window.removeEventListener("online", resume); window.removeEventListener(PORTABLE_WORKSTATION_CHANGED, resume); document.removeEventListener("visibilitychange", resume); },
  };
}

export type StaffReceiptCallbacks = {
  tip(request: { id: string; cartId: string; revision: string; amount: number }): boolean | undefined;
  customer(request: { id: string; cartId: string; revision: string; customer: NonNullable<LocalReceiptPreview["payload"]["customer"]> }): boolean | undefined;
  dismissCompleted(cartId: string): void;
  state?(): { dirty: boolean; pending: boolean; busy?: boolean };
};
/** The existing durable draft callbacks run before an acknowledgement can be sent. */
export function connectPairedStaffReceipt(callbacks: StaffReceiptCallbacks) {
  let latest: LocalReceiptPreview | null = null, wireRevision = "", version = 0, sent = "", sentState = "", sending = false, closed = false;
  const acknowledgements = new Map<string, WorkstationAck>();
  const connection = connectWorkstation({ role: "staff", session: () => { sent = ""; queueMicrotask(() => void publishLatest()); }, status: status => { if (status === "connected") { sent = ""; void publishLatest(); } }, event: async envelope => {
    if (envelope.kind !== "intent" || connection.current()?.role !== "staff") return;
    const intent = envelope.payload as WorkstationIntent;
    if (!intent || typeof intent.id !== "string") return;
    const previous = acknowledgements.get(intent.id);
    if (previous) { await connection.send("ack", previous, intent.id); return; }
    const current = latest;
    let accepted = false;
    if (current && intent.cartId === current.cartId && intent.revision === wireRevision && !current.completedAt) {
      if (intent.kind === "tip" && Number.isFinite(intent.amount) && intent.amount >= 0 && intent.amount <= 100000) accepted = callbacks.tip({ ...intent, revision: current.revision }) === true;
      if (intent.kind === "customer" && intent.customer && typeof intent.customer.name === "string") accepted = callbacks.customer({ ...intent, revision: current.revision }) === true;
    }
    if (intent.kind === "dismiss" && current?.completedAt && intent.cartId === current.cartId && intent.revision === wireRevision) { callbacks.dismissCompleted(intent.cartId); accepted = true; }
    const ack = { id: intent.id, cartId: intent.cartId, revision: intent.revision, accepted };
    acknowledgements.set(intent.id, ack); if (acknowledgements.size > 256) acknowledgements.delete(acknowledgements.keys().next().value!);
    await connection.send("ack", ack, intent.id);
  } });
  async function publishLatest() {
    if (sending || closed || !latest || connection.current()?.role !== "staff") return;
    sending = true;
    try {
      while (!closed && latest) {
        const preview = latest, ticket = version;
        const revision = await workstationRevision(preview.revision);
        if (ticket !== version) continue;
        wireRevision = revision;
        const { token: _token, ...payload } = preview.payload;
        void _token;
        const wire: WorkstationPreview = { ...preview, payload, revision, busy: callbacks.state?.().busy ?? false };
        const signature = JSON.stringify(wire);
        if (sent === signature) break;
        const heartbeatState = JSON.stringify(state());
        if (heartbeatState !== sentState) { await workstationRequest({ action: "heartbeat", ...state(), cartId: preview.cartId, revision }); sentState = heartbeatState; }
        await connection.send("preview", wire);
        sent = signature;
        if (ticket === version) break;
      }
    } catch { sent = ""; } finally { sending = false; }
  }
  const state = () => callbacks.state?.() ?? { dirty: !!latest?.payload.staffLines.length, pending: false };
  const heartbeat = setInterval(() => { if (connection.current()?.role === "staff") void workstationRequest({ action: "heartbeat", ...state(), cartId: latest?.cartId ?? null, revision: wireRevision || null }).catch(() => {}); void publishLatest(); }, 10000);
  const locked = () => { void workstationRequest({ action: "heartbeat", online: false, ...state(), cartId: latest?.cartId ?? null, revision: wireRevision || null }).catch(() => {}); connection.close(); };
  window.addEventListener("kingpos:portable-lock", locked);
  return {
    publish(preview: LocalReceiptPreview) { latest = preview; version++; void publishLatest(); },
    close() { closed = true; clearInterval(heartbeat); window.removeEventListener("kingpos:portable-lock", locked); connection.close(); },
  };
}

export type PairedDisplayTransport = {
  subscribe(receive: (preview: LocalReceiptPreview | null) => void, status: WorkstationCallbacks["status"]): () => void;
  tip(preview: LocalReceiptPreview, amount: number): Promise<boolean>;
  customer(preview: LocalReceiptPreview, customer: NonNullable<LocalReceiptPreview["payload"]["customer"]>): Promise<boolean>;
  dismiss(preview: LocalReceiptPreview): void;
  command<T>(command: string, input: Record<string, unknown>): Promise<T>;
};
export function createPairedDisplayTransport(id: string, onEnrollmentLost?: () => void): PairedDisplayTransport {
  let connection: ReturnType<typeof connectWorkstation> | null = null;
  let preview: LocalReceiptPreview | null = null;
  let unavailableSequence = -1;
  let lastPresence = Date.now();
  const pending = new Map<string, { resolve(value: boolean): void; timer: ReturnType<typeof setTimeout> }>();
  const failPending = () => { for (const value of pending.values()) { clearTimeout(value.timer); value.resolve(false); } pending.clear(); };
  async function intent(value: Omit<WorkstationIntent, "id">): Promise<boolean> {
    if (!connection || !preview || preview.cartId !== value.cartId || preview.revision !== value.revision) return false;
    const requestId = appLocalRequestId();
    return new Promise<boolean>(resolve => {
      const timer = setTimeout(() => { pending.delete(requestId); resolve(false); }, 12000);
      pending.set(requestId, { resolve, timer });
      void connection!.send("intent", { ...value, id: requestId }, requestId).catch(() => { clearTimeout(timer); pending.delete(requestId); resolve(false); });
    });
  }
  return {
    subscribe(receive, status) {
      connection = connectWorkstation({ role: "customer", enrollmentLost: onEnrollmentLost, status: next => { if (next === "reconnecting" || next === "waiting") { preview = null; failPending(); receive(null); } status?.(next); }, session: session => { unavailableSequence = -1; lastPresence = Date.now(); if (!session.current || session.current.id !== id || !session.current.staffOnline) { preview = null; unavailableSequence = session.current?.sequence ?? session.current?.latestEnvelope?.sequence ?? -1; failPending(); receive(null); } }, event: envelope => {
        if (envelope.kind === "preview" && envelope.sequence > unavailableSequence && validWorkstationPreview(envelope.payload)) { const value = envelope.payload; preview = Object.assign({ ...value, payload: { ...value.payload, token: "workstation:" + id } }, { workstationSequence: envelope.sequence }); receive(preview); }
        if (envelope.kind === "ack") { const ack = envelope.payload as WorkstationAck; const value = pending.get(ack.id); if (value) { clearTimeout(value.timer); pending.delete(ack.id); value.resolve(ack.accepted === true); } }
        if (envelope.kind === "presence" || envelope.kind === "preview") lastPresence = Date.now();
        if (envelope.kind === "revoked" || envelope.kind === "presence" && envelope.payload.staffOnline === false) { unavailableSequence = envelope.sequence; preview = null; failPending(); receive(null); }
      } });
      const liveness = setInterval(() => { if (preview && Date.now() - lastPresence > 30000) { preview = null; failPending(); receive(null); status?.("waiting"); } }, 3000);
      return () => { clearInterval(liveness); connection?.close(); connection = null; failPending(); };
    },
    tip: (value, amount) => intent({ kind: "tip", cartId: value.cartId, revision: value.revision, amount } as Omit<WorkstationIntent, "id">),
    customer: (value, customer) => intent({ kind: "customer", cartId: value.cartId, revision: value.revision, customer } as Omit<WorkstationIntent, "id">),
    dismiss: value => { void intent({ kind: "dismiss", cartId: value.cartId, revision: value.revision }); },
    command: async <T,>(command: string, input: Record<string, unknown>) => command === "settings" ? (await workstationRequest<PortableWorkstationSession>(undefined, "customer")).settings as T : workstationRequest<T>({ action: "customerAction", command, input }),
  };
}

"use client";
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { closingPayload, closingSnapshot, closingValues, normalizeClosingMoney, parseClosingCents, type ClosingFormValues, type ClosingMoneyField } from "./daily-closing-input";
import type { DailyPosClosingInputs } from "@/types/pos-daily-closing";

type RecordState = {revision: number; reportDate: string; locked: boolean; closingInputs: DailyPosClosingInputs};
type Intent = {requestId: string; expectedRevision: number; values: ReturnType<typeof closingPayload>};
type SaveStatus = "loading" | "idle" | "saving" | "saved" | "error" | "unknown" | "verifying" | "conflict";
type Reply = {ok: boolean; error?: string; outcomeUnknown?: boolean; scope?: string; current?: RecordState; receipt?: RecordState | null; requestId?: string};
const UNKNOWN = "The save result is not confirmed. Your entries are kept. Check the saved result or retry this same save safely.";
const CONFLICT = "Closing amounts changed on another screen. Review the saved amounts before saving.";

async function request(url: string, body?: unknown): Promise<Reply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), body ? 15000 : 10000);
  try {
    const response = await fetch(url, {method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal,
      ...(body ? {headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {})});
    const result = await response.json() as Reply;
    if (typeof result.ok !== "boolean") throw new Error("Invalid closing response");
    return result;
  } finally { clearTimeout(timer); }
}

export function useDailyClosingSave({mode, salonId, scope, reportDate, initial, canEdit, legacyDraft, clearLegacyDraft, draftStorage}: {
  mode: "owner" | "portable"; salonId: string; scope: string; reportDate: string; initial: Pick<DailyPosClosingInputs, "cashAmount" | "creditCardAmount" | "otherAmount" | "tipInput" | "entered" | "note">; canEdit: boolean;
  legacyDraft?: () => {values: ClosingFormValues; baseline?: Pick<DailyPosClosingInputs, "cashAmount" | "creditCardAmount" | "otherAmount" | "tipInput" | "entered" | "note">} | null;
  clearLegacyDraft?: () => void;
  draftStorage?: {getItem(key: string): string | null; setItem(key: string, value: string): void};
}) {
  const [values, setValues] = useState(() => closingValues(initial));
  const valuesRef = useRef(values);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [remote, setRemote] = useState<RecordState | null>(null);
  const [needsReviewRead, setNeedsReviewRead] = useState(false);
  const baseline = useRef<RecordState | null>(null);
  const intent = useRef<Intent | null>(null);
  const busy = useRef(false);
  const edits = useRef(0);
  const mounted = useRef(false);
  const storageKey = useRef<string | null>(null);
  const generation = useRef(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRef = useRef(initial);
  const legacyRef = useRef({read: legacyDraft, clear: clearLegacyDraft});
  const draftStorageRef = useRef(draftStorage);
  const readyScope = useRef("");
  const context = `${mode}:${scope}:${reportDate}`;
  const endpoint = "/api/pos/closing";
  const query = () => new URLSearchParams({mode, salonId, expectedScope:scope, date: reportDate, ...(intent.current ? {requestId: intent.current.requestId} : {})});
  const persist = () => {
    if (!storageKey.current) return;
    try { (draftStorageRef.current ?? sessionStorage).setItem(storageKey.current, JSON.stringify({values: valuesRef.current, intent: intent.current, baseline: baseline.current})); }
    catch { /* Keep the in-memory draft and its request identity. */ }
  };
  const replaceValues = (next: ClosingFormValues) => { valuesRef.current = next; setValues(next); };
  const clearTimer = () => { if (debounce.current) clearTimeout(debounce.current); debounce.current = null; };

  useEffect(() => {
    mounted.current = true;
    const epoch = ++generation.current;
    const valid = () => mounted.current && generation.current === epoch;
    if (!salonId) return () => { mounted.current = false; generation.current++; };
    void (async () => {
      try {
        const reply = await request(endpoint + "?" + new URLSearchParams({mode, salonId, expectedScope:scope, date: reportDate}));
        if (!valid()) return;
        if (!reply.ok || !reply.current || reply.current.reportDate !== reportDate || reply.scope !== scope) throw new Error(reply.error || "Unable to load the saved amounts. Your entries are kept.");
        const current = reply.current;
        storageKey.current = `reylumi:closing:${mode}:${reply.scope}:${reportDate}`;
        baseline.current = current;
        setRemote(current);
        readyScope.current = `${mode}:${scope}:${reportDate}`;
        let restored: {values?: ClosingFormValues; intent?: Intent; baseline?: RecordState} | null = null;
        try { restored = JSON.parse((draftStorageRef.current ?? sessionStorage).getItem(storageKey.current) ?? "null"); } catch { /* Start from the server snapshot. */ }
        if (!restored) {
          const old = legacyRef.current.read?.();
          if (old) restored = {values: old.values, baseline: old.baseline && closingSnapshot(closingValues(old.baseline)) !== closingSnapshot(closingValues(current.closingInputs)) ? {...current, revision: -1} : current};
        }
        if (restored?.values && ["cashAmount", "creditCardAmount", "otherAmount", "note"].every(k => typeof restored!.values![k as keyof ClosingFormValues] === "string")) {
          if (!edits.current) replaceValues({...restored.values, tipInput: restored.values.tipInput ?? ""});
          if (restored.intent && restored.baseline?.reportDate === reportDate) {
            intent.current = restored.intent;
            baseline.current = restored.baseline;
            setStatus("unknown"); setMessage(UNKNOWN); persist(); return;
          }
          if (restored.baseline && restored.baseline.revision !== current.revision && closingSnapshot(restored.values) !== closingSnapshot(closingValues(current.closingInputs))) {
            baseline.current = restored.baseline; setStatus("conflict"); setMessage(CONFLICT); persist(); return;
          }
        }
        if (closingSnapshot(closingValues(initialRef.current)) !== closingSnapshot(closingValues(current.closingInputs)) && !restored) {
          setStatus("conflict"); setMessage(CONFLICT);
        } else { setStatus("idle"); setMessage(null); }
        persist();
      } catch (error) {
        if (valid()) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Unable to load the saved amounts. Your entries are kept."); }
      }
    })();
    return () => { mounted.current = false; generation.current = epoch + 1; if (debounce.current) clearTimeout(debounce.current); };
    // The form is keyed by salon and business date; drafts belong to this scope.
  }, [mode, salonId, scope, reportDate]);

  function updateValue(key: keyof ClosingFormValues, value: string) {
    edits.current++;
    replaceValues({...valuesRef.current, [key]: value});
    if (!busy.current && !intent.current && status !== "conflict") { setStatus("idle"); setMessage(null); }
    persist();
  }

  function finish(reply: Reply, savedIntent: Intent) {
    if (!reply.receipt || !reply.current || reply.scope !== scope || reply.current.reportDate !== reportDate || reply.receipt.reportDate !== reportDate || reply.requestId !== savedIntent.requestId) throw new Error("Unconfirmed closing result");
    const current = reply.current;
    setRemote(current);
    intent.current = null;
    baseline.current = current;
    try { legacyRef.current.clear?.(); } catch { /* A legacy draft cleanup failure cannot undo an acknowledged save. */ }
    if (current.revision !== reply.receipt.revision) {
      setStatus("conflict"); setMessage("This save completed, but newer amounts are now saved. Your entries are kept for review."); persist(); return;
    }
    const draftMatches = closingSnapshot(valuesRef.current) === JSON.stringify(savedIntent.values);
    if (draftMatches) { replaceValues(closingValues(current.closingInputs)); setStatus("saved"); setMessage(null); }
    else { setStatus("idle"); setMessage("The earlier values were saved. Your newer edits are not saved yet."); }
    persist();
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(`kingpos:workspace:${salonId}`);
      channel.postMessage({salonId, resource: "report"}); channel.close();
    }
  }

  async function send(savedIntent: Intent) {
    busy.current = true; setStatus("saving"); setMessage(null); persist();
    const epoch = generation.current;
    try {
      const reply = await request(endpoint, {mode, salonId, expectedScope:scope, date: reportDate, ...savedIntent});
      if (!mounted.current || epoch !== generation.current) return;
      if (reply.ok && reply.requestId === savedIntent.requestId) finish(reply, savedIntent);
      else if (reply.outcomeUnknown || reply.ok) { setStatus("unknown"); setMessage(UNKNOWN); }
      else {
        intent.current = null;
        const stale = Boolean(reply.error?.includes("changed on another screen"));
        setNeedsReviewRead(stale);
        setStatus(stale ? "conflict" : "error");
        setMessage(reply.error || "Unable to save daily closing."); persist();
      }
    } catch {
      if (mounted.current && epoch === generation.current) { setStatus("unknown"); setMessage(UNKNOWN); }
    } finally {
      if (mounted.current && epoch === generation.current) { busy.current = false; persist(); }
    }
  }

  function save(force = false) {
    clearTimer();
    if (busy.current || !canEdit || remote?.locked) return;
    if (intent.current) { setStatus("unknown"); setMessage(UNKNOWN); return; }
    if (!baseline.current || readyScope.current !== context) { setMessage("Check the saved amounts before saving. Your entries are kept."); return; }
    if (status === "conflict") { setMessage(CONFLICT); return; }
    try {
      const payload = closingPayload(valuesRef.current);
      if (!force && JSON.stringify(payload) === closingSnapshot(closingValues(baseline.current.closingInputs))) return;
      // Refs serialize blur, Enter and multiple clicks before React renders.
      intent.current = {requestId: crypto.randomUUID(), expectedRevision: baseline.current.revision, values: payload};
      void send(intent.current);
    } catch (error) { setStatus("error"); setMessage(error instanceof Error ? error.message : "Invalid amount."); }
  }

  async function verify() {
    clearTimer(); if (busy.current) return;
    busy.current = true; setStatus("verifying"); setMessage(null);
    const epoch = generation.current, pending = intent.current;
    try {
      const reply = await request(endpoint + "?" + query());
      if (!mounted.current || epoch !== generation.current) return;
      if (!reply.ok || !reply.current || reply.scope !== scope || reply.current.reportDate !== reportDate) throw new Error("Unable to check saved result");
      setRemote(reply.current);
      setNeedsReviewRead(false);
      if (pending && reply.receipt) finish({...reply,requestId:pending.requestId}, pending);
      else if (pending && reply.current.revision === pending.expectedRevision) { setStatus("unknown"); setMessage("No completed save is confirmed yet. Retry this same save safely, or check again. Your newer edits are kept."); }
      else {
        intent.current = null; baseline.current = reply.current; readyScope.current = context;
        if (reply.scope) storageKey.current = `reylumi:closing:${mode}:${reply.scope}:${reportDate}`;
        if (closingSnapshot(valuesRef.current) === closingSnapshot(closingValues(reply.current.closingInputs))) { setStatus("idle"); setMessage("The displayed amounts match the saved record."); }
        else { setStatus("conflict"); setMessage(CONFLICT); }
        persist();
      }
    } catch { if (mounted.current && epoch === generation.current) { setStatus(pending ? "unknown" : "error"); setMessage("Unable to check the saved result. Your entries are kept. Try checking again when connected."); } }
    finally { if (mounted.current && epoch === generation.current) busy.current = false; }
  }

  function retry() { clearTimer(); if (intent.current && !busy.current && canEdit) void send(intent.current); }
  function useRemote(keepEntries: boolean) {
    if (!remote || needsReviewRead || busy.current || intent.current) return;
    baseline.current = remote;
    if (!keepEntries) replaceValues(closingValues(remote.closingInputs));
    setStatus("idle"); setMessage(keepEntries ? "Review your entries, then select Save to replace the saved amounts." : null); persist();
  }
  function focusMoney(key: ClosingMoneyField, event: FocusEvent<HTMLInputElement>) {
    if (parseClosingCents(valuesRef.current[key]) === 0) updateValue(key, "");
    else event.currentTarget.select();
  }
  function blurMoney(key?: ClosingMoneyField) {
    if (key) updateValue(key, normalizeClosingMoney(valuesRef.current[key]));
    clearTimer(); debounce.current = setTimeout(() => save(), 250);
  }
  function handleEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault(); event.currentTarget.blur(); save();
  }
  return {values, status, message, remote, updateValue, focusMoney, blurMoney, handleEnter, save, verify, retry, useRemote,
    isPending: status === "saving" || status === "verifying", hasUnknown: status === "unknown", conflict: status === "conflict", canReview: !needsReviewRead && Boolean(remote), ready: status !== "loading", locked: !canEdit || Boolean(remote?.locked)};
}

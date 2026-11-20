"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useOverlayPortalHost } from "@/components/overlay-dismissal";
import { AD_REPORT_REASONS, type AdReportReceipt, type AdReportSubmission, type AdSelectionDisclosure, type AdSelectionDetail } from "@/types/ad-disclosure";

const RECEIPT_KEY = "reylumi-ad-report-pending-v1";
const RECEIPT_TTL = 30 * 60 * 1000;
const MAX_RECEIPT_BYTES = 40000;
const MAX_RECEIPTS = 3;
type Pending = { version: 1; scope: string; createdAt: number; input: AdReportSubmission };
const labels = { scam: "Scam or misleading", sexual: "Sexual content", violence: "Violence or harmful content", age_inappropriate: "Inappropriate for the app's age rating", intellectual_property: "Copyright or other rights", other: "Other concern" };
const secondary = { position: "static", width: "auto", height: "auto", minHeight: 44, padding: "8px 4px", border: 0, background: "transparent", color: "var(--brand, #824b5b)", font: "inherit", fontSize: 13, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" } as const;
export function clearAdReportPending(scope?: string, requestId?: string) {
  try {
    if (scope === undefined && requestId === undefined) { sessionStorage.removeItem(RECEIPT_KEY); return; }
    const entries = readPendingEntries();
    const remaining = entries.filter(value => value.scope !== scope || value.input.requestId !== requestId);
    if (remaining.length === entries.length) return;
    writePendingEntries(remaining);
  } catch { /* No private fallback storage. */ }
}
function validPending(value: Pending) {
  return value && Object.keys(value).sort().join("|") === ["version","scope","createdAt","input"].sort().join("|") && value.version === 1 && /^[a-f0-9]{64}$/.test(value.scope) && Number.isFinite(value.createdAt) && value.createdAt <= Date.now() &&
    value.input && Object.keys(value.input).sort().join("|") === ["requestId", "kind", "proof", "reason", "details"].sort().join("|") &&
    /^[0-9a-f-]{36}$/i.test(value.input.requestId) && ["owner_campaign", "platform_campaign"].includes(value.input.kind) &&
    typeof value.input.proof === "string" && /^v1\.[a-zA-Z0-9_-]+$/.test(value.input.proof) && value.input.proof.length <= 33000 &&
    AD_REPORT_REASONS.includes(value.input.reason) && typeof value.input.details === "string" && value.input.details.length <= 1000 &&
    new TextEncoder().encode(JSON.stringify(value)).length <= MAX_RECEIPT_BYTES;
}
function writePendingEntries(entries: Pending[]) {
  if (!entries.length) { sessionStorage.removeItem(RECEIPT_KEY); return; }
  if (entries.length > MAX_RECEIPTS) throw new Error("Recover an earlier report before starting another.");
  const raw = JSON.stringify({ version:1, entries });
  if (new TextEncoder().encode(raw).length > MAX_RECEIPT_BYTES * MAX_RECEIPTS) throw new Error("Report recovery is too large.");
  sessionStorage.setItem(RECEIPT_KEY,raw);
  if (sessionStorage.getItem(RECEIPT_KEY) !== raw) throw new Error("Report recovery could not be saved.");
}
function readPendingEntries(): Pending[] {
  const raw = sessionStorage.getItem(RECEIPT_KEY);
  if (!raw) return [];
  if (new TextEncoder().encode(raw).length > MAX_RECEIPT_BYTES * MAX_RECEIPTS) throw new Error("Invalid report recovery.");
  const stored = JSON.parse(raw);
  if (!stored || Object.keys(stored).sort().join("|") !== "entries|version" || stored.version !== 1 || !Array.isArray(stored.entries) || stored.entries.length > MAX_RECEIPTS || !stored.entries.every(validPending) || new Set(stored.entries.map((entry:Pending) => entry.scope)).size !== stored.entries.length) throw new Error("Invalid report recovery.");
  const current: Pending[] = stored.entries.filter((entry:Pending) => Date.now()-entry.createdAt <= RECEIPT_TTL);
  if (current.length !== stored.entries.length) writePendingEntries(current);
  return current;
}
function readPending(scope: string): Pending | null { return readPendingEntries().find(entry => entry.scope === scope) ?? null; }
function savePending(value: Pending) {
  if (!validPending(value) || Date.now()-value.createdAt > RECEIPT_TTL) throw new Error("Report recovery expired.");
  const entries = readPendingEntries(), previous = entries.find(entry => entry.scope === value.scope);
  if (previous && JSON.stringify(previous) !== JSON.stringify(value)) throw new Error("Recover your earlier report before starting another.");
  writePendingEntries(previous ? entries : [...entries,value]);
}

/** Sibling controls, never nested in an ad destination. No view/click transport. */
type ControlProps = { disclosure?: AdSelectionDisclosure; displayDetails?: AdSelectionDetail[]; onOpenChange?: (open: boolean) => void };
export function AdDisclosureControls(props: ControlProps) {
  return <AdDisclosureControlsScope key={props.disclosure?.reportScope ?? "none"} {...props}/>;
}
function AdDisclosureControlsScope({ disclosure, displayDetails = [], onOpenChange }: ControlProps) {
  const [mode, setMode] = useState<"why" | "report" | null>(null);
  const [reason, setReason] = useState<AdReportSubmission["reason"]>("scam");
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [received, setReceived] = useState<{ receipt: AdReportReceipt; supportHref: string | null } | null>(null);
  const [opened, setOpened] = useState<{disclosure:AdSelectionDisclosure;displayDetails:AdSelectionDetail[]} | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const generation = useRef(0);
  const scope = disclosure?.reportScope ?? "";
  const currentScope = useRef(scope);
  const titleId = useId();
  const portalHost = useOverlayPortalHost();
  useLayoutEffect(() => {
    currentScope.current = scope; generation.current += 1;
    const element = dialog.current;
    const epoch = generation.current;
    queueMicrotask(() => { if (generation.current === epoch) setBusy(false); });
    // Other actors' uncertain attempts stay opaque and cannot enter this form.
    if (scope) { try { readPending(scope); } catch { /* Admission remains fail-closed on submit. */ } }
    return () => { generation.current += 1; currentScope.current = ""; element?.close(); };
  }, [scope,portalHost]);
  useEffect(() => {
    onOpenChange?.(mode !== null);
    const element = dialog.current;
    if (mode && element && !element.open) element.showModal();
    if (!mode && element?.open) element.close();
    return () => { onOpenChange?.(false); };
  }, [mode, onOpenChange]);
  function open(next: "why" | "report") {
    if (!disclosure) return;
    const selected = mode && opened ? opened : { disclosure: structuredClone(disclosure), displayDetails: structuredClone(displayDetails) };
    setOpened(selected);
    if (next === "report") {
      try {
        const restored = readPending(scope);
        setPending(restored);
        if (restored) { setReason(restored.input.reason); setDetails(restored.input.details); setMessage("An earlier report is awaiting confirmation. Retry that exact report to check its status."); }
        else if (opened?.disclosure.selectionId !== selected.disclosure.selectionId) { setReason("scam"); setDetails(""); setReceived(null); setMessage(""); }
      } catch { setMessage("Report recovery storage is unavailable. Enable session storage before sending a report."); }
    }
    setMode(next);
  }
  function close() { setMode(null); }
  async function submit() {
    const selected = opened?.disclosure;
    if (!selected || busy || received || currentScope.current !== scope) return;
    const attempt = pending ?? { version: 1 as const, scope, createdAt: Date.now(), input: { requestId: crypto.randomUUID(), kind: selected.kind, proof: selected.proof, reason, details } };
    try { savePending(attempt); }
    catch { setMessage("Report recovery could not be saved. Your details are still here; this request was not sent."); return; }
    setPending(attempt); setBusy(true); setMessage("");
    const epoch = ++generation.current;
    try {
      const response = await fetch("/api/advertising/reports", { method: "POST", credentials: "same-origin", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt.input) });
      const result = await response.json();
      if (epoch !== generation.current || currentScope.current !== scope) return;
      if (response.ok && result.ok === true && typeof result.receipt?.reportId === "string" && /^[0-9a-f-]{36}$/i.test(result.receipt.reportId) && typeof result.receipt.reference === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(result.receipt.reference)) {
        clearAdReportPending(scope,attempt.input.requestId); setPending(null);
        setReceived({ receipt: result.receipt, supportHref: result.supportHref === `/support/${result.receipt.reportId}` ? result.supportHref : null });
      } else if (result.ok === false && result.outcome === "rejected") {
        clearAdReportPending(scope,attempt.input.requestId); setPending(null); setMessage(typeof result.error === "string" ? result.error : "The report was not accepted. Your draft is still here.");
      } else { setMessage("Confirmation is pending. Retry the same report; its reason and details are locked until the result is known."); }
    } catch {
      if (epoch === generation.current && currentScope.current === scope) setMessage("Confirmation is pending. Retry the same report; its reason and details are locked until the result is known.");
    } finally { if (epoch === generation.current && currentScope.current === scope) setBusy(false); }
  }
  if (!disclosure) return null;
  const shown = opened?.disclosure ?? disclosure;
  const shownDetails = opened?.displayDetails ?? displayDetails;
  return <div data-ad-disclosure onClick={event => event.stopPropagation()} style={{ display: "flex", gap: 16, flexShrink:0, alignItems: "center", fontFamily: "inherit" }}>
    <button type="button" style={secondary} onClick={() => open("why")}>Why this ad</button>
    <button type="button" style={secondary} onClick={() => open("report")}>Report ad</button>
    {portalHost ? createPortal(<dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }} onClose={close}
      style={{ width: "min(480px, calc(100vw - 32px))", maxHeight: "85dvh", padding: 24, border: "1px solid var(--border, #e5d9dd)", borderRadius: 20, background: "var(--surface, white)", color: "var(--foreground, #332a2d)", fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}><h2 id={titleId} style={{ fontSize: 20, margin: 0 }}>{mode === "why" ? "Why this ad" : received ? "Report received" : "Report ad"}</h2><button type="button" aria-label="Close ad information" onClick={close} style={{ ...secondary, minWidth: 44, fontSize: 24, textDecoration: "none" }}>×</button></div>
      {mode === "why" ? <>
        <p style={{ fontWeight: 600 }}>{shown.advertiserName}</p>
        <ul style={{ paddingLeft: 20 }}>{shown.primaryReasons.map(reason => <li key={reason} style={{ marginBlock: 12 }}>{reason}</li>)}</ul>
        <details><summary style={{ ...secondary, display: "list-item" }}>All selection details</summary><dl style={{ fontSize: 14, overflowWrap: "anywhere" }}>{[...shown.details, ...shownDetails].map((detail, index) => <div key={index} style={{ marginBlock: 16 }}><dt style={{ fontWeight: 600 }}>{detail.label}</dt><dd style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{detail.value}</dd></div>)}</dl></details>
        <button type="button" style={secondary} onClick={() => open("report")}>Report a concern about this ad</button>
      </> : received ? <>
        <p>Your report was saved. Reference: <strong>{received.receipt.reference}</strong>.</p>
        {received.supportHref ? <p><a href={received.supportHref}>Open your Support case</a></p> : <p>Keep this reference. Guest reports do not create a Support chat.</p>}
        <p>Reporting does not automatically remove the ad.</p>
      </> : <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <p>{pending ? "Recover your earlier report" : shown.advertiserName}</p>
        <label style={{ display: "block", marginBlock: 16 }}>Concern<select aria-label="Ad report concern" disabled={busy || Boolean(pending)} value={reason} onChange={event => setReason(event.target.value as AdReportSubmission["reason"])} style={{ display: "block", width: "100%", minHeight: 44, marginTop: 6, font: "inherit" }}>{AD_REPORT_REASONS.map(value => <option key={value} value={value}>{labels[value]}</option>)}</select></label>
        <label style={{ display: "block", marginBlock: 16 }}>Details (optional)<textarea aria-label="Ad report details" maxLength={1000} rows={4} disabled={busy || Boolean(pending)} value={details} onChange={event => setDetails(event.target.value)} style={{ display: "block", width: "100%", marginTop: 6, font: "inherit", padding: 8 }} /></label>
        <p style={{ fontSize: 13 }}>Please avoid passwords, payment details or other private information. Reporting does not automatically remove the ad.</p>
        {message ? <p role="status">{message}</p> : null}
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}><button type="submit" disabled={busy} style={{ minHeight: 44, padding: "10px 18px", border: 0, borderRadius: 12, background: "var(--brand, #824b5b)", color: "white", font: "inherit" }}>{busy ? "Checking…" : pending ? "Retry same report" : "Send report"}</button><button type="button" style={secondary} onClick={close}>{pending ? "Close" : "Cancel"}</button></div>
      </form>}
    </dialog>,portalHost) : null}
  </div>;
}

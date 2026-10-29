"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import type { checkWriterState } from "@/lib/check-writer-server";
import {
  DEFAULT_STUBS,
  STUB_FIELDS,
  type CheckSettings,
  type StubOptions,
} from "@/types/check-writer";
import styles from "./check-writer.module.css";
import { checkCents } from "@/lib/check-writer-rules";
type State = Awaited<ReturnType<typeof checkWriterState>>;
type RequestBody = Record<string, unknown>;
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n,
  );
const checkFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, {
    ...init,
    signal:
      typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(30000)
        : init?.signal,
  });
function coveredStaff(data: State) {
  const run = data.selectedRun;
  return new Set(
    data.history
      .filter((record) => {
        const source = record.snapshot.source;
        return (
          record.status === "issued" &&
          source &&
          run &&
          source.periodStart <= run.period_end &&
          source.periodEnd >= run.period_start
        );
      })
      .map((record) => record.snapshot.source!.staffId),
  );
}
async function request(body: RequestBody) {
  const r = await checkFetch("/api/check-writer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const v = await r.json();
  if (!r.ok) throw Error(v.error);
  return v;
}
const labels = {
  check: "Check payout",
  cash: "Cash payout",
  tip: "Tip",
  bonus: "Bonus",
  gross: "Service sales (gross)",
};
function StubEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: StubOptions;
  onChange: (value: StubOptions) => void;
  disabled?: boolean;
}) {
  const t = useWorkspaceTranslation();
  const [expanded, setExpanded] = useState(false);

  function toggle(
    copy: "payee" | "salon",
    field: (typeof STUB_FIELDS)[number],
  ) {
    const fields = value[copy].includes(field)
      ? value[copy].filter((f) => f !== field)
      : [...value[copy], field];
    onChange({
      ...value,
      [copy]: fields,
      ...(value.same ? { payee: fields, salon: fields } : {}),
    });
  }
  return (
    <details
      className={styles.form}
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>{t("Check stub details")}</summary>
      <p className={styles.muted}>
        {t("Default on both: check amount + memo.")}
      </p>
      <label className={styles.choice}>
        <input
          type="checkbox"
          disabled={disabled}
          checked={value.same}
          onChange={(e) =>
            onChange({
              ...value,
              same: e.target.checked,
              ...(e.target.checked ? { salon: [...value.payee] } : {}),
            })
          }
        />
        {t("Same details on both stubs")}
      </label>
      {(["payee", "salon"] as const)
        .filter((copy) => !value.same || copy === "payee")
        .map((copy) => (
          <fieldset key={copy} disabled={disabled}>
            <legend>
              {t(
                value.same
                  ? "Both copies"
                  : copy === "payee"
                    ? "Payee copy"
                    : "Salon copy",
              )}
            </legend>
            {STUB_FIELDS.map((field) => (
              <label className={styles.choice} key={field}>
                <input
                  type="checkbox"
                  checked={value[copy].includes(field)}
                  onChange={() => toggle(copy, field)}
                />
                {t(labels[field])}
              </label>
            ))}
          </fieldset>
        ))}
      <p className={styles.notice}>
        {t("Tip and bonus are included details, not extra amounts.")}
      </p>
    </details>
  );
}
export function CheckWriter({
  expectedSalonId,
}: { expectedSalonId?: string } = {}) {
  const t = useWorkspaceTranslation(),
    [state, setState] = useState<State>(),
    [tab, setTab] = useState("payroll"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [unlocked, setUnlocked] = useState(false),
    [unlockOpen, setUnlockOpen] = useState(false),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [payees, setPayees] = useState<Record<string, string>>({}),
    [stubs, setStubs] = useState<StubOptions>(DEFAULT_STUBS),
    [payee, setPayee] = useState(""),
    [amount, setAmount] = useState(""),
    [memo, setMemo] = useState(""),
    [date, setDate] = useState(""),
    [issuer, setIssuer] = useState(""),
    [address, setAddress] = useState("");
  const [testPrint, setTestPrint] = useState(false);
  const [recoveryId, setRecoveryId] = useState<string>();
  const [outputId, setOutputId] = useState<string>(),
    [outputUsed, setOutputUsed] = useState(false),
    [printReady, setPrintReady] = useState(false);
  const [preview, setPreview] = useState(""),
    [review, setReview] = useState(false),
    [created, setCreated] = useState<string[]>([]),
    [printedUrl, setPrintedUrl] = useState(""),
    [confirmPrint, setConfirmPrint] = useState(false),
    [formSettings, setFormSettings] = useState<CheckSettings>(),
    [editBank, setEditBank] = useState(false),
    [offset, setOffset] = useState({ x: 0, y: 0 });
  const [bank, setBank] = useState({
    name: "",
    city: "",
    routing: "",
    account: "",
    fractional: "",
  });
  const intent = useRef<RequestBody | null>(null),
    pending = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    urls = useRef<string[]>([]),
    payeeFilter = useRef("");
  const generation = useRef(0),
    outputLatch = useRef(false),
    lastRun = useRef<string | undefined>(undefined),
    currentTab = useRef("payroll");
  const invalidateView = useCallback(() => {
    generation.current++;
  }, []);
  const expireAccess = useCallback(() => {
    generation.current++;
    setUnlocked(false);
    setUnlockOpen(false);
    setPassword("");
    setCode("");
    setBank({ name: "", city: "", routing: "", account: "", fractional: "" });
    setPreview("");
    setReview(false);
    setPrintedUrl("");
    setOutputId(undefined);
    setPrintReady(false);
    setOutputUsed(true);
    outputLatch.current = true;
    urls.current.forEach(URL.revokeObjectURL);
    urls.current = [];
  }, []);
  const blobURL = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return url;
  };
  const reload = useCallback(
    async function load(run?: string, initial = false) {
      const epoch = generation.current;
      const query = new URLSearchParams(window.location.search);
      if (initial && !run && query.get("start") && query.get("end"))
        run = `live:${query.get("start")}:${query.get("end")}`;
      const r = await checkFetch(
          "/api/check-writer" + (run ? "?run=" + encodeURIComponent(run) : ""),
          { cache: "no-store" },
        ),
        v = await r.json();
      if (!r.ok) throw Error(v.error);
      const data = v as State;
      if (epoch !== generation.current) return;
      if (expectedSalonId && data.salonId !== expectedSalonId)
        throw Error(
          "Workspace changed. Reopen Check Writer for the selected salon.",
        );
      if (initial && !run) {
        const matching = data.runs.find(
          (r) =>
            r.period_start === query.get("start") &&
            r.period_end === query.get("end"),
        );
        if (matching && matching.id !== data.selectedRun?.id) {
          await load(matching.id, true);
          return;
        }
      }
      if (initial) setDate(data.businessDate);
      setState(data);
      try {
        const recovery = sessionStorage.getItem(
          "check-writer-pending:" + data.salonId,
        );
        if (recovery && /^[a-f\d-]{36}$/i.test(recovery))
          setRecoveryId(recovery);
      } catch {}
      setFormSettings(data.settings);
      const resetForm = initial || lastRun.current !== data.selectedRun?.id;
      lastRun.current = data.selectedRun?.id;
      const covered = coveredStaff(data);
      if (!resetForm) {
        setSelected((previous) =>
          previous.filter((id) =>
            data.lines.some(
              (line) => line.id === id && !covered.has(line.staff_id),
            ),
          ),
        );
        return;
      }
      setIssuer(data.settings.issuer);
      setAddress(data.settings.address);
      setStubs(data.settings.stubs);
      payeeFilter.current = query.get("staff") ?? "";
      setSelected(
        data.lines
          .filter(
            (l) =>
              l.final_check_amount > 0 &&
              !covered.has(l.staff_id) &&
              (!payeeFilter.current || l.staff_id === payeeFilter.current),
          )
          .map((l) => l.id),
      );
      setMemo(
        currentTab.current === "standalone"
          ? ""
          : data.selectedRun
            ? `Payroll ${data.selectedRun.period_start} – ${data.selectedRun.period_end}`
            : "",
      );
    },
    [expectedSalonId],
  );
  useEffect(() => {
    let active = true;
    void reload(undefined, true).catch((e) => {
      if (active) setError(e.message);
    });
    queueMicrotask(() => {
      try {
        const saved = JSON.parse(
          localStorage.getItem("check-writer-alignment") ?? "null",
        );
        if (
          saved &&
          [saved.x, saved.y].every(
            (v: unknown) => typeof v === "number" && Math.abs(v) <= 12.7,
          )
        )
          setOffset(saved);
      } catch {}
    });
    return () => {
      active = false;
      invalidateView();
      urls.current.forEach(URL.revokeObjectURL);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reload, invalidateView]);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") {
        expireAccess();
        void fetch("/api/check-writer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "lock" }),
          keepalive: true,
        });
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, [expireAccess]);
  async function work(fn: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    const epoch = generation.current;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (epoch !== generation.current) return;
      setError(
        e instanceof Error
          ? e.message
          : "Check Writer could not complete this request.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function requireUnlock() {
    if (unlocked) return true;
    setUnlockOpen(true);
    return false;
  }
  function changeTab(next: string) {
    if (pending.current) return;
    currentTab.current = next;
    if (state) {
      setIssuer(state.settings.issuer);
      setAddress(state.settings.address);
      setStubs(state.settings.stubs);
    }
    setTab(next);
    setReview(false);
    setPreview("");
    setCreated([]);
    setPrintedUrl("");
    intent.current = null;
    setMemo(
      next === "standalone"
        ? ""
        : state?.selectedRun
          ? `Payroll ${state.selectedRun.period_start} – ${state.selectedRun.period_end}`
          : "",
    );
  }
  function send(body: RequestBody) {
    return request({ ...body, salonId: state?.salonId });
  }
  function payload(action: string): RequestBody {
    return {
      action,
      salonId: state?.salonId,
      requestId: crypto.randomUUID(),
      mode: tab,
      runId: state?.selectedRun?.id,
      runVersion: state?.selectedRun?.version,
      settingsVersion: state?.settings.version,
      date,
      memo,
      issuer,
      address,
      stubs,
      payee,
      amount,
      lines: state?.lines
        .filter((l) => selected.includes(l.id))
        .map((l) => ({
          id: l.id,
          updatedAt: l.updated_at,
          amount: l.final_check_amount,
          payee: payees[l.id] ?? "",
        })),
    };
  }
  async function reviewChecks() {
    if (recoveryId) return;
    if (!requireUnlock()) return;
    await work(async () => {
      const epoch = generation.current;
      const body = payload("preview");
      const r = await checkFetch("/api/check-writer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error((await r.json()).error);
      const blob = await r.blob();
      if (epoch !== generation.current) return;
      setPreview(blobURL(blob));
      intent.current = { ...body, action: "issue" };
      setReview(true);
      setCreated([]);
    });
  }
  async function preparePdf(ids: string[], reprint = false) {
    const epoch = generation.current;
    const reason = reprint
      ? window.prompt(t("Reason for printing this check again"))
      : null;
    if (reprint && !reason?.trim()) return;
    const masked = await checkFetch("/api/check-writer/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        salonId: state?.salonId,
        ids,
        preview: true,
        x: offset.x,
        y: offset.y,
      }),
    });
    if (!masked.ok) throw Error((await masked.json()).error);
    const maskedBlob = await masked.blob();
    if (epoch !== generation.current) return;
    const r = await checkFetch("/api/check-writer/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        salonId: state?.salonId,
        ids,
        x: offset.x,
        y: offset.y,
        reason,
      }),
    });
    if (!r.ok) throw Error((await r.json()).error);
    const blob = await r.blob();
    if (epoch !== generation.current) return;
    const ticket = r.headers.get("X-Check-Writer-Output-ID");
    if (!ticket)
      throw Error(
        "Output authorization is missing. Review History before retrying.",
      );
    setOutputId(ticket);
    setOutputUsed(false);
    outputLatch.current = false;
    setPrintReady(false);
    setPreview(blobURL(maskedBlob));
    setTestPrint(false);
    setPrintedUrl(blobURL(blob));
    setCreated(ids);
    setConfirmPrint(true);
  }
  async function issue() {
    if (!requireUnlock() || !intent.current || recoveryId) return;
    await work(async () => {
      const epoch = generation.current;
      const id = String(intent.current!.requestId);
      sessionStorage.setItem("check-writer-pending:" + state!.salonId, id);
      setRecoveryId(id);
      const result = await send(intent.current!);
      if (epoch !== generation.current) return;
      sessionStorage.removeItem("check-writer-pending:" + state!.salonId);
      setRecoveryId(undefined);
      setCreated(result.ids);
      setReview(false);
      await preparePdf(result.ids);
    });
  }
  async function recoverCreation(cancel = false) {
    if (!recoveryId || !requireUnlock()) return;
    await work(async () => {
      const epoch = generation.current;
      const result = await send({
        action: cancel ? "cancel_creation" : "recover_creation",
        requestId: recoveryId,
      });
      if (epoch !== generation.current) return;
      if (result.status === "created" || result.status === "canceled") {
        sessionStorage.removeItem("check-writer-pending:" + state!.salonId);
        setRecoveryId(undefined);
        intent.current = null;
        setReview(false);
        if (result.status === "created") {
          setCreated(result.ids);
          setTab("history");
          currentTab.current = "history";
        }
        await reload(state!.selectedRun?.id);
      } else
        setError(
          t(
            "Creation is still pending. Check again, or cancel the pending request safely before starting a new check.",
          ),
        );
    });
  }
  async function printPdf(method: "print" | "download" = "print") {
    if (!printedUrl || outputLatch.current || pending.current) return;
    if (!requireUnlock()) return;
    const epoch = generation.current;
    outputLatch.current = true;
    setOutputUsed(true);
    await work(async () => {
      if (!testPrint) await send({ action: "dispatch", outputId, method });
      if (epoch !== generation.current) return;
      if (method === "download") {
        const link = document.createElement("a");
        link.href = printedUrl;
        link.download = testPrint
          ? "check-writer-alignment.pdf"
          : "check-writer.pdf";
        link.click();
        return;
      }
      const bridge = window as unknown as {
        __reylumiCheckWriterPDF?: number;
        webkit?: {
          messageHandlers?: { reylumi?: { postMessage: (v: unknown) => void } };
        };
      };
      if (
        (bridge.__reylumiCheckWriterPDF ?? 0) >= 2 &&
        bridge.webkit?.messageHandlers?.reylumi
      ) {
        const blob = await (await fetch(printedUrl)).blob();
        if (epoch !== generation.current) return;
        const reader = new FileReader();
        reader.onload = () => {
          if (epoch !== generation.current) return;
          bridge.webkit!.messageHandlers!.reylumi!.postMessage({
            action: "print-check-pdf",
            jobId: outputId ?? crypto.randomUUID(),
            data: String(reader.result).split(",")[1],
          });
        };
        reader.readAsDataURL(blob);
      } else if (/ReylumiIOS\//.test(navigator.userAgent)) {
        setError(
          t("Update Reylumi for native check printing, or download the PDF."),
        );
      } else {
        const iframe = document.getElementById(
          "check-writer-print",
        ) as HTMLIFrameElement | null;
        try {
          iframe?.contentWindow?.focus();
          iframe?.contentWindow?.print();
        } catch {
          setError(t("Open or download the PDF to print at actual size."));
        }
      }
    });
  }
  if (!state)
    return (
      <main className={styles.root}>
        <h1>Check Writer</h1>
        {error ? (
          <p role="alert" className={styles.error}>
            {t(error)}
          </p>
        ) : (
          <p>{t("Loading…")}</p>
        )}
        <Link href="/market">{t("Market")}</Link>
      </main>
    );
  const selectedLines = state.lines.filter((l) => selected.includes(l.id)),
    total =
      tab === "payroll"
        ? selectedLines.reduce((sum, l) => sum + l.final_check_amount, 0)
        : (() => {
            try {
              return checkCents(amount) / 100;
            } catch {
              return 0;
            }
          })();
  const covered = coveredStaff(state);
  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <div>
          <p className={styles.muted}>
            <Link href="/market">{t("Market")}</Link> / Check Writer
          </p>
          <h1>Check Writer</h1>
          <p className={styles.muted}>{t("Created by Reylumi")}</p>
        </div>
        <button
          className={styles.secondary}
          onClick={() =>
            unlocked
              ? void work(async () => {
                  await send({ action: "lock" });
                  expireAccess();
                })
              : setUnlockOpen(true)
          }
        >
          {t(unlocked ? "Lock" : "Unlock Check Writer")}
        </button>
      </header>
      {recoveryId && (
        <section className={styles.notice} aria-label={t("Recover creation")}>
          <p>
            {t(
              "A creation request may have completed. Recover its status before creating another check.",
            )}
          </p>
          <div className={styles.actions}>
            <button
              disabled={busy}
              className={styles.secondary}
              onClick={() => void recoverCreation()}
            >
              {t("Recover creation")}
            </button>
            <button
              disabled={busy}
              className={styles.secondary}
              onClick={() => void recoverCreation(true)}
            >
              {t("Cancel pending creation safely")}
            </button>
          </div>
        </section>
      )}
      {error && !unlockOpen && !printedUrl && (
        <p role="alert" className={styles.error}>
          {t(error)}
        </p>
      )}
      {!state.active ? (
        <section className={styles.form}>
          <h2>{t("Activate Check Writer")}</h2>
          <p>{t("Activate Check Writer for this salon in Market.")}</p>
          <Link
            className={styles.button}
            href="/market?activate=print-check&q=Check%20Writer"
          >
            {t("View plans")}
          </Link>
          <button
            className={styles.secondary}
            onClick={() => changeTab("history")}
          >
            {t("History")}
          </button>
        </section>
      ) : null}
      <nav className={styles.tabs} aria-label={t("Check Writer sections")}>
        {[
          ["payroll", "From Payroll"],
          ["standalone", "Standalone check"],
          ["history", "History"],
          ["settings", "Check settings"],
        ].map(([id, label]) => (
          <button
            key={id}
            disabled={busy}
            aria-pressed={tab === id}
            onClick={() => changeTab(id)}
          >
            {t(label)}
          </button>
        ))}
      </nav>
      {tab === "payroll" && state.payrollError && (
        <p role="alert" className={styles.error}>
          {t(state.payrollError)}
        </p>
      )}
      {["payroll", "standalone"].includes(tab) && state.active && (
        <>
          <div className={styles.workspace}>
            <section className={styles.form}>
              <h2>{t(tab === "payroll" ? "Print checks" : "New check")}</h2>
              {tab === "payroll" ? (
                <>
                  <label>
                    {t("Payroll period")}
                    <select
                      value={state.selectedRun?.id ?? ""}
                      onChange={(e) =>
                        void work(async () => {
                          await reload(e.target.value);
                          setReview(false);
                          intent.current = null;
                        })
                      }
                    >
                      <option value="">{t("Current Payroll")}</option>
                      {!state.runs.length && (
                        <option>{t("No locked payroll available")}</option>
                      )}
                      {state.runs.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.period_start} – {r.period_end} · {r.status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className={styles.badge}>
                    {t(
                      state.selectedRun?.status === "live"
                        ? "Amounts from Payroll · snapshot on confirmation"
                        : "Amounts from saved payroll",
                    )}
                  </p>
                  {state.lines.map((line) => (
                    <div className={styles.employee} key={line.id}>
                      <label className={styles.choice}>
                        <input
                          type="checkbox"
                          disabled={
                            line.final_check_amount <= 0 ||
                            covered.has(line.staff_id) ||
                            review
                          }
                          checked={selected.includes(line.id)}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? [...selected, line.id]
                                : selected.filter((id) => id !== line.id),
                            )
                          }
                        />
                        <span>{line.staff_display_name_snapshot}</span>
                        <strong>{money(line.final_check_amount)}</strong>
                      </label>
                      {covered.has(line.staff_id) && (
                        <p className={styles.muted}>
                          {t(
                            "A check already covers this payroll. Use History.",
                          )}
                        </p>
                      )}
                      {line.final_check_amount <= 0 && (
                        <p className={styles.muted}>
                          {t("Zero or negative checks cannot be issued.")}
                        </p>
                      )}
                      {selected.includes(line.id) &&
                        !line.staff_legal_name_snapshot && (
                          <label>
                            {t("Confirm legal payee name")}
                            <input
                              value={payees[line.id] ?? ""}
                              maxLength={160}
                              disabled={review || busy}
                              onChange={(e) =>
                                setPayees({
                                  ...payees,
                                  [line.id]: e.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <p className={styles.notice}>{t("Not linked to payroll")}</p>
                  <label>
                    {t("Pay to")}
                    <input
                      value={payee}
                      maxLength={160}
                      disabled={review || busy}
                      onChange={(e) => setPayee(e.target.value)}
                    />
                  </label>
                  <label>
                    {t("Amount")}
                    <input
                      inputMode="decimal"
                      value={amount}
                      disabled={review || busy}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </label>
                </>
              )}
              <details>
                <summary>
                  {t("Issuer")}: {issuer}
                </summary>
                <label>
                  {t("Issuer")}
                  <input
                    value={issuer}
                    maxLength={160}
                    disabled={review || busy}
                    onChange={(e) => setIssuer(e.target.value)}
                  />
                </label>
                <label>
                  {t("Issuer address")}
                  <textarea
                    value={address}
                    maxLength={500}
                    disabled={review || busy}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </label>
              </details>
              <p className={styles.muted}>
                {state.settings.bankName} · ••{state.settings.last4}
              </p>
              <label>
                {t("Check date")}
                <input
                  type="date"
                  value={date}
                  disabled={review || busy}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                {t("Memo")}
                <textarea
                  maxLength={250}
                  value={memo}
                  disabled={review || busy}
                  onChange={(e) => setMemo(e.target.value)}
                />
              </label>
            </section>
            {tab === "payroll" ? (
              <div
                style={{ pointerEvents: review || busy ? "none" : undefined }}
              >
                <StubEditor
                  disabled={busy || review}
                  value={stubs}
                  onChange={setStubs}
                />
              </div>
            ) : (
              <section className={styles.card}>
                <h2>{t("Check stubs")}</h2>
                <p>{t("Both copies: amount + memo")}</p>
                <p className={styles.muted}>
                  {t("Payroll fields are unavailable for standalone checks.")}
                </p>
              </section>
            )}
            <section className={styles.sticky}>
              <h2>{t(review ? "Review checks" : "Preview")}</h2>
              {preview ? (
                <iframe
                  title={t("Check preview")}
                  src={preview}
                  className={styles.preview}
                />
              ) : (
                <p className={styles.notice}>
                  {t(
                    "Review creates a watermarked preview without issuing a check number.",
                  )}
                </p>
              )}
              <p className={styles.muted}>
                {t("US Letter · Check on top · Two stubs")}
              </p>
              <p>{t("Sign by hand after printing.")}</p>
              <p className={styles.muted}>
                {t(
                  "Amounts and memo on a created check cannot be edited. Void and replace if needed.",
                )}
              </p>
            </section>
          </div>
          <footer className={styles.footer}>
            <strong>
              {tab === "payroll" ? `${selected.length} · ` : ""}
              {money(total)}
            </strong>
            {review ? (
              <>
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => {
                    setReview(false);
                    intent.current = null;
                  }}
                >
                  {t("Edit")}
                </button>
                <button
                  className={styles.button}
                  disabled={busy || Boolean(recoveryId)}
                  onClick={() => void issue()}
                >
                  {t("Confirm & create checks")}
                </button>
              </>
            ) : (
              <button
                className={styles.button}
                disabled={
                  busy ||
                  Boolean(recoveryId) ||
                  !state.settings.version ||
                  !total
                }
                onClick={() => void reviewChecks()}
              >
                {t("Review checks")}
              </button>
            )}
          </footer>
        </>
      )}
      {tab === "history" && (
        <section className={styles.history}>
          <h2>{t("History")}</h2>
          <p className={styles.muted}>
            {t(
              "Latest 100 checks. A prepared PDF does not confirm physical printing or payment.",
            )}
          </p>
          {state.history.map((record) => (
            <article
              className={`${styles.card} ${styles.record}`}
              key={record.id}
            >
              <div>
                <strong>
                  #{String(record.number).padStart(6, "0")} ·{" "}
                  {record.snapshot.payee}
                </strong>
                <p>
                  {money(record.snapshot.amountCents / 100)} ·{" "}
                  {record.snapshot.date} · {record.status}
                </p>
                <p>{record.snapshot.memo}</p>
                {record.void_reason && <p>{record.void_reason}</p>}
                <p className={styles.muted}>
                  {record.delivery_count} {t("PDF preparations")}
                </p>
                {state.events
                  .filter((e) => e.check_id === record.id)
                  .slice(0, 4)
                  .map((e, i) => (
                    <p key={i} className={styles.muted}>
                      {e.created_at} · {e.action}
                      {e.reason ? ` · ${e.reason}` : ""}
                    </p>
                  ))}
              </div>
              <div className={styles.actions}>
                {record.status !== "void" && (
                  <>
                    <button
                      className={styles.secondary}
                      disabled={busy || !state.active}
                      onClick={() => {
                        if (requireUnlock())
                          void work(() =>
                            preparePdf([record.id], record.delivery_count > 0),
                          );
                      }}
                    >
                      {t(record.delivery_count ? "Print again" : "Prepare PDF")}
                    </button>
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => {
                        if (!requireUnlock()) return;
                        const reason = window.prompt(
                          t("Reason for voiding this check"),
                        );
                        if (reason?.trim())
                          void work(async () => {
                            await send({
                              action: "void",
                              id: record.id,
                              reason,
                            });
                            await reload(state.selectedRun?.id);
                          });
                      }}
                    >
                      {t("Void")}
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
      {tab === "settings" && formSettings && (
        <section className={`${styles.form} ${styles.settings}`}>
          <h2>{t("Check settings")}</h2>
          <p className={styles.muted}>
            {t(
              "Bank details are encrypted and saved for this salon. Account numbers are never shown in full.",
            )}
          </p>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={formSettings.useSalon}
              onChange={(e) =>
                setFormSettings({
                  ...formSettings,
                  useSalon: e.target.checked,
                  ...(e.target.checked
                    ? { issuer: state.salonIssuer, address: state.salonAddress }
                    : {}),
                })
              }
            />
            {t("Use salon details")}
          </label>
          <label>
            {t("Issuer")}
            <input
              value={formSettings.issuer}
              disabled={formSettings.useSalon}
              onChange={(e) =>
                setFormSettings({ ...formSettings, issuer: e.target.value })
              }
            />
          </label>
          <label>
            {t("Issuer address")}
            <textarea
              value={formSettings.address}
              disabled={formSettings.useSalon}
              onChange={(e) =>
                setFormSettings({ ...formSettings, address: e.target.value })
              }
            />
          </label>
          <p>
            {formSettings.bankName} · ••{formSettings.last4}
          </p>
          <label className={styles.choice}>
            <input
              type="checkbox"
              checked={editBank || !formSettings.version}
              onChange={(e) => setEditBank(e.target.checked)}
            />
            {t("Enter or replace bank details")}
          </label>
          {(editBank || !formSettings.version) &&
            [
              ["name", "Bank name"],
              ["city", "Bank city / state"],
              ["routing", "Routing number"],
              ["account", "Account number"],
              ["fractional", "Fractional routing (optional)"],
            ].map(([key, label]) => (
              <label key={key}>
                {t(label)}
                <input
                  autoComplete="off"
                  type={key === "account" ? "password" : "text"}
                  inputMode={
                    ["account", "routing"].includes(key) ? "numeric" : undefined
                  }
                  value={bank[key as keyof typeof bank]}
                  onChange={(e) => setBank({ ...bank, [key]: e.target.value })}
                />
              </label>
            ))}
          <label>
            {t("Next check number")}
            <input
              type="number"
              min={formSettings.nextNumber}
              value={formSettings.nextNumber}
              onChange={(e) =>
                setFormSettings({
                  ...formSettings,
                  nextNumber: Number(e.target.value),
                })
              }
            />
          </label>
          <label>
            {t("Check stock")}
            <select
              value={formSettings.stock}
              onChange={(e) =>
                setFormSettings({
                  ...formSettings,
                  stock: e.target.value as CheckSettings["stock"],
                })
              }
            >
              <option value="preprinted">{t("Preprinted checks")}</option>
              <option value="blank">{t("Blank check stock + MICR")}</option>
            </select>
          </label>
          <p className={styles.notice}>
            {t(
              "Use matching check stock, actual size, one copy, single-sided. Test alignment before issuing real checks.",
            )}
          </p>
          <StubEditor
            value={formSettings.stubs}
            onChange={(stubs) => setFormSettings({ ...formSettings, stubs })}
          />
          <h2>{t("Alignment on this device")}</h2>
          <button
            className={styles.secondary}
            disabled={busy}
            onClick={() => {
              if (requireUnlock())
                void work(async () => {
                  const epoch = generation.current;
                  const r = await checkFetch("/api/check-writer", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      salonId: state?.salonId,
                      action: "alignment",
                      x: offset.x,
                      y: offset.y,
                    }),
                  });
                  if (!r.ok) throw Error((await r.json()).error);
                  const blob = await r.blob();
                  if (epoch !== generation.current) return;
                  setTestPrint(true);
                  setOutputUsed(false);
                  outputLatch.current = false;
                  setPrintReady(false);
                  setConfirmPrint(false);
                  setCreated([]);
                  const url = blobURL(blob);
                  setPrintedUrl(url);
                  setPreview(url);
                });
            }}
          >
            {t("Test alignment")}
          </button>
          {(["x", "y"] as const).map((axis) => (
            <label key={axis}>
              {axis.toUpperCase()} (mm)
              <input
                type="number"
                min={-12.7}
                max={12.7}
                step="0.1"
                value={offset[axis]}
                onChange={(e) => {
                  const next = { ...offset, [axis]: Number(e.target.value) };
                  setOffset(next);
                  localStorage.setItem(
                    "check-writer-alignment",
                    JSON.stringify(next),
                  );
                }}
              />
            </label>
          ))}
          <button
            className={styles.button}
            disabled={busy || !state.active}
            onClick={() => {
              if (requireUnlock())
                void work(async () => {
                  await send({
                    action: "settings",
                    settings: formSettings,
                    bank: editBank || !formSettings.version ? bank : undefined,
                  });
                  setBank({
                    name: "",
                    city: "",
                    routing: "",
                    account: "",
                    fractional: "",
                  });
                  setEditBank(false);
                  await reload(state.selectedRun?.id);
                });
            }}
          >
            {t("Save settings")}
          </button>
        </section>
      )}
      {unlockOpen && (
        <div
          className={styles.dialog}
          role="dialog"
          aria-modal="true"
          aria-label={t("Unlock Check Writer")}
        >
          <form
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              void work(async () => {
                const epoch = generation.current;
                await send({ action: "unlock", password, code });
                if (epoch !== generation.current) return;
                setUnlocked(true);
                setUnlockOpen(false);
                setPassword("");
                setCode("");
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(expireAccess, 300000);
              });
            }}
          >
            <h2>{t("Unlock Check Writer")}</h2>
            {error && (
              <p role="alert" className={styles.error}>
                {t(error)}
              </p>
            )}
            <p>
              {t(
                "Verify your password, or your authenticator code if MFA is enabled. Access expires after 5 minutes.",
              )}
            </p>
            <label>
              {t("Password")}
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              {t("Authenticator code")}
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
            <button className={styles.button} disabled={busy}>
              {t("Verify")}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setUnlockOpen(false);
                setPassword("");
                setCode("");
              }}
            >
              {t("Cancel")}
            </button>
          </form>
        </div>
      )}
      {printedUrl && (
        <div
          className={styles.dialog}
          role="dialog"
          aria-modal="true"
          aria-label={t("Print checks")}
        >
          <section className={styles.form}>
            <h2>{t(testPrint ? "Test alignment" : "Checks created")}</h2>
            {error && (
              <p role="alert" className={styles.error}>
                {t(error)}
              </p>
            )}
            <p>
              {t(
                "Use one copy, actual size and single-sided printing. Sign by hand after printing.",
              )}
            </p>
            <iframe
              id="check-writer-print"
              title={t("Print document")}
              src={printedUrl}
              className={styles.printFrame}
              onLoad={() => setPrintReady(true)}
            />
            {preview && (
              <iframe
                title={t("Watermarked preview")}
                src={preview}
                className={styles.preview}
              />
            )}
            <div className={styles.actions}>
              <button
                disabled={busy || outputUsed || !printReady}
                className={styles.button}
                onClick={() => void printPdf()}
              >
                {t("Print")}
              </button>
              <button
                disabled={busy || outputUsed}
                className={styles.secondary}
                onClick={() => void printPdf("download")}
              >
                {t("Download PDF")}
              </button>
            </div>
            {outputUsed && (
              <p className={styles.notice}>
                {t(
                  "This output has been used. Use History and enter a reason for another output.",
                )}
              </p>
            )}
            {confirmPrint && outputUsed && (
              <>
                <p>
                  {t(
                    "Did the physical checks print correctly? This does not mark payroll as paid.",
                  )}
                </p>
                <div className={styles.actions}>
                  {[
                    ["print_confirmed", "Printed correctly"],
                    ["print_failed", "Not printed / failed"],
                  ].map(([action, label]) => (
                    <button
                      key={action}
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() => {
                        if (requireUnlock())
                          void work(async () => {
                            for (const id of created)
                              await send({ action, id });
                            setConfirmPrint(false);
                            await reload(state.selectedRun?.id);
                          });
                      }}
                    >
                      {t(label)}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => {
                setPrintedUrl("");
                setCreated([]);
                intent.current = null;
                void work(() => reload(state.selectedRun?.id));
              }}
            >
              {t("Close")}
            </button>
          </section>
        </div>
      )}
      {created.length > 0 && !printedUrl && (
        <p className={styles.notice}>
          {t(
            "Checks were created. Use History to recover and prepare the same checks; do not create another batch.",
          )}{" "}
          <button
            className={styles.secondary}
            onClick={() => {
              changeTab("history");
              void work(() => reload(state.selectedRun?.id));
            }}
          >
            {t("History")}
          </button>
        </p>
      )}
    </main>
  );
}

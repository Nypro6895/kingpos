"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { CurrentWorkspaceOption } from "@/lib/current-context";
import type {
  TaxDocument,
  TaxLine,
  TaxProfile,
  TaxReceipt,
  TaxWorkspaceData,
  TaxWorkspaceMode,
} from "@/types/tax-workspace";
import {
  latestTaxRuns,
  summarizeTaxLines,
  taxChangedLine,
  taxCurrentPaystub,
  taxPeriodRuns,
  refreshTaxRunSelection,
} from "@/lib/tax-workspace-model";
import {
  addTaxReceipt,
  archiveTaxDocument,
  archiveTaxReceipt,
  removeOwnerTaxDocument,
  sendTaxMessage,
  uploadTaxDocument,
} from "./actions";
import { TaxProfileForm } from "./tax-entry";
import "./tax-workspace.css";
import "./tax-refinements.css";
import { TaxAccountMenu } from "./tax-account-menu";
import { LogoutButton } from "@/app/account/logout-button";
import {
  OwnerConnectionPanel,
  type OwnerTaxConnection,
} from "./owner-connection-panel";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(value),
  );
const categories: Record<TaxReceipt["category"], string> = {
  service_fee: "Service fees",
  tax_receipt: "Tax receipts",
  business_expense: "Business expenses",
};
type Tab =
  | "payroll"
  | "documents"
  | "messages"
  | "receipts"
  | "activity"
  | "access";
type Dialog =
  | { type: "upload"; line?: TaxLine; document?: TaxDocument }
  | { type: "viewer"; document: TaxDocument }
  | { type: "employee"; staffId: string }
  | { type: "batch" }
  | { type: "receipt"; requestId: string }
  | { type: "profile" }
  | { type: "salon" }
  | { type: "delete"; document: TaxDocument };
type BatchFile = {
  key: string;
  file: File;
  staffId: string;
  state: "pending" | "sending" | "sent" | "failed";
  error?: string;
};

function TaxDialog({
  title,
  wide = false,
  onClose,
  children,
}: {
  title: string;
  wide?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current
      ?.querySelector<HTMLElement>("button,input,select,textarea")
      ?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab") return;
      const list = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),iframe",
        ) ?? [],
      );
      if (!list.length) return;
      if (e.shiftKey && document.activeElement === list[0]) {
        e.preventDefault();
        list.at(-1)?.focus();
      } else if (!e.shiftKey && document.activeElement === list.at(-1)) {
        e.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="tax-dialog-backdrop">
      <section
        className={`tax-dialog ${wide ? "tax-dialog-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="tax-dialog-head">
          <h2>{title}</h2>
          <button onClick={onClose}>Close</button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function TaxWorkspace({
  initialData,
  mode,
  profile,
  salons,
  workspaces,
  today,
  qa = false,
  ownerConnection,
}: {
  initialData: TaxWorkspaceData;
  mode: TaxWorkspaceMode;
  profile: TaxProfile | null;
  salons: { id: string; name: string }[];
  workspaces: CurrentWorkspaceOption[];
  today: string;
  qa?: boolean;
  ownerConnection?: OwnerTaxConnection;
}) {
  const [data, setData] = useState(initialData),
    [tab, setTab] = useState<Tab>(mode === "staff" ? "documents" : "payroll"),
    [range, setRange] = useState("all"),
    [runId, setRunId] = useState(latestTaxRuns(initialData.runs)[0]?.id ?? ""),
    [filter, setFilter] = useState("all"),
    [search, setSearch] = useState("");
  const [archive, setArchive] = useState(false),
    [thread, setThread] = useState(""),
    [draft, setDraft] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [expanded, setExpanded] = useState<string | null>(null),
    [unavailable, setUnavailable] = useState(false);
  const [batch, setBatch] = useState<BatchFile[]>([]),
    [batchConfirmed, setBatchConfirmed] = useState(false),
    [pending, start] = useTransition(),
    [receiptCategory, setReceiptCategory] = useState("all");
  const [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const isOwner = mode === "owner",
    isStaff = mode === "staff",
    summary = runId === "summary",
    salonId = data.salon.id;
  const runs = taxPeriodRuns(data.runs, range, today).filter(
    (r) =>
      (!from || !to || from <= to) &&
      (!from || r.period_end >= from) &&
      (!to || r.period_start <= to),
  );
  const eligibleIds = new Set(
    (summary ? runs : runs.filter((r) => r.id === runId)).map((r) => r.id),
  );
  const periodLines = data.lines.filter((l) => eligibleIds.has(l.run_id));
  const displayLines = (
    summary ? summarizeTaxLines(periodLines) : periodLines
  ).filter(
    (l) =>
      (!search ||
        `${l.name} ${l.legal_name ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (filter === "all" ||
        (filter === "missing" &&
          (summary
            ? periodLines.some(
                (p) =>
                  p.staff_id === l.staff_id &&
                  !taxCurrentPaystub(data.documents, p.staff_id, p.run_id),
              )
            : !taxCurrentPaystub(data.documents, l.staff_id, l.run_id))) ||
        (filter === "changed" &&
          (summary
            ? periodLines.some(
                (p) =>
                  p.staff_id === l.staff_id && Boolean(taxChangedLine(data, p)),
              )
            : Boolean(taxChangedLine(data, l))))),
  );
  const currentRun = data.runs.find((r) => r.id === runId),
    allPeople = [
      ...new Map(
        [
          ...(data.people ?? []).map((p) => ({
            staff_id: p.id,
            name: p.name,
            legal_name: p.legal_name,
          })),
          ...data.lines,
        ].map((l) => [
          l.staff_id,
          { id: l.staff_id, name: l.name, legalName: l.legal_name },
        ]),
      ).values(),
    ];
  const changed = summary
    ? []
    : displayLines.filter((l) => taxChangedLine(data, l));
  const currentDocuments = data.documents.filter(
      (d) => !d.owner_deleted_at || isStaff,
    ),
    visibleDocuments = currentDocuments.filter(
      (d) =>
        Boolean(d.archived_at) === archive &&
        (!search ||
          `${d.title} ${allPeople.find((p) => p.id === d.staff_id)?.name ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    );
  const visibleReceipts = data.receipts.filter(
    (r) =>
      Boolean(r.archived_at) === archive &&
      (receiptCategory === "all" || r.category === receiptCategory),
  );
  const resetMessages = () => {
    setError("");
    setNotice("");
  };
  const closeDialog = useCallback(() => {
    if (!pending) setDialog(null);
  }, [pending]);
  // Refresh access and data on focus; no account-wide shared client cache.
  useEffect(() => {
    if (qa || isStaff) return;
    let live = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/tax/workspaces/${salonId}`, {
          cache: "no-store",
        });
        if (response.status === 403 || response.status === 401) {
          if (live) {
            setUnavailable(true);
            setDialog(null);
            setDraft("");
            setBatch([]);
          }
          return;
        }
        if (response.ok && live) {
          const refreshed = (await response.json()) as TaxWorkspaceData;
          setData(refreshed);
          setRunId((selected) =>
            refreshTaxRunSelection(refreshed.runs, selected),
          );
        }
      } catch {
        /* Keep local drafts on a transient network error. */
      }
    };
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    const timer = window.setInterval(refresh, 45000);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [salonId, qa, isStaff]);
  useEffect(() => {
    if (!draft && !pending && !batch.some((b) => b.state !== "sent")) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [draft, pending, batch]);
  function switchTab(next: Tab) {
    resetMessages();
    setTab(next);
    setArchive(false);
    setSearch("");
  }
  function chooseRange(value: string) {
    setRange(value);
    setFrom("");
    setTo("");
    const options = taxPeriodRuns(data.runs, value, today);
    setRunId(value === "previous_year" ? "summary" : (options[0]?.id ?? ""));
  }
  function submitUpload(form: HTMLFormElement) {
    const payload = new FormData(form);
    payload.set("salon_id", salonId);
    resetMessages();
    start(async () => {
      const result = await uploadTaxDocument(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const doc = result.data as TaxDocument;
      setData((value) => ({
        ...value,
        documents: [
          doc,
          ...value.documents.map((d) =>
            d.id === doc.supersedes_id
              ? { ...d, archived_at: doc.created_at }
              : d,
          ),
        ],
      }));
      setDialog(null);
      setNotice(
        "Document saved and delivered. Previous versions remain in Archive.",
      );
    });
  }
  async function runBatch() {
    resetMessages();
    const input = batch.filter((b) => b.state !== "sent");
    if (
      !currentRun ||
      !batchConfirmed ||
      !input.length ||
      input.some((b) => !b.staffId) ||
      new Set(input.map((b) => b.staffId)).size !== input.length
    ) {
      setError(
        "Confirm the matching and assign each file to a different employee.",
      );
      return;
    }
    for (const item of input) {
      setBatch((value) =>
        value.map((b) =>
          b.key === item.key ? { ...b, state: "sending", error: undefined } : b,
        ),
      );
      const payload = new FormData();
      payload.set("salon_id", salonId);
      payload.set("kind", "paystub");
      payload.set("run_id", currentRun.id);
      payload.set("staff_id", item.staffId);
      payload.set("file", item.file);
      const existing = taxCurrentPaystub(
        data.documents,
        item.staffId,
        currentRun.id,
      );
      if (existing) payload.set("supersedes_id", existing.id);
      const result = await uploadTaxDocument(payload);
      if (result.ok) {
        const doc = result.data as TaxDocument;
        setBatch((value) =>
          value.map((b) => (b.key === item.key ? { ...b, state: "sent" } : b)),
        );
        setData((value) => ({
          ...value,
          documents: [
            doc,
            ...value.documents.map((d) =>
              d.id === doc.supersedes_id
                ? { ...d, archived_at: doc.created_at }
                : d,
            ),
          ],
        }));
      } else
        setBatch((value) =>
          value.map((b) =>
            b.key === item.key
              ? { ...b, state: "failed", error: result.error }
              : b,
          ),
        );
    }
    setNotice(
      "Batch processed. Successful files stay sent; retry only the failed files.",
    );
  }
  function openReplacement(doc: TaxDocument) {
    const oldRun = data.runs.find((r) => r.id === doc.payroll_run_id);
    const latest = oldRun
      ? latestTaxRuns(data.runs).find(
          (r) =>
            r.period_start === oldRun.period_start &&
            r.period_end === oldRun.period_end,
        )
      : null;
    const line =
      latest && doc.kind === "paystub"
        ? data.lines.find(
            (l) => l.staff_id === doc.staff_id && l.run_id === latest.id,
          )
        : null;
    if (line && line.run_id !== doc.payroll_run_id)
      setDialog({
        type: "upload",
        line,
        document:
          taxCurrentPaystub(data.documents, line.staff_id, line.run_id) ??
          undefined,
      });
    else setDialog({ type: "upload", document: doc });
  }
  function documentActions(doc: TaxDocument) {
    return (
      <div className="tax-actions">
        <button onClick={() => setDialog({ type: "viewer", document: doc })}>
          View
        </button>
        {(isOwner || isStaff) && (
          <a href={`/api/tax/documents/${doc.id}?download=1`}>Download</a>
        )}
        {!isStaff && (
          <>
            {(!archive || isOwner) && (
              <button
                disabled={
                  pending || (!isOwner && doc.uploaded_role === "owner")
                }
                onClick={() => {
                  resetMessages();
                  start(async () => {
                    const result = await archiveTaxDocument({
                      id: doc.id,
                      restore: archive,
                    });
                    if (!result.ok) setError(result.error);
                    else {
                      setData((value) => ({
                        ...value,
                        documents: value.documents.map((d) =>
                          d.id === doc.id
                            ? {
                                ...d,
                                archived_at: archive
                                  ? null
                                  : new Date().toISOString(),
                              }
                            : d,
                        ),
                      }));
                      setNotice(
                        archive
                          ? "Document restored."
                          : "Document archived. The owner and staff recipient retain their history.",
                      );
                    }
                  });
                }}
              >
                {archive ? "Restore" : "Archive"}
              </button>
            )}
            {!archive && (isOwner || doc.uploaded_role !== "owner") && (
              <button onClick={() => openReplacement(doc)}>
                Upload new version
              </button>
            )}
            {isOwner && (
              <button
                onClick={() => setDialog({ type: "delete", document: doc })}
              >
                Remove from owner records
              </button>
            )}
          </>
        )}
      </div>
    );
  }
  if (unavailable)
    return (
      <main className="tax-auth">
        <h1>Business access ended</h1>
        <p>
          Your account can no longer open this business, its files or
          conversations.
        </p>
        <Link href="/tax">My businesses</Link>
      </main>
    );

  return (
    <div className={`tax-app tax-mode-${mode}`}>
      <header className="tax-topbar">
        <Link href={isOwner ? "/payroll" : "/tax"} className="tax-brand">
          ReyLUMI{" "}
          <span>
            {isOwner ? "Owner · Tax Company" : isStaff ? "My documents" : "Tax"}
          </span>
        </Link>
        <TaxAccountMenu
          label={
            <>
              {profile?.display_name ??
                (isOwner ? "Salon owner" : "Personal account")}{" "}
              · {isOwner ? "Owner" : isStaff ? "Staff" : "Tax"}
            </>
          }
        >
          {!isOwner && !isStaff && (
            <button onClick={() => setDialog({ type: "profile" })}>
              Tax profile
            </button>
          )}
          <Link href="/settings/login-security">Security & sessions</Link>
          {workspaces.map((w) => (
            <a
              key={w.id}
              href={`/workspace/open?workspace_id=${encodeURIComponent(w.id)}`}
            >
              {w.type === "personal"
                ? "Personal"
                : w.type === "tax"
                  ? "Tax professional"
                  : `${w.roleLabel} · ${w.label}`}
            </a>
          ))}
          <Link href="/account">My Reylumi account</Link>
          <LogoutButton returnHref="/tax/login" />
        </TaxAccountMenu>
      </header>
      {qa && (
        <div className="tax-qa">
          Local QA · actual app components with seeded data · no production
          connections
        </div>
      )}
      <div className="tax-shell">
        <aside className="tax-sidebar">
          <Link href={isOwner ? "/payroll" : isStaff ? "/account" : "/tax"}>
            {isOwner
              ? "← Payroll"
              : isStaff
                ? "← Personal account"
                : "All businesses"}
          </Link>
          <small className="tax-muted">
            {isStaff ? "MY PERSONAL RECORDS" : "CONNECTED BUSINESSES"}
          </small>
          {salons.map((s) => (
            <Link
              className="tax-business"
              aria-current={s.id === salonId ? "true" : undefined}
              key={s.id}
              href={isOwner ? "/payroll/tax-company" : `/tax/${s.id}`}
            >
              {s.name}
            </Link>
          ))}
          <div className="tax-sidebar-bottom">
            {!isOwner && !isStaff && (
              <>
                <Link href="/tax">＋ Connect business</Link>
                <Link href="/tax/install">Install on Windows</Link>
              </>
            )}
            <span className="tax-muted">
              {isStaff
                ? "Current and archived personal files remain yours."
                : "Salon records belong to the owner."}
            </span>
          </div>
        </aside>
        <main className="tax-main">
          <div className="tax-heading">
            <div>
              <h1>{isStaff ? "My tax documents" : data.salon.name}</h1>
              <span className="tax-muted">
                {isStaff
                  ? "Your current files and archive, independent of employment status."
                  : [
                      data.salon.address_line1,
                      data.salon.city,
                      data.salon.state,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            </div>
            {!isStaff && (
              <div className="tax-actions">
                <button onClick={() => switchTab("activity")}>History</button>
                {isOwner && (
                  <button onClick={() => switchTab("access")}>
                    Access & settings
                  </button>
                )}
                <button onClick={() => setDialog({ type: "salon" })}>
                  Business information
                </button>
              </div>
            )}
          </div>
          <nav className="tax-tabs" aria-label="Tax workspace sections">
            {(isStaff
              ? [["documents", "My documents"]]
              : [
                  ["payroll", "Payroll"],
                  ["documents", "Documents"],
                  [
                    "messages",
                    `Conversations${data.messages.length ? ` · ${data.messages.length}` : ""}`,
                  ],
                  ["receipts", "Receipts"],
                ]
            ).map(([id, label]) => (
              <button
                role="tab"
                aria-selected={tab === id}
                key={id}
                onClick={() => switchTab(id as Tab)}
              >
                {label}
              </button>
            ))}
          </nav>
          {error && (
            <p className="tax-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="tax-notice" role="status">
              {notice}
            </p>
          )}
          {tab === "payroll" && (
            <>
              <div className="tax-toolbar">
                <select
                  aria-label="Date range"
                  value={range}
                  onChange={(e) => chooseRange(e.target.value)}
                >
                  <option value="all">All periods</option>
                  <option value="current_month">This month</option>
                  <option value="previous_month">Last month</option>
                  <option value="previous_year">Last year</option>
                </select>
                <select
                  aria-label="Payroll period"
                  value={runId}
                  onChange={(e) => {
                    setRunId(e.target.value);
                  }}
                >
                  <option value="">Choose a period</option>
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.period_start} – {r.period_end} · v{r.version}
                    </option>
                  ))}
                  <option value="summary">Summary of filtered periods</option>
                </select>
                <select
                  aria-label="Work filter"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                  }}
                >
                  <option value="all">All employees</option>
                  <option value="missing">Paystub needed</option>
                  <option value="changed">Payroll changed</option>
                </select>
                <input
                  type="search"
                  aria-label="Find employee"
                  placeholder="Find employee"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                  }}
                />
                <span className="tax-grow" />
                <button
                  className="tax-primary"
                  disabled={!currentRun || summary || pending}
                  onClick={() => setDialog({ type: "batch" })}
                >
                  Upload multiple paystubs
                </button>
                <details className="tax-date-filter">
                  <summary>Dates</summary>
                  <div className="tax-date-fields">
                    <label>
                      From{" "}
                      <input
                        aria-label="From date"
                        type="date"
                        value={from}
                        onChange={(e) => {
                          setFrom(e.target.value);
                          setRange("all");
                          setRunId("summary");
                        }}
                      />
                    </label>
                    <label>
                      To{" "}
                      <input
                        aria-label="To date"
                        type="date"
                        min={from}
                        value={to}
                        onChange={(e) => {
                          setTo(e.target.value);
                          setRange("all");
                          setRunId("summary");
                        }}
                      />
                    </label>
                  </div>
                </details>
              </div>
              {data.events
                .filter(
                  (e) =>
                    e.action === "payroll_settings_changed" &&
                    String(e.detail.effective_from ?? "") >=
                      (currentRun?.period_start ?? "9999"),
                )
                .slice(0, 1)
                .map((e) => (
                  <p className="tax-alert" key={e.id}>
                    Owner updated payroll settings for the whole period starting{" "}
                    {String(e.detail.effective_from)}. Only published statement
                    amounts are shown here; updated published amounts appear
                    automatically.
                  </p>
                ))}
              {changed.some(
                (l) => !taxCurrentPaystub(data.documents, l.staff_id, l.run_id),
              ) && (
                <div className="tax-alert">
                  <span>
                    {changed.length} employee{changed.length === 1 ? "" : "s"}{" "}
                    with updated payroll. The new amounts are shown below. Check
                    whether a replacement paystub is needed; previous files
                    remain in Archive.
                  </span>
                </div>
              )}
              <div className="tax-subline">
                <span>
                  {summary
                    ? `${runs.length} periods · latest published version per period`
                    : currentRun
                      ? `${currentRun.status.toUpperCase()} · v${currentRun.version}`
                      : "No published statement selected"}
                </span>
                <span>
                  {summary
                    ? "Read-only summary"
                    : `${displayLines.filter((l) => taxCurrentPaystub(data.documents, l.staff_id, l.run_id)).length}/${displayLines.length} current paystubs`}
                </span>
              </div>
              <div className="tax-table-wrap">
                <table className="tax-payroll-table">
                  <thead>
                    <tr>
                      <th>Employee / legal name</th>
                      <th className="tax-num">Wages reported</th>
                      <th className="tax-num">Tips reported</th>
                      <th className="tax-num">Bonus reported</th>
                      <th className="tax-num">Total reported</th>
                      <th className="tax-num">Withheld by salon</th>
                      <th className="tax-num">Check amount</th>
                      <th>Paystub</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {displayLines.map((line) => {
                      const stub = taxCurrentPaystub(
                          data.documents,
                          line.staff_id,
                          line.run_id,
                        ),
                        before = taxChangedLine(data, line);
                      return (
                        <TaxEmployeeRow
                          key={line.staff_id}
                          line={line}
                          expanded={expanded === line.staff_id}
                          summary={summary}
                          stub={stub}
                          changed={Boolean(before)}
                          onExpand={() =>
                            setExpanded(
                              expanded === line.staff_id ? null : line.staff_id,
                            )
                          }
                          onView={() =>
                            stub
                              ? setDialog({ type: "viewer", document: stub })
                              : setDialog({ type: "upload", line })
                          }
                          onUpload={() =>
                            setDialog({
                              type: "upload",
                              line,
                              document: stub ?? undefined,
                            })
                          }
                          onEmployee={() =>
                            setDialog({
                              type: "employee",
                              staffId: line.staff_id,
                            })
                          }
                        />
                      );
                    })}
                  </tbody>
                  {displayLines.length > 0 && (
                    <tfoot>
                      <tr>
                        <td>Total · {displayLines.length} employees</td>
                        {(
                          [
                            "reported_wage",
                            "tip",
                            "bonus",
                            "reported_gross",
                            "tax",
                            "actual_check",
                          ] as const
                        ).map((key) => (
                          <td
                            className="tax-num"
                            key={key}
                            data-label={
                              {
                                reported_wage: "Wages reported",
                                tip: "Tips reported",
                                bonus: "Bonus reported",
                                reported_gross: "Total reported",
                                tax: "Withheld by salon",
                                actual_check: "Check amount",
                              }[key]
                            }
                          >
                            {displayLines.every((l) => l[key] === null)
                              ? "—"
                              : money(
                                  displayLines.reduce(
                                    (sum, l) =>
                                      sum + Math.round(Number(l[key]) * 100),
                                    0,
                                  ) / 100,
                                )}
                          </td>
                        ))}
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              <section className="tax-explanation">
                <h2>How to read these amounts</h2>
                <p>
                  <strong>
                    Total reported = wages reported + tips reported + bonus
                    reported.
                  </strong>{" "}
                  Tips and bonus in their own columns are already included in
                  this total; do not add them again. “—” means that amount is
                  not included/shared, not an additional payment.
                </p>
                <p>
                  <strong>Withheld by salon</strong> is the amount recorded by
                  the salon’s payroll, not a tax calculation or approval by the
                  tax professional. <strong>Check amount</strong> is the salon’s
                  recorded check payout; it can include tips and bonus paid by
                  check, while cash payouts are separate. It does not always
                  equal total reported minus withholding.
                </p>
                <p>
                  Example: all earnings are reported and paid by check: wages
                  $1,000 + tips $150 + bonus $50 = total $1,200. If the salon
                  records $120 withholding, the check is $1,080. Cash tips
                  already paid must not be paid again through the check.
                </p>
                <p>
                  Only published payroll is shared. Settings apply to whole
                  payroll periods. An updated statement shows the new amounts
                  and flags paystubs that need review. Employee legal names, tax
                  forms/SSN, business EIN and other source records belong in
                  Documents; Reylumi does not calculate the tax professional’s
                  payroll deductions or returns.
                </p>
              </section>
              {!displayLines.length && (
                <div className="tax-empty">
                  No published payroll matches this period and filter. Draft
                  payroll is not shared.
                </div>
              )}
            </>
          )}

          {tab === "documents" && (
            <>
              <div className="tax-toolbar">
                <button
                  aria-pressed={!archive}
                  onClick={() => setArchive(false)}
                >
                  Current
                </button>
                <button aria-pressed={archive} onClick={() => setArchive(true)}>
                  Archive
                </button>
                <input
                  type="search"
                  aria-label="Search documents"
                  placeholder="Find file or employee"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <span className="tax-grow" />
                {!isStaff && (
                  <button
                    className="tax-primary"
                    onClick={() => setDialog({ type: "upload" })}
                  >
                    Upload document
                  </button>
                )}
              </div>
              {!isStaff && (
                <div className="tax-pad">
                  <section className="tax-panel">
                    <h2>Business master file</h2>
                    <p className="tax-muted">
                      Business information, owner documents and year-end tax
                      records.
                    </p>
                    <div className="tax-links">
                      {visibleDocuments
                        .filter((d) => !d.staff_id)
                        .map((doc) => (
                          <button
                            key={doc.id}
                            onClick={() =>
                              setDialog({ type: "viewer", document: doc })
                            }
                          >
                            {doc.title}
                          </button>
                        ))}
                    </div>
                  </section>
                </div>
              )}
              <div className="tax-table-wrap">
                <table className="tax-documents-table">
                  <thead>
                    <tr>
                      <th>Document</th>
                      <th>Employee / business</th>
                      <th>Version</th>
                      <th>Updated</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleDocuments.map((doc) => (
                      <tr key={doc.id}>
                        <td data-label="Document">
                          <strong className="tax-file-title">
                            {doc.title}
                          </strong>
                          <small>
                            {doc.kind} · {Math.ceil(doc.size_bytes / 1024)} KB
                          </small>
                          {isStaff && (
                            <small>
                              {doc.salon_name ?? ""}
                              {doc.period_start
                                ? ` · ${doc.period_start} – ${doc.period_end}`
                                : ""}
                            </small>
                          )}
                        </td>
                        <td data-label="Employee / business">
                          {allPeople.find((p) => p.id === doc.staff_id)?.name ??
                            doc.staff_name ??
                            (doc.staff_id
                              ? "My personal document"
                              : "Business")}
                        </td>
                        <td data-label="Version">
                          <span
                            className={`tax-badge ${doc.archived_at ? "tax-warn" : ""}`}
                          >
                            {doc.archived_at ? "Archive" : "Current"} · v
                            {doc.version}
                          </span>
                        </td>
                        <td data-label="Updated">
                          {doc.created_at.slice(0, 10)}
                          <small>{doc.uploaded_role}</small>
                        </td>
                        <td data-label="Actions">{documentActions(doc)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!visibleDocuments.length && (
                <div className="tax-empty">
                  No {archive ? "archived" : "current"} documents match.
                </div>
              )}
            </>
          )}

          {tab === "messages" && (
            <div className="tax-chat">
              <aside className="tax-chat-threads">
                <button aria-pressed={!thread} onClick={() => setThread("")}>
                  Business conversation
                </button>
                {allPeople.map((person) => (
                  <button
                    key={person.id}
                    aria-pressed={thread === person.id}
                    onClick={() => setThread(person.id)}
                  >
                    {person.name}
                  </button>
                ))}
              </aside>
              <section className="tax-messages">
                <h2>
                  {thread
                    ? allPeople.find((p) => p.id === thread)?.name
                    : "Conversation with the owner"}
                </h2>
                {data.messages
                  .filter((m) => (m.staff_id ?? "") === thread)
                  .map((message) => (
                    <article
                      className={`tax-message ${message.author_id === profile?.user_id ? "mine" : ""}`}
                      key={message.id}
                    >
                      <strong>{message.author_name}</strong>
                      <small className="tax-muted">
                        {" "}
                        · {message.created_at
                          .slice(0, 16)
                          .replace("T", " ")}{" "}
                        UTC
                      </small>
                      <p>{message.body}</p>
                      {message.document_id &&
                        data.documents.find(
                          (d) => d.id === message.document_id,
                        ) && (
                          <button
                            onClick={() =>
                              setDialog({
                                type: "viewer",
                                document: data.documents.find(
                                  (d) => d.id === message.document_id,
                                )!,
                              })
                            }
                          >
                            View attached document
                          </button>
                        )}
                    </article>
                  ))}
                <form
                  className="tax-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const payload = new FormData();
                    payload.set("salon_id", salonId);
                    payload.set("body", draft);
                    if (thread) payload.set("staff_id", thread);
                    if (currentRun) payload.set("run_id", currentRun.id);
                    resetMessages();
                    start(async () => {
                      const result = await sendTaxMessage(payload);
                      if (!result.ok) setError(result.error);
                      else {
                        setData((value) => ({
                          ...value,
                          messages: [
                            ...value.messages,
                            result.data as TaxWorkspaceData["messages"][number],
                          ],
                        }));
                        setDraft("");
                        setNotice(
                          "Message sent. It remains in the owner's business history.",
                        );
                      }
                    });
                  }}
                >
                  <label>
                    Message
                    <textarea
                      required
                      maxLength={4000}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Send information or request a missing document…"
                    />
                  </label>
                  <div className="tax-actions">
                    <button
                      disabled={pending || !draft.trim()}
                      className="tax-primary"
                    >
                      Send message
                    </button>
                    <button
                      type="button"
                      onClick={() => setDialog({ type: "upload" })}
                    >
                      Upload document
                    </button>
                  </div>
                </form>
                <p className="tax-muted">
                  All business conversations belong to the owner and continue
                  when the tax professional changes.
                </p>
              </section>
            </div>
          )}

          {tab === "receipts" && (
            <>
              <div className="tax-toolbar">
                <button
                  aria-pressed={!archive}
                  onClick={() => setArchive(false)}
                >
                  Current
                </button>
                <button aria-pressed={archive} onClick={() => setArchive(true)}>
                  Archive
                </button>
                <select
                  aria-label="Receipt category"
                  value={receiptCategory}
                  onChange={(e) => setReceiptCategory(e.target.value)}
                >
                  <option value="all">All categories</option>
                  {Object.entries(categories).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="tax-grow" />
                <button
                  className="tax-primary"
                  onClick={() =>
                    setDialog({
                      type: "receipt",
                      requestId: crypto.randomUUID(),
                    })
                  }
                >
                  ＋ Add receipt
                </button>
              </div>
              <div className="tax-receipt-totals">
                {Object.entries(categories).map(([id, label]) => (
                  <div key={id}>
                    <span>{label}</span>
                    <strong>
                      {money(
                        visibleReceipts
                          .filter((r) => r.category === id)
                          .reduce((sum, r) => sum + Number(r.amount_cents), 0) /
                          100,
                      )}
                    </strong>
                  </div>
                ))}
              </div>
              <div className="tax-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Category</th>
                      <th>Description</th>
                      <th className="tax-num">USD</th>
                      <th>Status</th>
                      <th>Document / actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleReceipts.map((item) => (
                      <tr key={item.id}>
                        <td>{item.receipt_date}</td>
                        <td>{categories[item.category]}</td>
                        <td>{item.description}</td>
                        <td className="tax-num">
                          {money(item.amount_cents / 100)}
                        </td>
                        <td>{item.status.replaceAll("_", " ")}</td>
                        <td>
                          <div className="tax-actions">
                            {item.document_id &&
                              data.documents.find(
                                (d) => d.id === item.document_id,
                              ) && (
                                <button
                                  onClick={() =>
                                    setDialog({
                                      type: "viewer",
                                      document: data.documents.find(
                                        (d) => d.id === item.document_id,
                                      )!,
                                    })
                                  }
                                >
                                  View
                                </button>
                              )}
                            {!archive && (
                              <button
                                disabled={pending}
                                onClick={() =>
                                  start(async () => {
                                    const result = await archiveTaxReceipt(
                                      item.id,
                                    );
                                    if (!result.ok) setError(result.error);
                                    else
                                      setData((value) => ({
                                        ...value,
                                        receipts: value.receipts.map((r) =>
                                          r.id === item.id
                                            ? {
                                                ...r,
                                                archived_at:
                                                  new Date().toISOString(),
                                              }
                                            : r,
                                        ),
                                      }));
                                  })
                                }
                              >
                                Archive
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tax-subline">
                Record receipts and amounts supplied by either party. This tool
                does not calculate tax or process payments.
              </p>
            </>
          )}

          {tab === "activity" && (
            <section className="tax-pad">
              <h2>Business history</h2>
              <ul className="tax-activity">
                {data.events.map((event) => (
                  <li key={event.id}>
                    <strong>{event.actor_name}</strong> ·{" "}
                    {event.action.replaceAll("_", " ")}
                    <small>
                      {event.created_at.slice(0, 16).replace("T", " ")} UTC{" "}
                      {typeof event.detail.title === "string"
                        ? ` · ${event.detail.title}`
                        : ""}
                    </small>
                  </li>
                ))}
              </ul>
              {!data.events.length && <p>No activity recorded yet.</p>}
            </section>
          )}
          {tab === "access" && isOwner && (
            <section className="tax-pad">
              <h2>Owner control center</h2>
              {ownerConnection && (
                <OwnerConnectionPanel state={ownerConnection} salonId={data.salon.id}/>
              )}
              <p>
                All business documents, receipts, current files, archives and
                conversations belong to your salon. Staff retain delivered
                personal documents, including archived versions.
              </p>
              <div className="tax-actions">
                <Link
                  className="tax-primary"
                  href="/payroll/tax-company/settings"
                >
                  Connection ID, password & people with access
                </Link>
                <Link href="/settings?section=payroll">Payroll settings</Link>
              </div>
              <section className="tax-panel">
                <h3>Changing your tax professional</h3>
                <p>
                  Disconnect existing access and set a new connection password.
                  The new professional resumes from the same business records
                  and status history. Previous authors stay identified.
                </p>
              </section>
            </section>
          )}
        </main>
      </div>

      {dialog && (
        <TaxDialog
          title={
            dialog.type === "upload"
              ? "Upload document"
              : dialog.type === "viewer"
                ? dialog.document.title
                : dialog.type === "batch"
                  ? "Match & send multiple paystubs"
                  : dialog.type === "profile"
                    ? "Your tax profile"
                    : dialog.type === "receipt"
                      ? "Add receipt"
                      : dialog.type === "employee"
                        ? "Employee documents"
                        : dialog.type === "delete"
                          ? "Remove owner record"
                          : "Business information"
          }
          wide={["viewer", "batch"].includes(dialog.type)}
          onClose={closeDialog}
        >
          {error && (
            <p className="tax-error" role="alert">
              {error}
            </p>
          )}
          {dialog.type === "viewer" && (
            <>
              <p className="tax-muted">
                {dialog.document.archived_at ? "Archive" : "Current"} · v
                {dialog.document.version} ·{" "}
                {dialog.document.created_at.slice(0, 10)}
              </p>
              {dialog.document.mime_type.startsWith("image/") ? (
                <Image
                  unoptimized
                  width={900}
                  height={1200}
                  style={{ width: "100%", height: "auto" }}
                  src={`/api/tax/documents/${dialog.document.id}`}
                  alt={dialog.document.title}
                />
              ) : (
                <iframe
                  title={dialog.document.title}
                  src={`/api/tax/documents/${dialog.document.id}#toolbar=0`}
                />
              )}
              <div className="tax-actions">
                {(isOwner || isStaff) && (
                  <a
                    href={`/api/tax/documents/${dialog.document.id}?download=1`}
                  >
                    Download document
                  </a>
                )}
                {!isStaff &&
                  !dialog.document.archived_at &&
                  (isOwner || dialog.document.uploaded_role !== "owner") && (
                    <button onClick={() => openReplacement(dialog.document)}>
                      Upload corrected version
                    </button>
                  )}
              </div>
            </>
          )}
          {dialog.type === "profile" && (
            <TaxProfileForm
              profile={profile}
              name={profile?.display_name ?? ""}
              email={profile?.contact_email ?? ""}
              onSaved={() => {
                setDialog(null);
                setNotice("Profile saved. Changes appear after refresh.");
              }}
            />
          )}
          {dialog.type === "upload" && (
            <form
              className="tax-form"
              onSubmit={(e) => {
                e.preventDefault();
                submitUpload(e.currentTarget);
              }}
            >
              <label>
                Document type
                <select
                  name="kind"
                  defaultValue={
                    dialog.document?.kind ??
                    (dialog.line ? "paystub" : "business")
                  }
                  disabled={Boolean(dialog.document || dialog.line)}
                >
                  <option value="business">Business master file</option>
                  <option value="employee">Employee information</option>
                  <option value="paystub">Employee paystub</option>
                  <option value="tax">Tax document</option>
                  <option value="receipt">Receipt attachment</option>
                </select>
              </label>
              {(dialog.document || dialog.line) && (
                <input
                  type="hidden"
                  name="kind"
                  value={dialog.document?.kind ?? "paystub"}
                />
              )}
              <label>
                Employee
                <select
                  name="staff_id"
                  defaultValue={
                    dialog.document?.staff_id ?? dialog.line?.staff_id ?? ""
                  }
                  disabled={Boolean(dialog.document || dialog.line)}
                >
                  <option value="">Business / owner only</option>
                  {allPeople.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {(dialog.document || dialog.line) && (
                <input
                  type="hidden"
                  name="staff_id"
                  value={
                    dialog.document?.staff_id ?? dialog.line?.staff_id ?? ""
                  }
                />
              )}
              <label>
                Payroll period
                <select
                  name="run_id"
                  defaultValue={
                    dialog.document?.payroll_run_id ?? dialog.line?.run_id ?? ""
                  }
                  disabled={Boolean(dialog.document || dialog.line)}
                >
                  <option value="">Not linked to payroll</option>
                  {latestTaxRuns(data.runs).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.period_start} – {r.period_end} · v{r.version}
                    </option>
                  ))}
                </select>
              </label>
              {(dialog.document || dialog.line) && (
                <input
                  type="hidden"
                  name="run_id"
                  value={
                    dialog.document?.payroll_run_id ?? dialog.line?.run_id ?? ""
                  }
                />
              )}
              <input
                type="hidden"
                name="supersedes_id"
                value={dialog.document?.id ?? ""}
              />
              <label>
                PDF or image · up to 10 MB
                <input
                  name="file"
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  required
                />
              </label>
              {dialog.line || dialog.document?.kind === "paystub" ? (
                <input type="hidden" name="share_staff" value="true" />
              ) : (
                <label className="tax-inline-label">
                  <input
                    type="checkbox"
                    name="share_staff"
                    value="true"
                    defaultChecked={Boolean(dialog.document?.recipient_user_id)}
                  />
                  Also deliver to the selected employee
                </label>
              )}
              <p className="tax-muted">
                The owner can always view this file. Paystubs are delivered to
                their employee. Replaced versions remain in Archive.
              </p>
              <button className="tax-primary" disabled={pending}>
                {pending ? "Uploading…" : "Upload & save"}
              </button>
            </form>
          )}
          {dialog.type === "employee" && (
            <>
              <p>{allPeople.find((p) => p.id === dialog.staffId)?.legalName}</p>
              <p className="tax-muted">
                Current files and all archived versions for this employee.
              </p>
              {currentDocuments
                .filter((d) => d.staff_id === dialog.staffId)
                .map((doc) => (
                  <section className="tax-panel" key={doc.id}>
                    <strong>{doc.title}</strong>
                    <p>
                      v{doc.version} · {doc.archived_at ? "Archive" : "Current"}
                    </p>
                    {documentActions(doc)}
                  </section>
                ))}
            </>
          )}
          {dialog.type === "batch" && (
            <>
              <p>
                {currentRun?.period_start} – {currentRun?.period_end} · v
                {currentRun?.version}
              </p>
              <label className="tax-form">
                Select PDF / image files
                <input
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg,.webp"
                  disabled={pending}
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    setBatch((value) => [
                      ...value,
                      ...files.map((file) => ({
                        key: crypto.randomUUID(),
                        file,
                        staffId: "",
                        state: "pending" as const,
                      })),
                    ]);
                    setBatchConfirmed(false);
                    e.target.value = "";
                  }}
                />
              </label>
              <div className="tax-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Employee</th>
                      <th>Result</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {batch.map((item) => (
                      <tr key={item.key}>
                        <td>
                          {item.file.name}
                          <small>{Math.ceil(item.file.size / 1024)} KB</small>
                        </td>
                        <td>
                          <select
                            aria-label={`Recipient for ${item.file.name}`}
                            value={item.staffId}
                            disabled={pending || item.state === "sent"}
                            onChange={(e) => {
                              setBatch((value) =>
                                value.map((b) =>
                                  b.key === item.key
                                    ? {
                                        ...b,
                                        staffId: e.target.value,
                                        state: "pending",
                                      }
                                    : b,
                                ),
                              );
                              setBatchConfirmed(false);
                            }}
                          >
                            <option value="">Match employee…</option>
                            {displayLines.map((l) => (
                              <option key={l.staff_id} value={l.staff_id}>
                                {l.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {item.state}
                          {item.error && (
                            <p role="alert" className="tax-error">
                              {item.error}
                            </p>
                          )}
                        </td>
                        <td>
                          {item.state !== "sent" && (
                            <button
                              disabled={pending}
                              onClick={() =>
                                setBatch((value) =>
                                  value.filter((b) => b.key !== item.key),
                                )
                              }
                            >
                              Remove from batch
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tax-muted">
                Use one file per employee. Split a combined PDF before selecting
                it; this app does not guess or distribute other employees&apos;
                pages. Existing paystubs are archived when replaced.
              </p>
              <label className="tax-inline-label">
                <input
                  type="checkbox"
                  checked={batchConfirmed}
                  onChange={(e) => setBatchConfirmed(e.target.checked)}
                />
                I checked each file, recipient and payroll period.
              </label>
              <div className="tax-actions">
                <button
                  className="tax-primary"
                  disabled={
                    pending ||
                    !batchConfirmed ||
                    !batch.some((b) => b.state !== "sent") ||
                    batch.some((b) => !b.staffId) ||
                    new Set(batch.map((b) => b.staffId)).size !== batch.length
                  }
                  onClick={() => start(runBatch)}
                >
                  {pending ? "Sending…" : "Send pending / retry failed files"}
                </button>
              </div>
            </>
          )}
          {dialog.type === "receipt" && (
            <form
              className="tax-form"
              onSubmit={(e) => {
                e.preventDefault();
                const payload = new FormData(e.currentTarget);
                payload.set("salon_id", salonId);
                resetMessages();
                start(async () => {
                  const result = await addTaxReceipt(payload);
                  if (!result.ok) setError(result.error);
                  else {
                    setData((value) => ({
                      ...value,
                      receipts: [result.data as TaxReceipt, ...value.receipts],
                    }));
                    setDialog(null);
                    setNotice(
                      "Receipt saved. Amounts are stored exactly in cents.",
                    );
                  }
                });
              }}
            >
              <input type="hidden" name="request_id" value={dialog.requestId} />
              <label>
                Category
                <select name="category">
                  {Object.entries(categories).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Description
                <input name="description" required maxLength={500} />
              </label>
              <div className="tax-fields">
                <label>
                  Date
                  <input
                    type="date"
                    name="receipt_date"
                    required
                    defaultValue={today}
                  />
                </label>
                <label>
                  Amount · USD
                  <input
                    name="amount"
                    required
                    inputMode="decimal"
                    pattern="(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?"
                    placeholder="0.00"
                  />
                </label>
              </div>
              <label>
                Status
                <select name="status">
                  <option value="needs_review">Needs review</option>
                  <option value="received">Received</option>
                  <option value="paid">Paid</option>
                </select>
              </label>
              <label>
                Supporting document
                <select name="document_id">
                  <option value="">No attachment</option>
                  {currentDocuments
                    .filter((d) => !d.archived_at)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title}
                      </option>
                    ))}
                </select>
              </label>
              <p className="tax-muted">
                Upload a supporting file in Documents first. To correct a
                receipt, archive the old record and add the corrected one.
              </p>
              <button className="tax-primary" disabled={pending}>
                {pending ? "Saving…" : "Save receipt"}
              </button>
            </form>
          )}
          {dialog.type === "delete" && isOwner && (
            <>
              <p>
                This removes the file from the owner&apos;s business records and
                tax access. A delivered staff personal copy remains available to
                its recipient.
              </p>
              <p>
                File: <strong>{dialog.document.title}</strong>
              </p>
              <button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await removeOwnerTaxDocument(
                      dialog.document.id,
                    );
                    if (!result.ok) setError(result.error);
                    else {
                      setData((value) => ({
                        ...value,
                        documents: value.documents.filter(
                          (d) => d.id !== dialog.document.id,
                        ),
                      }));
                      setDialog(null);
                      setNotice(
                        "Owner record removed. Delivered staff history is preserved.",
                      );
                    }
                  })
                }
              >
                Confirm removal
              </button>
            </>
          )}
          {dialog.type === "salon" && (
            <>
              <p>
                <strong>{data.salon.name}</strong>
              </p>
              <p>
                {[data.salon.address_line1, data.salon.city, data.salon.state]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p>{data.salon.phone}</p>
              <p className="tax-muted">
                Business information is read-only here. The owner manages its
                source settings.
              </p>
              <button
                onClick={() => {
                  setDialog(null);
                  switchTab("documents");
                }}
              >
                Open business documents
              </button>
            </>
          )}
        </TaxDialog>
      )}
    </div>
  );
}

function TaxEmployeeRow({
  line,
  expanded,
  summary,
  stub,
  changed,
  onExpand,
  onView,
  onUpload,
  onEmployee,
}: {
  line: TaxLine;
  expanded: boolean;
  summary: boolean;
  stub: TaxDocument | null;
  changed: boolean;
  onExpand: () => void;
  onView: () => void;
  onUpload: () => void;
  onEmployee: () => void;
}) {
  const amount = (value: number | null) =>
    value === null ? "—" : money(value);
  return (
    <>
      <tr>
        <td className="tax-person" data-label="Employee">
          <button onClick={onExpand} aria-expanded={expanded}>
            {line.name}
          </button>
          <small>{line.legal_name || "Legal name not supplied"}</small>
          {changed && !stub && <small>Updated amounts · review paystub</small>}
        </td>
        <td className="tax-num" data-label="Wages reported">
          {money(line.reported_wage)}
        </td>
        <td className="tax-num" data-label="Tips reported">
          {amount(line.tip)}
          {line.tip !== null && (
            <small>{line.tip_method ?? "See documents"}</small>
          )}
        </td>
        <td className="tax-num" data-label="Bonus reported">
          {amount(line.bonus)}
          {line.bonus !== null && (
            <small>{line.bonus_method ?? "See documents"}</small>
          )}
        </td>
        <td className="tax-num" data-label="Total reported">
          {money(line.reported_gross)}
        </td>
        <td className="tax-num" data-label="Withheld by salon">
          {money(line.tax)}
        </td>
        <td className="tax-num" data-label="Check amount">
          {money(line.actual_check)}
        </td>
        <td data-label="Paystub">
          {summary ? (
            <span className="tax-muted">Open a period</span>
          ) : (
            <div className="tax-actions">
              <button className={stub ? "" : "tax-primary"} onClick={onView}>
                {stub ? "✓ View paystub" : "↑ Upload needed"}
              </button>
              {stub && <button onClick={onUpload}>Replace</button>}
            </div>
          )}
        </td>
        <td data-label="Details">
          <button aria-label={"Details for " + line.name} onClick={onExpand}>
            Details
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="tax-expanded-row">
          <td className="tax-detail" colSpan={9}>
            <div className="tax-detail-grid">
              <div className="tax-mobile-breakdown">
                <span>Wages reported</span>
                {money(line.reported_wage)}
              </div>
              <div className="tax-mobile-breakdown">
                <span>Tips reported</span>
                {amount(line.tip)} {line.tip_method}
              </div>
              <div className="tax-mobile-breakdown">
                <span>Bonus reported</span>
                {amount(line.bonus)} {line.bonus_method}
              </div>
              <div>
                <span>Cash reported · included in total</span>
                {amount(line.cash_reported)}
              </div>
              <div>
                <span>Base wage paid by check · net</span>
                {money(line.wage_check_net)}
              </div>
              <div>
                <span>Salon withholding rate</span>
                {line.tax_rate !== null && Number.isFinite(line.tax_rate)
                  ? String(line.tax_rate) + "%"
                  : "Historical / multiple rates"}
              </div>
            </div>
            <div className="tax-actions">
              <button onClick={onEmployee}>Employee documents</button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

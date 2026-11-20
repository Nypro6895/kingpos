"use client";
import { useTransientOverlay } from "@/components/overlay-dismissal";

import {
  WorkspaceText,
  useWorkspaceTranslation,
} from "@/components/workspace-language";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ActionFeedback } from "@/components/action-feedback";
import { portableDeviceStorage } from "@/lib/portable-device-storage";
import { savedPosDraft } from "@/lib/held-pos-ticket";

type Saved<T> = { id: string; at: number; label: string; value: T };
type OpenShared<T> = (load: () => Promise<T | null>) => Promise<boolean>;
function SharedTicketsSlot<T>({
  render,
  onOpen,
}: {
  render: (open: OpenShared<T>) => ReactNode;
  onOpen: OpenShared<T>;
}) {
  return render((load) => onOpen(load));
}
export function PortableDraftControls<T>({
  scope,
  active,
  disabled = false,
  compact = false,
  activity,
  value,
  label,
  reset,
  restore,
  leading,
  sharedTickets,
  sharedSummary,
  parkShared,
  resolveSaved,
  onSavedChange,
  idleMinutes = 3,
  warningSeconds = 60,
}: {
  compact?: boolean;
  sharedSummary?: { open: number; ready: number };
  idleMinutes?: number;
  warningSeconds?: number;
  leading?: ReactNode;
  sharedTickets?:
    | ReactNode
    | ((
        open: (load: () => Promise<T | null>) => Promise<boolean>,
      ) => ReactNode);
  scope: string;
  active: boolean;
  disabled?: boolean;
  activity: string;
  value: T;
  label: string;
  reset: () => Promise<unknown>;
  restore: (value: T) => boolean;
  onSavedChange?: (values: T[]) => void;
  parkShared?: () => Promise<boolean | null | { value: T }>;
  resolveSaved?: (value: T) => Promise<T | null>;
}) {
  const __vt = useWorkspaceTranslation();

  const key = `kingpos:parked-tickets:v1:${scope}`;
  const [saved, setSaved] = useState<Saved<T>[]>([]);
  const savedRows = useRef<Saved<T>[]>([]);
  const [pending, setPending] = useState<Saved<T> | null>(null);
  useTransientOverlay(() => setPending(null), Boolean(pending));
  const savedChange = useRef(onSavedChange);
  useEffect(() => {
    savedChange.current = onSavedChange;
  }, [onSavedChange]);
  useEffect(() => {
    savedChange.current?.(saved.map((row) => row.value));
  }, [saved]);
  const [open, setOpen] = useState(false);
  useTransientOverlay(() => setOpen(false), open);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(60);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const parkingRef = useRef(false);
  const parkedValue = useRef(value);
  const opening = useRef(false);
  const [saving, setSaving] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [closedEdits, setClosedEdits] = useState<Saved<T>[]>([]);
  const transferFocus = useRef<HTMLDivElement>(null);
  const idleSave = useRef<() => Promise<boolean>>(async () => false);
  useEffect(() => {
    if (saving || transferring) transferFocus.current?.focus();
  }, [saving, transferring]);
  const current = useRef({ value, reset, active, disabled });
  useEffect(() => {
    current.current = { value, reset, active, disabled };
  }, [value, reset, active, disabled]);
  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      try {
        const archive = JSON.parse(
          portableDeviceStorage.getItem(
            `kingpos:closed-ticket-edits:v1:${scope}`,
          ) ?? "[]",
        );
        if (Array.isArray(archive)) setClosedEdits(archive);
      } catch {
        // Older native hosts do not expose the closed-edit archive namespace.
        // Its absence must not hide ordinary saved tickets.
        setClosedEdits([]);
      }
      try {
        const rows = JSON.parse(portableDeviceStorage.getItem(key) ?? "[]");
        if (Array.isArray(rows)) {
          savedRows.current = rows;
          setSaved(rows);
        }
      } catch {
        setError("Unable to read saved tickets.");
      }
    });
    return () => {
      alive = false;
    };
  }, [key, open, scope]);
  useEffect(() => {
    if (!active || pending || disabled || saving) {
      const clear = setTimeout(() => setDeadline(null), 0);
      return () => clearTimeout(clear);
    }
    const timer = setTimeout(() => {
      setSeconds(warningSeconds);
      setDeadline(Date.now() + warningSeconds * 1000);
    }, idleMinutes * 60000);
    return () => clearTimeout(timer);
  }, [
    active,
    activity,
    tick,
    pending,
    disabled,
    saving,
    idleMinutes,
    warningSeconds,
  ]);
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => {
      setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
      if (Date.now() >= deadline) {
        clearInterval(timer);
        setDeadline(null);
        if (current.current.active && !current.current.disabled)
          void idleSave.current();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [deadline]);
  function persist(rows: Saved<T>[]) {
    try {
      portableDeviceStorage.setItem(key, JSON.stringify(rows));
      savedRows.current = rows;
      setSaved(rows);
      setError("");
      return true;
    } catch {
      setError("Unable to save on this device. Your ticket is still open.");
      return false;
    }
  }
  async function park(openAfter = true): Promise<boolean> {
    if (disabled || parkingRef.current) return false;
    parkingRef.current = true;
    setSaving(true);
    setDeadline(null);
    setError("");
    parkedValue.current = current.current.value;
    try {
      if (parkShared) {
        const shared = await parkShared();
        if (shared === false) {
          setOpen(false);
          setError(
            "Unable to save shared ticket. Your ticket is still open. Check the connection or refresh conflicting changes.",
          );
          return false;
        }
        if (shared === true || (shared && typeof shared === "object")) {
          if (typeof shared === "object") parkedValue.current = shared.value;
          setDeadline(null);
          const result = await current.current.reset();
          if (result === false) return false;
          if (openAfter) setOpen(true);
          return true;
        }
      }
      // Save first; never clear the working receipt after a storage failure.
      if (
        !persist([
          ...savedRows.current,
          savedPosDraft(current.current.value, label),
        ])
      ) {
        setDeadline(null);
        setTick((t) => t + 1);
        return false;
      }
      setDeadline(null);
      return (await current.current.reset()) !== false;
    } catch {
      setError("Unable to save shared ticket. Your ticket is still open.");
      return false;
    } finally {
      parkingRef.current = false;
      setSaving(false);
    }
  }
  useEffect(() => {
    idleSave.current = () => park(false);
  });
  async function openShared(load: () => Promise<T | null>): Promise<boolean> {
    if (opening.current || parkingRef.current) return false;
    opening.current = true;
    setTransferring(true);
    setError("");
    let previous = current.current.active ? current.current.value : null;
    let parked = false;
    try {
      if (current.current.active) {
        if (!(await park(false))) return false;
        previous = parkedValue.current;
        parked = true;
      }
      // Fetch after saving: saving the old ticket may have changed this very
      // ticket's revision. Opening is a read, never a checkout or removal.
      const next = await load();
      if (!next || !restore(next)) {
        if (parked && previous) restore(previous);
        setError("Unable to open this ticket. Both tickets have been kept.");
        return false;
      }
      setOpen(false);
      setPending(null);
      setDeadline(null);
      setError("");
      return true;
    } catch {
      if (parked && previous) restore(previous);
      setError("Unable to open this ticket. Both tickets have been kept.");
      return false;
    } finally {
      opening.current = false;
      setTransferring(false);
    }
  }
  function handleOpenSaved(row: Saved<T>, currentTicket?: Saved<T>) {
    if (disabled || parkingRef.current) return;
    let rows = saved;
    if (currentTicket) {
      rows = [...saved, currentTicket];
      if (!persist(rows)) return;
    }
    if (!restore(row.value)) {
      setError("Unable to open this ticket. Both tickets have been kept.");
      return;
    }
    persist(rows.filter((item) => item.id !== row.id));
    setPending(null);
    setDeadline(null);
    setTick((t) => t + 1);
  }
  const button =
    "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold shadow-sm transition hover:-translate-y-0.5 hover:bg-zinc-50 hover:shadow-md active:translate-y-0 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600";
  return (
    <>
      {(saving || transferring) &&
        createPortal(
          <div
            ref={transferFocus}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Saving and opening ticket"
            onKeyDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            className="fixed inset-0 z-[200] grid place-items-center bg-black/40"
          >
            <p className="rounded-xl bg-white p-5 font-semibold">
              <WorkspaceText text="Saving and opening ticket…" />
            </p>
          </div>,
          document.body,
        )}
      <div className="grid grid-cols-2 gap-2" data-pos-customer-shortcuts>
        {leading}
        <button
          type="button"
          data-pos-saved-launcher
          aria-label={__vt(
            sharedSummary
              ? `Saved tickets (${sharedSummary.open} open${saved.length ? `, ${saved.length} on device` : ""})`
              : `Saved tickets (${saved.length})`,
          )}
          aria-expanded={open}
          title={__vt(sharedSummary ? `${sharedSummary.open} open · ${sharedSummary.ready} ready${saved.length ? ` · ${saved.length} on device` : ""}` : `${saved.length} saved`)}
          disabled={saving || disabled || transferring}
          onClick={() => setOpen(!open)}
          className="flex min-h-20 min-w-0 items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 text-left transition hover:border-teal-300 hover:bg-teal-50 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-teal-700"
        >
          <svg
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-teal-800"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6" />
          </svg>
          <span data-pos-saved-copy className="min-w-0">
            <span className="block text-sm font-semibold">
              <WorkspaceText text={compact ? "Saved" : "Saved tickets"} />
            </span>
            <span data-pos-saved-summary className="mt-1 block text-xs text-zinc-500">
              <WorkspaceText
                text={
                  sharedSummary
                    ? `${sharedSummary.open} open · ${sharedSummary.ready} ready${saved.length ? ` · ${saved.length} on device` : ""}`
                    : sharedTickets
                      ? "Phone & POS tickets"
                      : saved.length
                        ? `${saved.length} saved`
                        : "None saved"
                }
              />
            </span>
            {!compact && (
              <span className="mt-1 block text-xs text-zinc-500">
                <WorkspaceText
                  text={saved.length ? `${saved.length} saved` : "None saved"}
                />
              </span>
            )}
          </span>
          {compact && (sharedSummary?.open || saved.length) > 0 && <span data-pos-saved-count aria-hidden="true" className="hidden">{(sharedSummary?.open ?? 0) + saved.length}</span>}
        </button>
        {active && (
          <button
            type="button"
            disabled={saving || disabled}
            aria-busy={saving}
            aria-label={__vt("Save for later")}
            data-pos-saved-save
            onClick={() => void park()}
            className={
              button +
              " col-span-2 !min-h-10 !rounded-lg !shadow-none text-teal-800"
            }
          >
            <ActionFeedback pending={saving} pendingLabel="Saving…">
              {compact ? <><svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M4 4h13l3 3v13H4V4Zm4 0v6h8V4M8 20v-7h8v7"/></svg><WorkspaceText text={saving ? "Saving…" : "Save"}/></> : <WorkspaceText text={saving ? "Saving…" : "Save for later"} />}
            </ActionFeedback>
          </button>
        )}
      </div>
      {error && !pending && (
        <p role="alert" className="text-sm text-red-700">
          <WorkspaceText text={error} />
        </p>
      )}
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[85] bg-black/20"
            onClick={() => setOpen(false)}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-label={__vt("Saved tickets")}
              className="fixed bottom-4 left-4 top-[88px] flex w-[min(560px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-center justify-between border-b px-5 py-3">
                <h2 className="font-semibold">
                  <WorkspaceText text="Saved tickets" />
                </h2>
                <button
                  type="button"
                  className={button}
                  onClick={() => setOpen(false)}
                >
                  <WorkspaceText text="Close" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto px-4">
                {typeof sharedTickets === "function" ? (
                  <SharedTicketsSlot
                    render={sharedTickets}
                    onOpen={openShared}
                  />
                ) : (
                  sharedTickets
                )}
                {sharedTickets && saved.length > 0 && (
                  <h3 className="mt-4 font-semibold">
                    <WorkspaceText text="On this device" />
                  </h3>
                )}
                {closedEdits.length > 0 && (
                  <section className="mt-4 rounded border border-amber-200 p-3">
                    <h3 className="font-semibold">
                      Closed ticket edits · Read only
                    </h3>
                    {closedEdits.map((row) => (
                      <details key={row.id} className="py-2">
                        <summary>
                          {row.label} · {new Date(row.at).toLocaleTimeString()}
                        </summary>
                        <ClosedEditsSummary value={row.value} />
                      </details>
                    ))}
                  </section>
                )}
                <ul className="divide-y">
                  {saved.length === 0
                    ? !sharedTickets && (
                        <li className="py-6 text-center text-sm text-zinc-500">
                          <WorkspaceText text="No saved tickets" />
                        </li>
                      )
                    : saved.map((row) => (
                        <li
                          key={row.id}
                          className="flex items-center gap-3 py-2"
                        >
                          <button
                            type="button"
                            className="flex min-h-14 min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-teal-50 active:bg-teal-100 focus-visible:outline-2 focus-visible:outline-teal-600"
                            onClick={() => {
                              if (typeof sharedTickets === "function") {
                                void openShared(async () => {
                                  const next = resolveSaved
                                    ? await resolveSaved(row.value)
                                    : row.value;
                                  if (!next)
                                    persist(
                                      savedRows.current.filter(
                                        (item) => item.id !== row.id,
                                      ),
                                    );
                                  return next;
                                }).then((ok) => {
                                  if (ok)
                                    persist(
                                      savedRows.current.filter(
                                        (item) => item.id !== row.id,
                                      ),
                                    );
                                });
                                return;
                              }
                              setOpen(false);
                              setError("");
                              if (active) {
                                setDeadline(null);
                                setPending(row);
                                return;
                              }
                              handleOpenSaved(row);
                            }}
                          >
                            <span className="truncate font-semibold">
                              <WorkspaceText text={row.label} />
                            </span>
                            <time className="shrink-0 text-xs text-zinc-500">
                              <WorkspaceText
                                text={new Date(row.at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              />
                            </time>
                          </button>
                          <button
                            type="button"
                            className={button + " text-red-700 hover:bg-red-50"}
                            aria-label={__vt(
                              `Delete saved ticket ${row.label}`,
                            )}
                            onClick={() =>
                              persist(
                                saved.filter((item) => item.id !== row.id),
                              )
                            }
                          >
                            <WorkspaceText text="Remove" />
                          </button>
                        </li>
                      ))}
                </ul>
              </div>
            </section>
          </div>,
          document.body,
        )}
      {pending &&
        createPortal(
          <div className="fixed inset-0 z-[95] grid place-items-center bg-black/40 p-4">
            <section
              role="dialog"
              aria-modal="true"
              aria-label={__vt("Open saved ticket")}
              className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            >
              <h2 className="text-lg font-semibold">
                <WorkspaceText text="Keep the current ticket?" />
              </h2>
              <p className="mb-5 mt-2 text-sm text-zinc-600">
                <WorkspaceText text="Save it for later, or reset it to open the saved ticket." />
              </p>
              {error && (
                <p role="alert" className="mb-4 text-sm text-red-700">
                  <WorkspaceText text={error} />
                </p>
              )}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={saving || disabled}
                  className={button + " text-red-700"}
                  onClick={() => handleOpenSaved(pending)}
                >
                  <WorkspaceText text="Reset" />
                </button>
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    setPending(null);
                    setError("");
                    setTick((t) => t + 1);
                  }}
                >
                  <WorkspaceText text="Cancel" />
                </button>
                <button
                  type="button"
                  disabled={saving || disabled}
                  className={
                    button
                      .replace("bg-white", "bg-orange-600")
                      .replace("hover:bg-zinc-50", "hover:bg-orange-700") +
                    " text-white"
                  }
                  onClick={() =>
                    handleOpenSaved(pending, {
                      id: crypto.randomUUID(),
                      at: Date.now(),
                      label,
                      value: current.current.value,
                    })
                  }
                >
                  <WorkspaceText text="Save" />
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )}
      {deadline &&
        active &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] grid place-items-center bg-black/30 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={__vt("Unfinished ticket")}
          >
            <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
              <h2 className="text-lg font-semibold">
                <WorkspaceText text="Keep this ticket?" />
              </h2>
              <p className="mb-5 mt-2 text-sm leading-6 text-zinc-600">
                <WorkspaceText text="You haven’t used this ticket for" />{" "}
                {idleMinutes}{" "}
                <WorkspaceText text="minutes. Save it for later or continue working. It will be saved in" />{" "}
                <strong className="tabular-nums">{seconds}s</strong>.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={
                    button
                      .replace("bg-white", "bg-teal-700")
                      .replace("hover:bg-zinc-50", "hover:bg-teal-800") +
                    " border-teal-700 text-white"
                  }
                  disabled={saving || disabled}
                  aria-busy={saving}
                  onClick={() => void park()}
                >
                  <ActionFeedback pending={saving} pendingLabel="Saving…">
                    <WorkspaceText text="Save for later" />
                  </ActionFeedback>
                </button>
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    setDeadline(null);
                    setTick((t) => t + 1);
                  }}
                >
                  <WorkspaceText text="Continue" />
                </button>
                <button
                  type="button"
                  disabled={saving || disabled}
                  className={
                    button +
                    " text-red-700 hover:border-red-200 hover:bg-red-50"
                  }
                  onClick={() => {
                    setDeadline(null);
                    void current.current.reset();
                  }}
                >
                  <WorkspaceText text="Discard" />
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function ClosedEditsSummary({ value }: { value: unknown }) {
  const v = value as {
    note?: string;
    draft?: { note?: string };
    lines?: {
      serviceLabel?: string;
      service_label?: string;
      staffName?: string;
      staff_name?: string;
      total?: number;
      amount?: number;
    }[];
  };
  return (
    <div className="text-sm">
      {v.lines?.map((l, i) => (
        <p key={i}>
          {l.serviceLabel ?? l.service_label} · {l.staffName ?? l.staff_name} ·
          ${l.total ?? l.amount}
        </p>
      ))}
      {(v.note || v.draft?.note) && <p>{v.note || v.draft?.note}</p>}
    </div>
  );
}

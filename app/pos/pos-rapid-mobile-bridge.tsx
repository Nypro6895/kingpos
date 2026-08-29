"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PosDeskService, PosDeskStaff } from "@/types/pos-desk";

type RapidStage =
  | "amount"
  | "receipt"
  | "service-edit"
  | "staff"
  | "staff-edit"
  | null;

type ReceiptLineView = {
  index: number;
  price: string;
  service: string;
  staff: string;
};

type Props = {
  services: PosDeskService[];
  staff: PosDeskStaff[];
};

const MOBILE_QUERY = "(max-width: 767px)";

function waitForPaint(delay = 0) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delay));
}

function text(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function turn(member: PosDeskStaff) {
  return member.turns.queueTurns ?? member.turns.largeTurns;
}

function unavailable(member: PosDeskStaff) {
  return (
    !member.is_active ||
    member.today_status === "checked_out" ||
    member.today_status === "auto_checked_out" ||
    member.today_status === "unavailable"
  );
}

function numericInput(value: string) {
  const source = value.trim().startsWith("$") ? value.trim().slice(1) : value.trim();
  return source.replace(/[^0-9./]/g, "");
}

export function PosRapidMobileBridge({ services, staff }: Props) {
  const bridgeRef = useRef<HTMLDivElement | null>(null);
  const allowServiceClickRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [stage, setStage] = useState<RapidStage>(null);
  const [pendingService, setPendingService] = useState<PosDeskService | null>(null);
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null);
  const [currentInput, setCurrentInput] = useState("$0");
  const [total, setTotal] = useState("$0.00");
  const [receiptLines, setReceiptLines] = useState<ReceiptLineView[]>([]);
  const [serviceQuery, setServiceQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const orderedStaff = useMemo(
    () =>
      [...staff].sort(
        (left, right) =>
          turn(left) - turn(right) ||
          (left.check_in_sequence ?? Number.MAX_SAFE_INTEGER) -
            (right.check_in_sequence ?? Number.MAX_SAFE_INTEGER) ||
          left.display_name.localeCompare(right.display_name),
      ),
    [staff],
  );

  const filteredServices = useMemo(() => {
    const query = serviceQuery.trim().toLowerCase();
    if (!query) return services;
    return services.filter((service) =>
      `${service.name} ${service.category ?? ""}`.toLowerCase().includes(query),
    );
  }, [serviceQuery, services]);

  const engine = useCallback(
    () =>
      bridgeRef.current?.parentElement?.querySelector<HTMLElement>(
        "[data-pos-rapid-engine]",
      ) ?? null,
    [],
  );

  const readCurrentInput = useCallback(() => {
    return (
      text(
        engine()?.querySelector<HTMLElement>("[data-pos-current-input] p:last-child")
          ?.textContent,
      ) || "$0"
    );
  }, [engine]);

  const sync = useCallback(() => {
    const root = engine();
    if (!root) return;

    const totalText = text(
      root.querySelector<HTMLElement>("[data-pos-receipt-total] span:last-child")
        ?.textContent,
    );
    const inputText = text(
      root.querySelector<HTMLElement>("[data-pos-current-input] p:last-child")
        ?.textContent,
    );
    const lines = Array.from(
      root.querySelectorAll<HTMLElement>("[data-pos-receipt-line]"),
    ).map((row, index) => ({
      index,
      price:
        text(
          row.querySelector<HTMLElement>("[data-pos-receipt-line-price]")?.textContent,
        ) || "$0.00",
      service:
        text(
          row.querySelector<HTMLElement>("[data-pos-receipt-line-service]")?.textContent,
        ) || `Service ${index + 1}`,
      staff:
        text(
          row.querySelector<HTMLElement>("[data-pos-receipt-line-staff]")?.textContent,
        ) || "Assigned staff",
    }));

    if (totalText) setTotal(totalText);
    if (inputText) setCurrentInput(inputText);
    setReceiptLines(lines);
  }, [engine]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const root = engine();
    if (!root) return;

    let frame = window.requestAnimationFrame(sync);
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(sync);
    });
    observer.observe(root, { characterData: true, childList: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [engine, sync]);

  const serviceFromButton = useCallback(
    (button: HTMLButtonElement) => {
      const label = text(button.textContent).toLowerCase();
      return (
        services.find((service) => {
          const name = service.name.trim().toLowerCase();
          return label === name || label.startsWith(`${name} `);
        }) ?? null
      );
    },
    [services],
  );

  useEffect(() => {
    if (!isMobile) return;

    const intercept = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("button");
      if (!button) return;

      const serviceButton =
        button.matches("[data-pos-service-tile]") ||
        Boolean(button.closest("[data-pos-service-picker]"));
      if (!serviceButton) return;

      const service = serviceFromButton(button);
      if (!service) return;

      if (allowServiceClickRef.current) {
        allowServiceClickRef.current = false;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setNotice(null);
      setPendingService(service);
      setEditingLineIndex(null);
      setStage("staff");

      if (button.closest("[data-pos-service-picker]")) {
        window.setTimeout(() => {
          const picker = engine()?.querySelector<HTMLElement>("[data-pos-service-picker]");
          Array.from(picker?.querySelectorAll<HTMLButtonElement>("button") ?? [])
            .find((candidate) => text(candidate.textContent) === "Close")
            ?.click();
        }, 0);
      }
    };

    document.addEventListener("click", intercept, true);
    return () => document.removeEventListener("click", intercept, true);
  }, [engine, isMobile, serviceFromButton]);

  const clickStaff = useCallback(
    (member: PosDeskStaff) => {
      const button = Array.from(
        engine()?.querySelectorAll<HTMLButtonElement>(
          "[data-pos-staff-turn-board] button[aria-label]",
        ) ?? [],
      ).find((candidate) =>
        (candidate.getAttribute("aria-label") ?? "").startsWith(
          `${member.display_name},`,
        ),
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    [engine],
  );

  const applyService = useCallback(
    async (service: PosDeskService) => {
      const root = engine();
      if (!root) return false;

      let button = Array.from(
        root.querySelectorAll<HTMLButtonElement>("[data-pos-service-tile]"),
      ).find((candidate) => serviceFromButton(candidate)?.id === service.id);

      if (!button) {
        Array.from(
          root.querySelectorAll<HTMLButtonElement>("[data-pos-service-workspace] button"),
        )
          .find((candidate) => ["Catalog", "More"].includes(text(candidate.textContent)))
          ?.click();
        await waitForPaint(40);
        button = Array.from(
          root.querySelectorAll<HTMLButtonElement>("[data-pos-service-picker] button"),
        ).find((candidate) => serviceFromButton(candidate)?.id === service.id);
      }

      if (!button || button.disabled) return false;
      allowServiceClickRef.current = true;
      button.click();
      await waitForPaint();
      sync();
      return true;
    },
    [engine, serviceFromButton, sync],
  );

  const pressKey = useCallback(
    async (key: string) => {
      const panel = engine()?.querySelector<HTMLElement>("[data-pos-amount-panel]");
      const button = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
        (candidate) => text(candidate.textContent) === key,
      );
      if (!button || button.disabled) return;
      button.click();
      await waitForPaint();
      sync();
    },
    [engine, sync],
  );

  const clearAmount = useCallback(async () => {
    const button = engine()?.querySelector<HTMLButtonElement>("[data-pos-keypad-clear]");
    if (!button || button.disabled) return;
    button.click();
    await waitForPaint();
    sync();
  }, [engine, sync]);

  const replayAmount = useCallback(
    async (value: string) => {
      for (const key of numericInput(value)) await pressKey(key);
    },
    [pressKey],
  );

  const focusLine = useCallback(
    async (index: number) => {
      const row = engine()
        ?.querySelectorAll<HTMLElement>("[data-pos-receipt-line]")
        .item(index);
      const button = row?.querySelector<HTMLButtonElement>("[data-pos-receipt-line-item]");
      if (!button) return false;
      button.click();
      await waitForPaint();
      sync();
      return true;
    },
    [engine, sync],
  );

  const chooseNewStaff = useCallback(
    async (member: PosDeskStaff) => {
      if (!pendingService || unavailable(member)) return;
      setNotice(null);
      if (!clickStaff(member)) {
        setNotice("This technician is unavailable for this ticket.");
        return;
      }
      await waitForPaint();
      if (!(await applyService(pendingService))) {
        setNotice("Unable to select this service. Try again.");
        return;
      }
      setStage("amount");
      await waitForPaint();
      sync();
    },
    [applyService, clickStaff, pendingService, sync],
  );

  const chooseEditedService = useCallback(
    async (service: PosDeskService) => {
      if (editingLineIndex === null || !(await focusLine(editingLineIndex))) return;
      const originalInput = readCurrentInput();
      await clearAmount();
      if (!(await applyService(service))) {
        setNotice("Unable to change this service.");
        return;
      }
      await replayAmount(originalInput);
      setServiceQuery("");
      setStage("receipt");
      await waitForPaint();
      sync();
    },
    [applyService, clearAmount, editingLineIndex, focusLine, readCurrentInput, replayAmount, sync],
  );

  const chooseEditedStaff = useCallback(
    async (member: PosDeskStaff) => {
      if (editingLineIndex === null || unavailable(member)) return;
      const duplicate = receiptLines.some(
        (line) => line.index !== editingLineIndex && line.staff === member.display_name,
      );
      if (duplicate) {
        setNotice("This technician already has another draft line. Edit that line first.");
        return;
      }
      if (!(await focusLine(editingLineIndex))) return;
      const originalInput = readCurrentInput();
      await clearAmount();
      if (!clickStaff(member)) {
        setNotice("Unable to change technician.");
        return;
      }
      await waitForPaint();
      await replayAmount(originalInput);
      setStage("receipt");
      await waitForPaint();
      sync();
    },
    [clearAmount, clickStaff, editingLineIndex, focusLine, readCurrentInput, receiptLines, replayAmount, sync],
  );

  const removeLine = useCallback(
    (index: number) => {
      const row = engine()
        ?.querySelectorAll<HTMLElement>("[data-pos-receipt-line]")
        .item(index);
      row?.querySelector<HTMLButtonElement>("[data-pos-receipt-line-remove]")?.click();
      window.setTimeout(sync, 0);
    },
    [engine, sync],
  );

  const checkout = useCallback(() => {
    const panel = engine()?.querySelector<HTMLElement>("[data-pos-amount-panel]");
    const button = Array.from(panel?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (candidate) => ["Submit", "Submitting"].includes(text(candidate.textContent)),
    );
    if (button && !button.disabled) {
      setStage(null);
      button.click();
    }
  }, [engine]);

  if (!isMobile) return <div ref={bridgeRef} />;

  return (
    <div ref={bridgeRef} data-pos-rapid-mobile-bridge>
      <button
        aria-label={`Current ticket total ${total}. Open receipt`}
        className="absolute inset-x-2 top-2 z-20 flex h-14 items-center justify-between rounded-2xl border border-zinc-200 bg-white/96 px-4 text-left shadow-[0_12px_30px_rgba(24,24,27,0.12)] backdrop-blur"
        data-pos-rapid-total
        onClick={() => {
          setNotice(null);
          setStage("receipt");
          sync();
        }}
        type="button"
      >
        <span>
          <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
            Current ticket
          </span>
          <span className="mt-0.5 block text-xs font-semibold text-zinc-600">
            {receiptLines.length} {receiptLines.length === 1 ? "service" : "services"}
          </span>
        </span>
        <span className="text-2xl font-black tabular-nums text-zinc-950">{total}</span>
      </button>

      {stage ? (
        <div className="fixed inset-0 z-[85] flex items-end bg-zinc-950/35">
          <button
            aria-label="Close"
            className="absolute inset-0 cursor-default"
            onClick={() => setStage(null)}
            type="button"
          />
          <section
            aria-modal="true"
            className="relative z-10 flex max-h-[min(88dvh,46rem)] w-full flex-col overflow-hidden rounded-t-[1.35rem] bg-white shadow-2xl"
            role="dialog"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-zinc-500">
                  {stage === "staff" || stage === "staff-edit"
                    ? "Technician"
                    : stage === "amount"
                      ? "Amount"
                      : stage === "service-edit"
                        ? "Service"
                        : "Receipt"}
                </p>
                <h2 className="truncate text-lg font-bold text-zinc-950">
                  {stage === "staff"
                    ? pendingService?.name ?? "Choose technician"
                    : stage === "staff-edit"
                      ? "Change technician"
                      : stage === "amount"
                        ? pendingService?.name ?? "Edit amount"
                        : stage === "service-edit"
                          ? "Change service"
                          : `Current ticket · ${total}`}
                </h2>
              </div>
              <button
                className="grid h-10 w-10 place-items-center rounded-full bg-zinc-100 text-lg font-bold text-zinc-700"
                onClick={() => setStage(null)}
                type="button"
              >
                ×
              </button>
            </header>

            {notice ? (
              <p className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                {notice}
              </p>
            ) : null}

            {stage === "staff" || stage === "staff-edit" ? (
              <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {orderedStaff.map((member) => {
                  const duplicate =
                    stage === "staff-edit" &&
                    receiptLines.some(
                      (line) =>
                        line.index !== editingLineIndex && line.staff === member.display_name,
                    );
                  return (
                    <button
                      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 text-left shadow-sm active:scale-[0.99] disabled:opacity-40"
                      disabled={unavailable(member) || duplicate}
                      key={member.id}
                      onClick={() =>
                        stage === "staff"
                          ? void chooseNewStaff(member)
                          : void chooseEditedStaff(member)
                      }
                      type="button"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-base font-bold text-zinc-950">
                          {member.display_name}
                        </span>
                        {member.job_title ? (
                          <span className="mt-0.5 block truncate text-xs font-medium text-zinc-500">
                            {member.job_title}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-3xl font-black tabular-nums text-brand-orange">
                        {turn(member)}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {stage === "amount" ? (
              <div className="grid gap-3 px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <div className="rounded-2xl bg-zinc-100 px-4 py-4 text-center">
                  <p className="text-xs font-bold uppercase text-zinc-500">Amount</p>
                  <p className="mt-1 text-4xl font-black tabular-nums text-zinc-950">
                    {currentInput}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "/"].map(
                    (key) => (
                      <button
                        className="min-h-14 rounded-2xl bg-zinc-950 text-xl font-bold text-white active:scale-[0.98]"
                        key={key}
                        onClick={() => void pressKey(key)}
                        type="button"
                      >
                        {key}
                      </button>
                    ),
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    className="min-h-12 rounded-2xl border border-zinc-200 bg-white font-bold text-zinc-700"
                    onClick={() => void pressKey("Back")}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    className="min-h-12 rounded-2xl border border-zinc-200 bg-white font-bold text-zinc-700"
                    onClick={() => void clearAmount()}
                    type="button"
                  >
                    Clear
                  </button>
                  <button
                    className="min-h-12 rounded-2xl bg-brand-orange font-black text-white shadow-lg"
                    onClick={() => {
                      setPendingService(null);
                      setEditingLineIndex(null);
                      setStage(null);
                      window.setTimeout(sync, 0);
                    }}
                    type="button"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}

            {stage === "service-edit" ? (
              <div className="flex min-h-0 flex-1 flex-col px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <input
                  className="h-12 shrink-0 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 text-base outline-none focus:border-brand-orange"
                  onChange={(event) => setServiceQuery(event.target.value)}
                  placeholder="Search services"
                  type="search"
                  value={serviceQuery}
                />
                <div className="mt-3 grid min-h-0 flex-1 grid-cols-2 content-start gap-2 overflow-y-auto">
                  {filteredServices.map((service) => (
                    <button
                      className="min-h-14 rounded-2xl border border-zinc-200 bg-white px-3 py-3 text-left shadow-sm"
                      key={service.id}
                      onClick={() => void chooseEditedService(service)}
                      type="button"
                    >
                      <span className="block font-bold text-zinc-950">{service.name}</span>
                      {service.category ? (
                        <span className="mt-0.5 block text-xs font-medium text-zinc-500">
                          {service.category}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {stage === "receipt" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {receiptLines.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm font-semibold text-zinc-500">
                      No services yet.
                    </p>
                  ) : (
                    <div className="grid gap-2">
                      {receiptLines.map((line) => (
                        <article
                          className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm"
                          key={`${line.index}-${line.staff}-${line.service}`}
                        >
                          <div className="min-w-0">
                            <button
                              className="block max-w-full truncate text-left text-sm font-bold text-zinc-950"
                              onClick={() => {
                                setEditingLineIndex(line.index);
                                setServiceQuery("");
                                setNotice(null);
                                setStage("service-edit");
                              }}
                              type="button"
                            >
                              {line.service}
                            </button>
                            <button
                              className="mt-1 block max-w-full truncate text-left text-sm font-semibold text-brand-orange"
                              onClick={() => {
                                setEditingLineIndex(line.index);
                                setNotice(null);
                                setStage("staff-edit");
                              }}
                              type="button"
                            >
                              {line.staff}
                            </button>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              className="min-h-10 rounded-xl px-2 text-base font-black tabular-nums text-zinc-950"
                              onClick={() => {
                                setEditingLineIndex(line.index);
                                void focusLine(line.index).then((focused) => {
                                  if (focused) setStage("amount");
                                });
                              }}
                              type="button"
                            >
                              {line.price}
                            </button>
                            <button
                              aria-label={`Remove ${line.service}`}
                              className="grid h-9 w-9 place-items-center rounded-full text-lg font-bold text-red-600"
                              onClick={() => removeLine(line.index)}
                              type="button"
                            >
                              ×
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </div>
                <footer className="grid shrink-0 grid-cols-[1fr_auto] items-center gap-3 border-t border-zinc-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                  <div>
                    <p className="text-[11px] font-bold uppercase text-zinc-500">Total</p>
                    <p className="text-2xl font-black tabular-nums text-zinc-950">{total}</p>
                  </div>
                  <button
                    className="min-h-12 rounded-2xl bg-brand-orange px-6 font-black text-white shadow-lg disabled:opacity-40"
                    disabled={receiptLines.length === 0}
                    onClick={checkout}
                    type="button"
                  >
                    Checkout
                  </button>
                </footer>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

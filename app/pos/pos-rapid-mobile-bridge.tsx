"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PosDeskService, PosDeskStaff } from "@/types/pos-desk";

type RapidStage = "amount" | "receipt" | "service-edit" | "staff" | "staff-edit" | null;

type ReceiptLineView = {
  index: number;
  price: string;
  service: string;
  staff: string;
};

type PosRapidMobileBridgeProps = {
  services: PosDeskService[];
  staff: PosDeskStaff[];
};

const MOBILE_QUERY = "(max-width: 767px)";

function nextPaint(delay = 0) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delay));
}

function normalizedText(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function moneyInputFromCurrentLabel(value: string) {
  const normalized = value.trim();
  return normalized.startsWith("$") ? normalized.slice(1) : normalized;
}

function getTurn(member: PosDeskStaff) {
  return member.turns.queueTurns ?? member.turns.largeTurns;
}

function isUnavailable(member: PosDeskStaff) {
  return (
    !member.is_active ||
    member.today_status === "checked_out" ||
    member.today_status === "auto_checked_out" ||
    member.today_status === "unavailable"
  );
}

export function PosRapidMobileBridge({ services, staff }: PosRapidMobileBridgeProps) {
  const bridgeRef = useRef<HTMLDivElement | null>(null);
  const allowNextServiceClickRef = useRef(false);
  const [isMobile, setIsMobile] = useState(false);
  const [stage, setStage] = useState<RapidStage>(null);
  const [pendingService, setPendingService] = useState<PosDeskService | null>(null);
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null);
  const [currentInput, setCurrentInput] = useState("$0");
  const [total, setTotal] = useState("$0.00");
  const [receiptLines, setReceiptLines] = useState<ReceiptLineView[]>([]);
  const [serviceQuery, setServiceQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const sortedStaff = useMemo(
    () =>
      [...staff].sort(
        (left, right) =>
          getTurn(left) - getTurn(right) ||
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

  const getEngine = useCallback(() => {
    return bridgeRef.current?.parentElement?.querySelector<HTMLElement>(
      "[data-pos-rapid-engine]",
    ) ?? null;
  }, []);

  const syncFromEngine = useCallback(() => {
    const engine = getEngine();
    if (!engine) return;

    const totalNode = engine.querySelector<HTMLElement>(
      "[data-pos-receipt-total] span:last-child",
    );
    const inputNode = engine.querySelector<HTMLElement>(
      "[data-pos-current-input] p:last-child",
    );

    if (totalNode) setTotal(normalizedText(totalNode.textContent) || "$0.00");
    if (inputNode) setCurrentInput(normalizedText(inputNode.textContent) || "$0");

    const lines = Array.from(
      engine.querySelectorAll<HTMLElement>("[data-pos-receipt-line]"),
    ).map((row, index) => ({
      index,
      price:
        normalizedText(
          row.querySelector<HTMLElement>("[data-pos-receipt-line-price]")?.textContent,
        ) || "$0.00",
      service:
        normalizedText(
          row.querySelector<HTMLElement>("[data-pos-receipt-line-service]")?.textContent,
        ) || `Service ${index + 1}`,
      staff:
        normalizedText(
          row.querySelector<HTMLElement>("[data-pos-receipt-line-staff]")?.textContent,
        ) || "Assigned staff",
    }));

    setReceiptLines(lines);
  }, [getEngine]);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const engine = getEngine();
    if (!engine) return;

    syncFromEngine();
    let frame = 0;
    const observer = new MutationObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncFromEngine);
    });
    observer.observe(engine, { childList: true, characterData: true, subtree: true });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [getEngine, syncFromEngine]);

  const findServiceFromButton = useCallback(
    (button: HTMLButtonElement) => {
      const label = normalizedText(button.textContent).toLowerCase();
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

    const interceptServiceSelection = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest<HTMLButtonElement>("button");
      if (!button) return;

      const isTile = Boolean(button.closest("[data-pos-service-tile]"));
      const isCatalogChoice = Boolean(button.closest("[data-pos-service-picker]"));
      if (!isTile && !isCatalogChoice) return;

      const service = findServiceFromButton(button);
      if (!service) return;

      if (allowNextServiceClickRef.current) {
        allowNextServiceClickRef.current = false;
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      setNotice(null);
      setPendingService(service);
      setEditingLineIndex(null);
      setStage("staff");

      if (isCatalogChoice) {
        window.setTimeout(() => {
          const picker = getEngine()?.querySelector<HTMLElement>("[data-pos-service-picker]");
          const close = Array.from(picker?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
            (candidate) => normalizedText(candidate.textContent) === "Close",
          );
          close?.click();
        }, 0);
      }
    };

    document.addEventListener("click", interceptServiceSelection, true);
    return () => document.removeEventListener("click", interceptServiceSelection, true);
  }, [findServiceFromButton, getEngine, isMobile]);

  const clickStaff = useCallback(
    (member: PosDeskStaff) => {
      const engine = getEngine();
      if (!engine) return false;
      const button = Array.from(
        engine.querySelectorAll<HTMLButtonElement>("[data-pos-staff-turn-board] button[aria-label]"),
      ).find((candidate) =>
        (candidate.getAttribute("aria-label") ?? "").startsWith(`${member.display_name},`),
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    },
    [getEngine],
  );

  const applyService = useCallback(
    async (service: PosDeskService) => {
      const engine = getEngine();
      if (!engine) return false;

      let button = Array.from(
        engine.querySelectorAll<HTMLButtonElement>("[data-pos-service-tile]"),
      ).find((candidate) => findServiceFromButton(candidate)?.id === service.id);

      if (!button) {
        const catalogButton = Array.from(
          engine.querySelectorAll<HTMLButtonElement>("[data-pos-service-workspace] button"),
        ).find((candidate) => {
          const text = normalizedText(candidate.textContent);
          return text === "Catalog" || text === "More";
        });
        catalogButton?.click();
        await nextPaint(40);
        button = Array.from(
          engine.querySelectorAll<HTMLButtonElement>("[data-pos-service-picker] button"),
        ).find((candidate) => findServiceFromButton(candidate)?.id === service.id);
      }

      if (!button || button.disabled) return false;
      allowNextServiceClickRef.current = true;
      button.click();
      await nextPaint();
      syncFromEngine();
      return true;
    },
    [findServiceFromButton, getEngine, syncFromEngine],
  );

  const pressEngineKey = useCallback(
    async (key: string) => {
      const engine = getEngine();
      if (!engine) return;
      const amountPanel = engine.querySelector<HTMLElement>("[data-pos-amount-panel]");
      const button = Array.from(amountPanel?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
        (candidate) => normalizedText(candidate.textContent) === key,
      );
      if (!button || button.disabled) return;
      button.click();
      await nextPaint();
      syncFromEngine();
    },
    [getEngine, syncFromEngine],
  );

  const clearEngineAmount = useCallback(async () => {
    const button = getEngine()?.querySelector<HTMLButtonElement>("[data-pos-keypad-clear]");
    if (!button || button.disabled) return;
    button.click();
    await nextPaint();
    syncFromEngine();
  }, [getEngine, syncFromEngine]);

  const replayAmount = useCallback(
    async (value: string) => {
      const input = moneyInputFromCurrentLabel(value).replace(/[^0-9./]/g, "");
      for (const key of input) await pressEngineKey(key);
    },
    [pressEngineKey],
  );

  const focusReceiptLine = useCallback(
    async (index: number) => {
      const rows = getEngine()?.querySelectorAll<HTMLElement>("[data-pos-receipt-line]");
      const row = rows?.item(index);
      const button = row?.querySelector<HTMLButtonElement>("[data-pos-receipt-line-item]");
      if (!button) return false;
      button.click();
      await nextPaint();
      syncFromEngine();
      return true;
    },
    [getEngine, syncFromEngine],
  );

  const chooseStaffForNewService = useCallback(
    async (member: PosDeskStaff) => {
      if (!pendingService || isUnavailable(member)) return;
      setNotice(null);
      if (!clickStaff(member)) {
        setNotice("This staff member is not available for the current ticket.");
        return;
      }
      await nextPaint();
      const applied = await applyService(pendingService);
      if (!applied) {
        setNotice("Unable to select this service. Try again.");
        return;
      }
      setStage("amount");
      await nextPaint();
      syncFromEngine();
    },
    [applyService, clickStaff, pendingService, syncFromEngine],
  );

  const chooseEditedService = useCallback(
    async (service: PosDeskService) => {
      if (editingLineIndex === null) return;
      const focused = await focusReceiptLine(editingLineIndex);
      if (!focused) return;
      const originalInput = currentInput;
      await clearEngineAmount();
      if (!(await applyService(service))) {
        setNotice("Unable to change this service.");
        return;
      }
      await replayAmount(originalInput);
      setServiceQuery("");
      setStage("receipt");
      await nextPaint();
      syncFromEngine();
    },
    [applyService, clearEngineAmount, currentInput, editingLineIndex, focusReceiptLine, replayAmount, syncFromEngine],
  );

  const chooseEditedStaff = useCallback(
    async (member: PosDeskStaff) => {
      if (editingLineIndex === null || isUnavailable(member)) return;
      const duplicate = receiptLines.some(
        (line) => line.index !== editingLineIndex && line.staff === member.display_name,
      );
      if (duplicate) {
        setNotice(
          "This technician already has another line on the draft. Keep the current assignment or edit that line first.",
        );
        return;
      }

      const focused = await focusReceiptLine(editingLineIndex);
      if (!focused) return;
      const originalInput = currentInput;
      await clearEngineAmount();
      if (!clickStaff(member)) {
        setNotice("Unable to change technician.");
        return;
      }
      await nextPaint();
      await replayAmount(originalInput);
      setStage("receipt");
      await nextPaint();
      syncFromEngine();
    },
    [clearEngineAmount, clickStaff, currentInput, editingLineIndex, focusReceiptLine, receiptLines, replayAmount, syncFromEngine],
  );

  const removeReceiptLine = useCallback(
    (index: number) => {
      const row = getEngine()?.querySelectorAll<HTMLElement>("[data-pos-receipt-line]").item(index);
      row?.querySelector<HTMLButtonElement>("[data-pos-receipt-line-remove]")?.click();
      window.setTimeout(syncFromEngine, 0);
    },
    [getEngine, syncFromEngine],
  );

  const submitReceipt = useCallback(() => {
    const amountPanel = getEngine()?.querySelector<HTMLElement>("[data-pos-amount-panel]");
    const submit = Array.from(amountPanel?.querySelectorAll<HTMLButtonElement>("button") ?? []).find(
      (button) => ["Submit", "Submitting"].includes(normalizedText(button.textContent)),
    );
    if (submit && !submit.disabled) {
      setStage(null);
      submit.click();
    }
  }, [getEngine]);

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
          syncFromEngine();
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
        <div className="fixed inset-0 z-[85] flex items-end bg-zinc-950/35" role="presentation">
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
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
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
            </div>

            {notice ? (
              <div className="mx-4 mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
                {notice}
              </div>
            ) : null}

            {stage === "staff" || stage === "staff-edit" ? (
              <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                {sortedStaff.map((member) => {
                  const unavailable = isUnavailable(member);
                  const alreadyUsed =
                    stage === "staff-edit" &&
                    receiptLines.some(
                      (line) =>
                        line.index !== editingLineIndex && line.staff === member.display_name,
                    );
                  return (
                    <button
                      className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 text-left shadow-sm transition active:scale-[0.99] disabled:opacity-40"
                      disabled={unavailable || alreadyUsed}
                      key={member.id}
                      onClick={() =>
                        stage === "staff"
                          ? void chooseStaffForNewService(member)
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
                        {getTurn(member)}
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
                        onClick={() => void pressEngineKey(key)}
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
                    onClick={() => void pressEngineKey("Back")}
                    type="button"
                  >
                    Back
                  </button>
                  <button
                    className="min-h-12 rounded-2xl border border-zinc-200 bg-white font-bold text-zinc-700"
                    onClick={() => void clearEngineAmount()}
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
                      window.setTimeout(syncFromEngine, 0);
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
                                void focusReceiptLine(line.index).then(() => setStage("amount"));
                              }}
                              type="button"
                            >
                              {line.price}
                            </button>
                            <button
                              aria-label={`Remove ${line.service}`}
                              className="grid h-9 w-9 place-items-center rounded-full text-lg font-bold text-red-600"
                              onClick={() => removeReceiptLine(line.index)}
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
                <div className="grid shrink-0 grid-cols-[1fr_auto] items-center gap-3 border-t border-zinc-200 bg-white px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                  <div>
                    <p className="text-[11px] font-bold uppercase text-zinc-500">Total</p>
                    <p className="text-2xl font-black tabular-nums text-zinc-950">{total}</p>
                  </div>
                  <button
                    className="min-h-12 rounded-2xl bg-brand-orange px-6 font-black text-white shadow-lg disabled:opacity-40"
                    disabled={receiptLines.length === 0}
                    onClick={submitReceipt}
                    type="button"
                  >
                    Checkout
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}

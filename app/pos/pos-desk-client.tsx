"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { parsePosAmountInput } from "@/lib/pos-desk-amounts";
import {
  createPosDeskCustomer,
  getPosLiveDraft,
  searchPosDeskCustomers,
  submitPosDeskReceipt,
  updatePosActiveDraft,
  updatePosLiveDraftCustomer,
} from "@/app/pos/actions";
import type {
  PosDeskCustomer,
  PosDeskSessionLine,
  PosDeskSessionView,
  PosDeskService,
  PosDeskStaff,
  PosLiveDraftCustomer,
  PosLiveDraftView,
} from "@/types/pos-desk";

type PosDeskDefaults = {
  adsFooter: string;
  largeTurnThreshold: number;
  showServiceName: boolean;
  showStaffName: boolean;
  taxEnabled: boolean;
};

type DraftState = {
  amountInput: string;
  customerId: string | null;
  customerLookup: string;
  customerName: string;
  discountInput: string;
  discountType: "fixed_amount" | "percentage";
  editingLineId: string | null;
  giftCardInput: string;
  note: string;
  selectedServiceId: string | null;
  selectedStaffId: string | null;
  tipInput: string;
};

type KeypadMode =
  | "amount"
  | "customer_create_phone"
  | "customer_search"
  | "discount"
  | "gift_card"
  | "tip";

type CustomerCreateDraft = {
  email: string;
  name: string;
  phone: string;
};

type CustomerCreateField = "email" | "name" | "phone";

const emptyDraft: DraftState = {
  amountInput: "",
  customerId: null,
  customerLookup: "",
  customerName: "",
  discountInput: "",
  discountType: "fixed_amount",
  editingLineId: null,
  giftCardInput: "",
  note: "",
  selectedServiceId: null,
  selectedStaffId: null,
  tipInput: "",
};

const emptyCustomerCreateDraft: CustomerCreateDraft = {
  email: "",
  name: "",
  phone: "",
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount);
}

function normalizeKeypadInput(current: string, key: string) {
  if (key === "." && current.split("/").at(-1)?.includes(".")) {
    return current;
  }

  if (key === "/" && (!current || current.endsWith("/"))) {
    return current;
  }

  return `${current}${key}`;
}

function getFirstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function getCustomerCreateDraftFromLookup(lookup: string): CustomerCreateDraft {
  const trimmed = lookup.trim();
  const looksLikeEmail = trimmed.includes("@");
  const looksLikePhone = /[0-9]/.test(trimmed) && !looksLikeEmail;

  return {
    email: looksLikeEmail ? trimmed : "",
    name: looksLikePhone || looksLikeEmail ? "" : trimmed,
    phone: looksLikePhone ? trimmed : "",
  };
}

function getDigitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function isCompleteUsPhone(value: string) {
  const digits = getDigitsOnly(value);
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

function canOfferCustomerCreate(value: string) {
  const trimmed = value.trim();
  return isCompleteUsPhone(trimmed) || trimmed.length >= 6;
}

function getStaffCardColor(largeTurns: number, smallTurns: number, selected: boolean) {
  if (selected) {
    return "border-emerald-700 bg-emerald-50 text-zinc-950 ring-2 ring-emerald-600";
  }

  const heat = Math.min(6, largeTurns * 2 + smallTurns);

  if (heat <= 1) {
    return "border-zinc-200 bg-zinc-50 text-zinc-950";
  }

  if (heat <= 3) {
    return "border-amber-200 bg-amber-50 text-zinc-950";
  }

  if (heat <= 5) {
    return "border-orange-300 bg-orange-100 text-zinc-950";
  }

  return "border-red-400 bg-red-700 text-white";
}

function hasPositiveAmount(line: PosDeskSessionLine) {
  return line.amount > 0;
}

function ReceiptClock() {
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    function updateClock() {
      setCurrentTime(new Date().toLocaleString());
    }

    const timeoutId = window.setTimeout(updateClock, 0);
    const intervalId = window.setInterval(updateClock, 1000);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, []);

  return <p className="text-sm text-zinc-600">{currentTime}</p>;
}

function liveLineToSessionLine(
  line: PosLiveDraftView["staff_lines"][number],
  index: number,
): PosDeskSessionLine {
  return {
    amount: line.amount,
    amount_input: line.amountInput ?? (line.amount > 0 ? String(line.amount) : ""),
    amount_parts: line.amountParts ?? [],
    id: line.id,
    service_id: line.serviceId ?? null,
    service_label: line.label || `Service ${index + 1}`,
    sort_order: line.sortOrder ?? index + 1,
    staff_id: line.staffId,
    staff_name: line.staffName,
    turn_large_count: 0,
    turn_small_count: 0,
  };
}

export function PosDeskClient({
  activeSession,
  defaults,
  liveDraft,
  salonName,
  services,
  staff,
}: {
  activeSession: PosDeskSessionView | null;
  defaults: PosDeskDefaults;
  liveDraft: PosLiveDraftView | null;
  salonName: string;
  services: PosDeskService[];
  staff: PosDeskStaff[];
}) {
  const [draftStaffLines, setDraftStaffLines] = useState<PosDeskSessionLine[]>(
    liveDraft?.staff_lines.map(liveLineToSessionLine) ?? activeSession?.lines ?? [],
  );
  const initialSelectedLine =
    draftStaffLines.find((line) => line.staff_id === liveDraft?.selected_staff_id) ??
    null;
  const [draft, setDraft] = useState<DraftState>({
    ...emptyDraft,
    amountInput: initialSelectedLine?.amount_input ?? "",
    customerId: liveDraft?.customer?.id ?? null,
    customerLookup: liveDraft?.customer?.phone ?? "",
    customerName: liveDraft?.customer?.name ?? "",
    editingLineId: initialSelectedLine?.id ?? null,
    selectedServiceId: initialSelectedLine?.service_id ?? null,
    selectedStaffId: liveDraft?.selected_staff_id ?? null,
    tipInput: liveDraft?.tip ? String(liveDraft.tip) : "",
  });
  const [customerCreateDraft, setCustomerCreateDraft] =
    useState<CustomerCreateDraft>(emptyCustomerCreateDraft);
  const [customerCreateField, setCustomerCreateField] =
    useState<CustomerCreateField>("name");
  const [customerResults, setCustomerResults] = useState<PosDeskCustomer[]>([]);
  const [customerSearchComplete, setCustomerSearchComplete] = useState(false);
  const [keypadMode, setKeypadMode] = useState<KeypadMode>("amount");
  const [serviceSearch, setServiceSearch] = useState("");
  const [showCustomerCreateModal, setShowCustomerCreateModal] = useState(false);
  const [showServicePicker, setShowServicePicker] = useState(false);
  const [liveCustomer, setLiveCustomer] = useState<PosLiveDraftCustomer | null>(
    liveDraft?.customer ?? null,
  );
  const [draftRestored, setDraftRestored] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setLastAction] = useState("Ready");
  const [isPending, startTransition] = useTransition();
  const liveDraftVersionRef = useRef(liveDraft?.version ?? 0);
  const receiptLocked = false;
  const liveDraftToken = liveDraft?.token;

  const selectedStaff = staff.find((member) => member.id === draft.selectedStaffId);
  const selectedService = services.find(
    (service) => service.id === draft.selectedServiceId,
  );
  const selectedCustomer = liveCustomer;
  const tipAmount = Number(draft.tipInput || 0);
  const discountAmount = Number(draft.discountInput || 0);
  const staffLines = draftStaffLines;
  const sortedStaff = useMemo(
    () =>
      [...staff].sort(
        (left, right) =>
          left.turns.largeTurns - right.turns.largeTurns ||
          left.turns.smallTurns - right.turns.smallTurns ||
          left.display_name.localeCompare(right.display_name),
      ),
    [staff],
  );
  const totalLines = useMemo(
    () => staffLines.map((line) => ({ line_total: line.amount })),
    [staffLines],
  );
  const filteredServices = useMemo(() => {
    const query = serviceSearch.trim().toLowerCase();

    if (!query) {
      return services;
    }

    return services.filter((service) =>
      service.name.toLowerCase().includes(query),
    );
  }, [serviceSearch, services]);
  const totals = useMemo(
    () =>
      calculateTicketTotals({
        discountType: draft.discountType,
        discountValue:
          Number.isFinite(discountAmount) && discountAmount > 0
            ? discountAmount
            : 0,
        items: totalLines,
        tipType: "fixed_amount",
        tipValue: Number.isFinite(tipAmount) && tipAmount > 0 ? tipAmount : 0,
      }),
    [discountAmount, draft.discountType, tipAmount, totalLines],
  );
  const keypadDisplay =
    keypadMode === "customer_search"
      ? draft.customerLookup || "Phone search"
      : keypadMode === "customer_create_phone"
        ? customerCreateDraft.phone || "New phone"
        : keypadMode === "tip"
          ? draft.tipInput || "Tip"
          : keypadMode === "discount"
            ? draft.discountInput || "Discount"
            : keypadMode === "gift_card"
              ? "Gift card later"
              : draft.amountInput || "0";
  const liveStaffLines = useMemo<PosLiveDraftView["staff_lines"]>(
    () =>
      staffLines.map((line, index) => ({
        amount: line.amount,
        amountInput: line.amount_input,
        amountParts: line.amount_parts,
        id: line.id,
        label: line.service_label || `Service ${index + 1}`,
        serviceId: line.service_id,
        sortOrder: line.sort_order,
        staffId: line.staff_id,
        staffName: line.staff_name ?? "Assigned staff",
      })),
    [staffLines],
  );

  const updateDraft = useCallback((next: Partial<DraftState>) => {
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
  }, []);

  const publishCustomerToLiveDraft = useCallback(
    (customer: PosLiveDraftCustomer | null) => {
      setLiveCustomer(customer);

      if (!liveDraftToken) {
        return;
      }

      startTransition(async () => {
        const result = await updatePosLiveDraftCustomer({
          customer,
          token: liveDraftToken,
        });

        if (!result.ok) {
          setError(result.error);
          setLastAction("Customer sync failed");
          return;
        }

        liveDraftVersionRef.current = result.data.version;
      });
    },
    [liveDraftToken, startTransition],
  );

  const saveCustomerToSession = useCallback(
    (customer?: PosDeskCustomer) => {
      if (receiptLocked) {
        setError("Receipt is waiting for customer confirmation.");
        setLastAction("Customer save blocked");
        return;
      }

      const nextCustomer = customer
        ? {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
          }
        : draft.customerName.trim() || draft.customerLookup.trim()
          ? {
              id: null,
              name: draft.customerName.trim() || draft.customerLookup.trim(),
              phone: draft.customerLookup.trim() || null,
            }
          : null;

      if (customer) {
        updateDraft({
          customerId: customer.id,
          customerLookup: customer.phone ?? customer.email ?? customer.name,
          customerName: customer.name,
        });
        setCustomerResults([]);
        setCustomerSearchComplete(false);
      }

      if (nextCustomer) {
        publishCustomerToLiveDraft(nextCustomer);
      }
      setMessage("Customer saved locally.");
      setLastAction("Customer saved locally");
    },
    [
      draft.customerLookup,
      draft.customerName,
      publishCustomerToLiveDraft,
      receiptLocked,
      updateDraft,
    ],
  );

  useEffect(() => {
    if (!liveDraftToken) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void updatePosActiveDraft({
        selectedStaffId: draft.selectedStaffId,
        staffLines: liveStaffLines,
        subtotal: totals.subtotal,
        tip: totals.tip_amount,
        token: liveDraftToken,
        total: totals.total,
      }).then((result) => {
        if (!result.ok) {
          setError(result.error);
          setLastAction("Live draft sync failed");
          return;
        }

        liveDraftVersionRef.current = result.data.version;
      });
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [
    draft.selectedStaffId,
    liveDraftToken,
    liveStaffLines,
    totals.subtotal,
    totals.tip_amount,
    totals.total,
  ]);

  useEffect(() => {
    if (selectedCustomer || receiptLocked) {
      return;
    }

    const lookup = draft.customerLookup.trim();

    if (lookup.length < 2) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      startTransition(async () => {
        try {
          const results = await searchPosDeskCustomers(lookup);

          if (cancelled) {
            return;
          }

          setCustomerResults(results);
          setCustomerSearchComplete(true);

          if (results.length === 0 && isCompleteUsPhone(lookup)) {
            setCustomerCreateDraft(getCustomerCreateDraftFromLookup(lookup));
            setCustomerCreateField("phone");
            setKeypadMode("customer_create_phone");
            setShowCustomerCreateModal(true);
            setLastAction("Customer create opened");
          }
        } catch (error) {
          if (!cancelled) {
            setError(
              error instanceof Error ? error.message : "Unable to search customer.",
            );
            setCustomerSearchComplete(true);
            setLastAction("Customer search failed");
          }
        }
      });
    }, 650);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [draft.customerLookup, receiptLocked, selectedCustomer]);

  useEffect(() => {
    if (!liveDraftToken) {
      return;
    }

    let isMounted = true;
    const intervalId = window.setInterval(() => {
      void getPosLiveDraft(liveDraftToken).then((result) => {
        if (!isMounted || !result.ok || !result.data) {
          return;
        }

        if (result.data.version <= liveDraftVersionRef.current) {
          return;
        }

        liveDraftVersionRef.current = result.data.version;
        setLiveCustomer(result.data.customer);

        if (result.data.customer) {
          setDraft((current) => ({
            ...current,
            customerId: result.data?.customer?.id ?? current.customerId,
            customerLookup: result.data?.customer?.phone ?? current.customerLookup,
            customerName: result.data?.customer?.name ?? current.customerName,
          }));
          setLastAction("Customer synced from display");
        }
      });
    }, 1500);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [liveDraftToken]);

  function createStaffLine(
    staffId: string,
    sortOrder: number,
    serviceId: string | null = null,
  ): PosDeskSessionLine {
    const staffMember = staff.find((member) => member.id === staffId);
    const service = services.find((item) => item.id === serviceId);

    return {
      amount: 0,
      amount_input: "",
      amount_parts: [],
      id: `local-${crypto.randomUUID()}`,
      service_id: serviceId,
      service_label: service?.name ?? `Service ${sortOrder}`,
      sort_order: sortOrder,
      staff_id: staffId,
      staff_name: staffMember?.display_name ?? null,
      turn_large_count: 0,
      turn_small_count: 0,
    };
  }

  function getActiveLine(lines = staffLines) {
    return lines.find((line) => line.id === draft.editingLineId) ?? null;
  }

  function getStaffLine(staffId: string, lines = staffLines) {
    return lines.find((line) => line.staff_id === staffId) ?? null;
  }

  function focusLine(line: PosDeskSessionLine) {
    setDraft((current) => ({
      ...current,
      amountInput: line.amount_input,
      editingLineId: line.id,
      selectedServiceId: line.service_id,
      selectedStaffId: line.staff_id,
    }));
    setKeypadMode("amount");
    setError(null);
  }

  function selectStaff(staffId: string) {
    const existingStaffLine = getStaffLine(staffId);
    const activeLine = getActiveLine();

    if (activeLine && !hasPositiveAmount(activeLine)) {
      if (existingStaffLine && existingStaffLine.id !== activeLine.id) {
        setDraftStaffLines((current) =>
          current.filter((line) => line.id !== activeLine.id),
        );
        focusLine(existingStaffLine);
        setLastAction("Empty staff line removed");
        return;
      }

      if (existingStaffLine) {
        focusLine(existingStaffLine);
        setLastAction("Existing staff line selected");
        return;
      }

      const staffMember = staff.find((member) => member.id === staffId);
      const replacementLine = {
        ...activeLine,
        staff_id: staffId,
        staff_name: staffMember?.display_name ?? null,
      };

      setDraftStaffLines((current) =>
        current.map((line) => (line.id === activeLine.id ? replacementLine : line)),
      );
      focusLine(replacementLine);
      setLastAction("Empty staff line replaced");
      return;
    }

    if (existingStaffLine) {
      focusLine(existingStaffLine);
      setLastAction("Existing staff line selected");
      return;
    }

    const nextLine = createStaffLine(
      staffId,
      staffLines.length + 1,
      activeLine ? null : draft.selectedServiceId,
    );
    setDraftStaffLines((current) => [...current, nextLine]);
    focusLine(nextLine);
    setLastAction("Staff line selected");
  }

  function editLine(line: PosDeskSessionLine) {
    updateDraft({
      amountInput: line.amount_input,
      editingLineId: line.id,
      selectedServiceId: line.service_id,
      selectedStaffId: line.staff_id,
    });
    setKeypadMode("amount");
  }

  function removeLine(lineId: string) {
    if (receiptLocked) {
      setError("Receipt is waiting for customer confirmation.");
      setLastAction("Edit blocked");
      return;
    }

    const nextLines = staffLines.filter((line) => line.id !== lineId);
    setDraftStaffLines(nextLines);
    setMessage("Receipt line removed.");
    setLastAction("Line removed");
    setDraft((current) => ({
      ...current,
      amountInput: current.editingLineId === lineId ? "" : current.amountInput,
      editingLineId:
        current.editingLineId === lineId ? null : current.editingLineId,
      selectedStaffId:
        current.editingLineId === lineId ? null : current.selectedStaffId,
    }));
  }

  function updateSelectedStaffAmount(amountInput: string) {
    if (!draft.editingLineId) {
      setError("Select staff before entering an amount.");
      setLastAction("Amount blocked");
      return;
    }

    setDraft((current) => ({
      ...current,
      amountInput,
    }));
    setError(null);

    setDraftStaffLines((current) =>
      current.map((line) => {
        if (line.id !== draft.editingLineId) {
          return line;
        }

        if (!amountInput.trim()) {
          return {
            ...line,
            amount: 0,
            amount_input: "",
            amount_parts: [],
            turn_large_count: 0,
            turn_small_count: 0,
          };
        }

        const parsedAmount = parsePosAmountInput(amountInput);

        if (!parsedAmount.isValid) {
          return {
            ...line,
            amount_input: amountInput,
          };
        }

        const turnLargeCount = parsedAmount.parts.filter(
          (part) => part >= defaults.largeTurnThreshold,
        ).length;

        return {
          ...line,
          amount: parsedAmount.total,
          amount_input: amountInput,
          amount_parts: parsedAmount.parts,
          turn_large_count: turnLargeCount,
          turn_small_count: parsedAmount.parts.length - turnLargeCount,
        };
      }),
    );
    setLastAction("Line amount synced");
  }

  function selectService(serviceId: string | null) {
    const service = services.find((item) => item.id === serviceId);

    if (!draft.editingLineId && !draft.selectedStaffId) {
      updateDraft({ selectedServiceId: serviceId });
      setShowServicePicker(false);
      setServiceSearch("");
      setKeypadMode("amount");
      return;
    }

    const activeLine = getActiveLine();
    const lineToUpdate =
      activeLine ??
      (draft.selectedStaffId
        ? createStaffLine(draft.selectedStaffId, staffLines.length + 1, serviceId)
        : null);

    if (!lineToUpdate) {
      return;
    }

    const updatedLine = {
      ...lineToUpdate,
      service_id: serviceId,
      service_label: service?.name ?? `Service ${lineToUpdate.sort_order}`,
    };

    setDraftStaffLines((current) => {
      if (current.some((line) => line.id === updatedLine.id)) {
        return current.map((line) =>
          line.id === updatedLine.id ? updatedLine : line,
        );
      }

      return [...current, updatedLine];
    });
    updateDraft({
      amountInput: updatedLine.amount_input,
      editingLineId: updatedLine.id,
      selectedServiceId: serviceId,
      selectedStaffId: updatedLine.staff_id,
    });
    setShowServicePicker(false);
    setServiceSearch("");
    setKeypadMode("amount");
  }

  function appendNumericInput(current: string, key: string) {
    if (key === "/" || (key === "." && current.includes("."))) {
      return current;
    }

    return `${current}${key}`;
  }

  function handleKeypadKey(key: string) {
    if (keypadMode === "customer_search") {
      if (/^\d$/.test(key)) {
        setCustomerResults([]);
        setCustomerSearchComplete(false);
        updateDraft({
          customerId: null,
          customerLookup: `${draft.customerLookup}${key}`,
        });
      }
      return;
    }

    if (keypadMode === "customer_create_phone") {
      if (/^\d$/.test(key)) {
        setCustomerCreateDraft((current) => ({
          ...current,
          phone: `${current.phone}${key}`,
        }));
      }
      return;
    }

    if (keypadMode === "tip") {
      if (key !== "/") {
        updateDraft({ tipInput: appendNumericInput(draft.tipInput, key) });
      }
      return;
    }

    if (keypadMode === "discount") {
      if (key !== "/") {
        updateDraft({
          discountInput: appendNumericInput(draft.discountInput, key),
        });
      }
      return;
    }

    if (keypadMode === "gift_card") {
      return;
    }

    updateSelectedStaffAmount(normalizeKeypadInput(draft.amountInput, key));
  }

  function handleKeypadBack() {
    if (keypadMode === "customer_search") {
      setCustomerResults([]);
      setCustomerSearchComplete(false);
      updateDraft({ customerLookup: draft.customerLookup.slice(0, -1) });
      return;
    }

    if (keypadMode === "customer_create_phone") {
      setCustomerCreateDraft((current) => ({
        ...current,
        phone: current.phone.slice(0, -1),
      }));
      return;
    }

    if (keypadMode === "tip") {
      updateDraft({ tipInput: draft.tipInput.slice(0, -1) });
      return;
    }

    if (keypadMode === "discount") {
      updateDraft({ discountInput: draft.discountInput.slice(0, -1) });
      return;
    }

    updateSelectedStaffAmount(draft.amountInput.slice(0, -1));
  }

  function handleKeypadClear() {
    if (keypadMode === "customer_search") {
      setCustomerResults([]);
      setCustomerSearchComplete(false);
      updateDraft({ customerId: null, customerLookup: "" });
      return;
    }

    if (keypadMode === "customer_create_phone") {
      setCustomerCreateDraft((current) => ({ ...current, phone: "" }));
      return;
    }

    if (keypadMode === "tip") {
      updateDraft({ tipInput: "" });
      saveTipToSession("");
      return;
    }

    if (keypadMode === "discount") {
      updateDraft({ discountInput: "" });
      return;
    }

    updateSelectedStaffAmount("");
  }

  function clearDraft() {
    setDraft(emptyDraft);
    setDraftStaffLines([]);
    setDraftRestored(false);
    setError(null);
    setMessage(null);
  }

  function submitReceipt() {
    const positiveLines = staffLines.filter(hasPositiveAmount);

    if (positiveLines.length === 0) {
      setDraftStaffLines([]);
      updateDraft({
        amountInput: "",
        editingLineId: null,
        selectedStaffId: null,
      });
      setError("Add at least one service amount before submit.");
      setLastAction("Submit blocked");
      return;
    }

    if (positiveLines.length !== staffLines.length) {
      setDraftStaffLines(positiveLines);
      if (!positiveLines.some((line) => line.id === draft.editingLineId)) {
        const firstLine = positiveLines[0];
        updateDraft({
          amountInput: firstLine.amount_input,
          editingLineId: firstLine.id,
          selectedServiceId: firstLine.service_id,
          selectedStaffId: firstLine.staff_id,
        });
      }
    }

    const submitLines = positiveLines.map((line, index) => ({
      amountInput: line.amount_input,
      amountParts: line.amount_parts,
      serviceId: line.service_id,
      serviceLabel: line.service_label || `Service ${index + 1}`,
      staffId: line.staff_id,
      total: line.amount,
    }));

    startTransition(async () => {
      setError(null);
      const result = await submitPosDeskReceipt({
        customerId: draft.customerId ?? selectedCustomer?.id,
        customerLookup: draft.customerLookup || selectedCustomer?.phone,
        customerName: draft.customerName || selectedCustomer?.name,
        discountType: draft.discountType,
        discountValue: totals.discount_value,
        lines: submitLines,
        note: draft.note,
        tipAmount: totals.tip_value,
      });

      if (!result.ok) {
        setError(result.error);
        setLastAction("Submit failed");
        return;
      }

      clearDraft();
      publishCustomerToLiveDraft(null);
      setMessage(`Ticket ${result.ticketNumber} submitted.`);
      setLastAction("Receipt submitted");
    });
  }

  function cancelActiveSession() {
    clearDraft();
    setLastAction("Local receipt reset");
  }

  function clearSelectedCustomer() {
    updateDraft({
      customerId: null,
      customerLookup: "",
      customerName: "",
    });
    setCustomerResults([]);
    setCustomerSearchComplete(false);
    setShowCustomerCreateModal(false);
    publishCustomerToLiveDraft(null);
    setMessage("Customer cleared.");
    setLastAction("Customer cleared");
  }

  function openCustomerCreateFromLookup() {
    setCustomerCreateDraft(getCustomerCreateDraftFromLookup(draft.customerLookup));
    setCustomerCreateField(isCompleteUsPhone(draft.customerLookup) ? "phone" : "name");
    setKeypadMode(
      isCompleteUsPhone(draft.customerLookup) ? "customer_create_phone" : "amount",
    );
    setShowCustomerCreateModal(true);
    setLastAction("Customer create opened");
  }

  function createCustomerFromModal() {
    const name = customerCreateDraft.name.trim();

    if (!name) {
      setError("Customer name is required.");
      setLastAction("Customer create blocked");
      return;
    }

    startTransition(async () => {
      const result = await createPosDeskCustomer({
        email: customerCreateDraft.email,
        name,
        phone: customerCreateDraft.phone,
      });

      if (!result.ok) {
        setError(result.error);
        setLastAction("Customer create failed");
        return;
      }

      setShowCustomerCreateModal(false);
      setCustomerCreateDraft(emptyCustomerCreateDraft);
      saveCustomerToSession(result.data);
      setMessage("Customer created.");
      setLastAction("Customer created");
    });
  }

  function saveTipToSession(value: string) {
    const nextTip = Number(value || 0);

    if (!Number.isFinite(nextTip) || nextTip < 0) {
      setError("Tip must be zero or greater.");
      setLastAction("Tip save blocked");
      return;
    }

    if (receiptLocked) {
      setError("Customer is choosing the final tip.");
      setLastAction("Tip save blocked");
      return;
    }

    setMessage("Tip saved locally.");
    setLastAction("Tip saved locally");
  }

  function updateCustomerCreateField(value: string) {
    setCustomerCreateDraft((current) => ({
      ...current,
      [customerCreateField]: value,
    }));
  }

  function appendCustomerCreateText(value: string) {
    setCustomerCreateDraft((current) => ({
      ...current,
      [customerCreateField]: `${current[customerCreateField]}${value}`,
    }));
  }

  function backspaceCustomerCreateText() {
    setCustomerCreateDraft((current) => ({
      ...current,
      [customerCreateField]: current[customerCreateField].slice(0, -1),
    }));
  }

  function clearCustomerCreateText() {
    updateCustomerCreateField("");
  }

  function renderCustomerCreateKeyboard() {
    const letterKeys = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const numberKeys = "1234567890".split("");
    const symbolKeys = ["@", ".", "-", "_"];
    const keys =
      customerCreateField === "phone"
        ? numberKeys
        : customerCreateField === "email"
          ? [...letterKeys, ...numberKeys, ...symbolKeys]
          : letterKeys;

    return (
      <div className="mt-4 rounded border border-zinc-200 bg-zinc-50 p-3">
        {customerCreateField === "email" ? (
          <div className="mb-3 grid grid-cols-2 gap-2">
            {["@gmail.com", "@yahoo.com", "@icloud.com", ".com"].map((suffix) => (
              <button
                className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium"
                key={suffix}
                onClick={() => appendCustomerCreateText(suffix)}
                type="button"
              >
                {suffix}
              </button>
            ))}
          </div>
        ) : null}
        <div
          className={
            customerCreateField === "phone"
              ? "grid grid-cols-3 gap-2"
              : "grid grid-cols-6 gap-2"
          }
        >
          {keys.map((key) => (
            <button
              className="min-h-10 rounded bg-white px-2 text-sm font-semibold shadow-sm"
              key={key}
              onClick={() => appendCustomerCreateText(key)}
              type="button"
            >
              {key}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {customerCreateField === "name" ? (
            <button
              className="min-h-10 rounded border border-zinc-300 bg-white text-sm font-medium"
              onClick={() => appendCustomerCreateText(" ")}
              type="button"
            >
              Space
            </button>
          ) : (
            <span />
          )}
          <button
            className="min-h-10 rounded border border-zinc-300 bg-white text-sm font-medium"
            onClick={backspaceCustomerCreateText}
            type="button"
          >
            Backspace
          </button>
          <button
            className="min-h-10 rounded border border-zinc-300 bg-white text-sm font-medium"
            onClick={clearCustomerCreateText}
            type="button"
          >
            Clear
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {showCustomerCreateModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-lg border border-zinc-200 bg-white p-4 shadow-xl">
            <div className="mb-3">
              <h2 className="text-lg font-semibold">New Customer</h2>
              <p className="text-sm text-zinc-600">No matching customer found.</p>
            </div>
            <div className="space-y-3">
              <label className="block text-sm font-medium">
                Name
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-3 py-2"
                  onChange={(event) =>
                    setCustomerCreateDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  onFocus={() => {
                    setCustomerCreateField("name");
                    setKeypadMode("amount");
                  }}
                  value={customerCreateDraft.name}
                />
              </label>
              <label className="block text-sm font-medium">
                Phone
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-3 py-2"
                  onChange={(event) =>
                    setCustomerCreateDraft((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                  inputMode="tel"
                  onFocus={() => {
                    setCustomerCreateField("phone");
                    setKeypadMode("customer_create_phone");
                  }}
                  value={customerCreateDraft.phone}
                />
              </label>
              <label className="block text-sm font-medium">
                Email
                <input
                  className="mt-1 w-full rounded border border-zinc-300 px-3 py-2"
                  onChange={(event) =>
                    setCustomerCreateDraft((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  onFocus={() => {
                    setCustomerCreateField("email");
                    setKeypadMode("amount");
                  }}
                  type="email"
                  value={customerCreateDraft.email}
                />
              </label>
              {renderCustomerCreateKeyboard()}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium"
                onClick={() => setShowCustomerCreateModal(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded bg-zinc-950 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                disabled={isPending}
                onClick={createCustomerFromModal}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showServicePicker ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/40 px-4">
          <div className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-lg border border-zinc-200 bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Select Service</h2>
              <button
                className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium"
                onClick={() => setShowServicePicker(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <input
              className="mb-3 w-full rounded border border-zinc-300 px-4 py-3 text-lg"
              onChange={(event) => setServiceSearch(event.target.value)}
              placeholder="Search services"
              value={serviceSearch}
            />
            <div className="grid max-h-[58vh] grid-cols-1 gap-2 overflow-auto sm:grid-cols-2">
              <button
                className="min-h-16 rounded border border-zinc-300 bg-zinc-50 px-4 py-3 text-left font-semibold"
                onClick={() => selectService(null)}
                type="button"
              >
                No catalog service
              </button>
              {filteredServices.map((service) => (
                <button
                  className="min-h-16 rounded border border-zinc-200 bg-white px-4 py-3 text-left hover:bg-zinc-50"
                  key={service.id}
                  onClick={() => selectService(service.id)}
                  type="button"
                >
                  <span className="block font-semibold">{service.name}</span>
                  {service.category ? (
                    <span className="mt-1 block text-sm text-zinc-500">
                      {service.category}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid min-h-[calc(100vh-120px)] grid-cols-1 gap-4 xl:grid-cols-[380px_minmax(360px,1fr)_360px]">
      <section className="rounded-lg border border-zinc-300 bg-white p-4">
        <div className="border-b border-zinc-200 pb-3">
          <div>
            <p className="text-lg font-semibold">{salonName}</p>
            <ReceiptClock />
          </div>
          {!liveDraft ? (
            <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Live draft is unavailable. Local POS still works.
            </p>
          ) : null}
        </div>

        <div className="space-y-3 border-b border-zinc-200 py-3">
          <label className="block text-sm font-medium">Customer</label>
          {selectedCustomer ? (
            <div className="flex items-center justify-between gap-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-950">
                  {selectedCustomer.name}
                </p>
                {selectedCustomer.phone ? (
                  <p className="truncate text-xs text-zinc-600">
                    {selectedCustomer.phone}
                  </p>
                ) : null}
              </div>
              <button
                className="shrink-0 rounded border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800"
                disabled={receiptLocked}
                onClick={clearSelectedCustomer}
                type="button"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="relative">
              <input
                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                disabled={receiptLocked}
                onChange={(event) => {
                  setCustomerResults([]);
                  setCustomerSearchComplete(false);
                  updateDraft({
                    customerId: null,
                    customerLookup: event.target.value,
                  });
                }}
                onFocus={() => setKeypadMode("customer_search")}
                placeholder="Phone, email, account, name"
                value={draft.customerLookup}
              />
              {draft.customerLookup.trim().length >= 2 ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded border border-zinc-200 bg-white shadow-lg">
                  {customerResults.length > 0 ? (
                    customerResults.map((customer) => (
                      <button
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                        key={customer.id}
                        onClick={() => saveCustomerToSession(customer)}
                        type="button"
                      >
                        <span className="block font-medium">{customer.name}</span>
                        {customer.phone ? (
                          <span className="block text-xs text-zinc-500">
                            {customer.phone}
                          </span>
                        ) : null}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-zinc-500">
                      {customerSearchComplete ? "No match yet" : "Searching"}
                    </div>
                  )}
                  {canOfferCustomerCreate(draft.customerLookup) ? (
                    <button
                      className="block w-full border-t border-zinc-200 px-3 py-2 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                      onClick={openCustomerCreateFromLookup}
                      type="button"
                    >
                      Create new customer
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="space-y-2 py-3">
          {staffLines.length === 0 ? (
            <p className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
              No receipt lines yet.
            </p>
          ) : (
            staffLines.map((line, index) => {
              const member = staff.find((item) => item.id === line.staff_id);
              return (
                <div
                  className="rounded border border-zinc-200 p-3"
                  key={line.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      className="text-left"
                      onClick={() => editLine(line)}
                      type="button"
                    >
                      <p className="font-medium">
                        {defaults.showServiceName
                          ? line.service_label
                          : `Service ${index + 1}`}
                      </p>
                      <p className="text-sm text-zinc-600">
                        {defaults.showStaffName
                          ? (member?.display_name ?? "Assigned staff")
                          : "Assigned"}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Parts: {line.amount_input}
                      </p>
                    </button>
                    <div className="text-right">
                      <p className="font-semibold">{formatMoney(line.amount)}</p>
                      <button
                        className="mt-2 text-xs font-medium text-red-600"
                        onClick={() => removeLine(line.id)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="space-y-2 border-t border-zinc-200 pt-3 text-sm">
          <div className="flex justify-between">
            <span>Discount</span>
            <span>{formatMoney(totals.discount_amount)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tax</span>
            <span>{formatMoney(totals.tax_amount)}</span>
          </div>
          <div className="flex justify-between text-zinc-500">
            <span>Gift card</span>
            <span>{formatMoney(0)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tip</span>
            <span>{formatMoney(totals.tip_amount)}</span>
          </div>
          <div className="flex justify-between border-t border-zinc-200 pt-2 text-lg font-semibold">
            <span>Total</span>
            <span>{formatMoney(totals.total)}</span>
          </div>
          <textarea
            className="mt-2 w-full rounded border border-zinc-300 px-3 py-2"
            onChange={(event) => updateDraft({ note: event.target.value })}
            placeholder="Note"
            rows={2}
            value={draft.note}
          />
          {defaults.adsFooter ? (
            <p className="text-xs text-zinc-500">{defaults.adsFooter}</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-300 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Staff Turn Board</h2>
          <p className="text-sm text-zinc-600">
            Large turn: {formatMoney(defaults.largeTurnThreshold)}
          </p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(86px,94px))] justify-start gap-2">
          {sortedStaff.map((member) => {
            const selected = draft.selectedStaffId === member.id;
            const unavailable =
              member.today_status === "checked_out" ||
              member.today_status === "unavailable" ||
              !member.is_active;
            const colorClass = getStaffCardColor(
              member.turns.largeTurns,
              member.turns.smallTurns,
              selected,
            );

            return (
              <button
                className={`aspect-square rounded-lg border p-1.5 text-center transition ${colorClass} ${
                  unavailable ? "opacity-60" : ""
                }`}
                key={member.id}
                onClick={() => selectStaff(member.id)}
                type="button"
                title={member.today_status.replaceAll("_", " ")}
              >
                <span className="block truncate text-base font-semibold leading-tight">
                  {getFirstName(member.display_name)}
                </span>
                <span className="mt-0.5 block text-3xl font-bold leading-none">
                  {member.turns.largeTurns}
                </span>
                <span className="mt-0.5 block text-lg font-semibold leading-none opacity-85">
                  {member.turns.smallTurns}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-300 bg-white p-4">
        {draftRestored ? (
          <p className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Unsaved POS draft saved on this device.
          </p>
        ) : null}
        {error ? (
          <p className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mb-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </p>
        ) : null}

        <div className="mb-3 rounded border border-zinc-200 p-3">
          <p className="text-sm text-zinc-600">Selected staff</p>
          <p className="font-semibold">
            {selectedStaff?.display_name ?? "Tap a staff tile"}
          </p>
        </div>

        <div className="mb-3">
          <label className="mb-1 block text-sm font-medium">Service</label>
          <button
            className="flex min-h-12 w-full items-center justify-between rounded border border-zinc-300 bg-white px-3 py-2 text-left"
            disabled={receiptLocked}
            onClick={() => {
              setShowServicePicker(true);
              setKeypadMode("amount");
            }}
            type="button"
          >
            <span className="font-medium">
              {selectedService?.name ?? "No catalog service"}
            </span>
            <span className="text-sm text-zinc-500">Change</span>
          </button>
        </div>

        <div className="mb-3 rounded border border-zinc-300 bg-zinc-50 px-4 py-3 text-right text-3xl font-semibold">
          {keypadDisplay}
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            {keypadMode.replaceAll("_", " ")}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "/"].map(
            (key) => (
              <button
                className="min-h-14 rounded bg-zinc-900 text-xl font-semibold text-white"
                disabled={receiptLocked}
                key={key}
                onClick={() => handleKeypadKey(key)}
                type="button"
              >
                {key}
              </button>
            ),
          )}
          <button
            className="min-h-12 rounded border border-zinc-300 bg-white font-medium"
            disabled={receiptLocked}
            onClick={handleKeypadBack}
            type="button"
          >
            Back
          </button>
          <button
            className="min-h-12 rounded border border-zinc-300 bg-white font-medium"
            disabled={receiptLocked}
            onClick={handleKeypadClear}
            type="button"
          >
            Clear
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="text-sm font-medium" htmlFor="pos-discount">
                Discount
              </label>
              <div className="grid grid-cols-2 overflow-hidden rounded border border-zinc-300 text-sm">
                <button
                  className={`px-3 py-1 font-medium ${
                    draft.discountType === "fixed_amount"
                      ? "bg-zinc-950 text-white"
                      : "bg-white text-zinc-800"
                  }`}
                  onClick={() => updateDraft({ discountType: "fixed_amount" })}
                  type="button"
                >
                  $
                </button>
                <button
                  className={`px-3 py-1 font-medium ${
                    draft.discountType === "percentage"
                      ? "bg-zinc-950 text-white"
                      : "bg-white text-zinc-800"
                  }`}
                  onClick={() => updateDraft({ discountType: "percentage" })}
                  type="button"
                >
                  %
                </button>
              </div>
            </div>
            <input
              className="w-full rounded border border-zinc-300 px-3 py-2"
              disabled={receiptLocked}
              id="pos-discount"
              inputMode="decimal"
              onChange={(event) =>
                updateDraft({ discountInput: event.target.value })
              }
              onFocus={() => setKeypadMode("discount")}
              placeholder="0"
              value={draft.discountInput}
            />
          </div>

          <label className="block text-sm font-medium">
            Gift card
            <input
              className="mt-1 w-full rounded border border-zinc-200 bg-zinc-100 px-3 py-2 text-zinc-500"
              disabled
              onFocus={() => setKeypadMode("gift_card")}
              placeholder="Coming later"
              value={draft.giftCardInput}
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="text-sm font-medium">
            Tip
            <input
              className="mt-1 w-full rounded border border-zinc-300 px-3 py-2"
              disabled={receiptLocked}
              inputMode="decimal"
              onBlur={(event) => saveTipToSession(event.target.value)}
              onChange={(event) => updateDraft({ tipInput: event.target.value })}
              onFocus={() => setKeypadMode("tip")}
              placeholder="0.00"
              value={draft.tipInput}
            />
          </label>
          <div className="flex items-end gap-2">
            {[5, 10, 20].map((amount) => (
              <button
                className="flex-1 rounded border border-zinc-300 bg-white px-2 py-2 text-sm"
                disabled={receiptLocked}
                key={amount}
                onClick={() => {
                  updateDraft({ tipInput: String(amount) });
                  setKeypadMode("tip");
                  saveTipToSession(String(amount));
                }}
                type="button"
              >
                ${amount}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            className="rounded border border-zinc-300 bg-white px-3 py-3 font-medium"
            onClick={cancelActiveSession}
            type="button"
          >
            Reset
          </button>
          <button
            className="rounded bg-zinc-950 px-3 py-3 font-semibold text-white disabled:opacity-50"
            disabled={isPending}
            onClick={submitReceipt}
            type="button"
          >
            {isPending ? "Submitting" : "Submit"}
          </button>
        </div>
      </section>
      </div>
    </>
  );
}

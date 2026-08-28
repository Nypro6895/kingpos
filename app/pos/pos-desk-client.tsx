"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { QrCodeTile } from "@/components/qr-code-tile";
import { usePathname, useRouter } from "next/navigation";
import { calculateTicketTotals } from "@/lib/pos-ticket-calculations";
import { parsePosAmountInput } from "@/lib/pos-desk-amounts";
import { getStaffTurnToneLevel } from "@/lib/pos-staff-turn-tone";
import {
  getPosLiveDraftRealtimeChannel,
  POS_LIVE_DRAFT_BROADCAST_EVENT,
  type PosLiveDraftBroadcastPayload,
} from "@/lib/pos-live-draft-realtime";
import {
  getPosStaffRealtimeChannel,
  POS_STAFF_BROADCAST_EVENT,
  type PosStaffBroadcastPayload,
} from "@/lib/pos-staff-realtime";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  cancelWaitingVisitForPos,
  createPosDeskCustomer,
  getPosLiveDraft,
  searchPosDeskCustomers,
  selectWaitingVisitForPos,
  submitPosDeskReceipt,
  touchCustomerDisplayLiveDraftActivity,
  updatePosActiveDraft,
  updatePosLiveDraftCustomer,
} from "@/app/pos/actions";
import type { CustomerVisitQueueItem } from "@/types/customer-visit";
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
  staffCheckInEnabled: boolean;
  taxEnabled: boolean;
  tipSuggestions: number[];
};

type DraftState = {
  amountInput: string;
  customerId: string | null;
  customerLookup: string;
  customerName: string;
  customerVisitId: string | null;
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
type SubmittedCustomerClaim = {
  claimPath: string;
  expiresAt: string;
  token: string;
};

type PosToast = {
  amount?: string;
  detail?: string;
  id: number;
  title: string;
  tone: "error" | "success";
};

type PosDeskClientActions = {
  adjustStaffTurn: (input: {
    delta: number;
    operatorPasscode: string;
    operatorStaffId: string;
    reason: string;
    targetStaffId: string;
  }) => Promise<
    | {
        data: {
          delta: number;
          isOperatorPasscodeDefault: boolean;
          newTurn: number;
          oldTurn: number;
          operatorStaffId: string;
          targetStaffId: string;
          today: string;
        };
        ok: true;
      }
    | { error: string; ok: false }
  >;
  cancelWaitingVisitForPos: typeof cancelWaitingVisitForPos;
  createPosDeskCustomer: typeof createPosDeskCustomer;
  getPosLiveDraft: typeof getPosLiveDraft;
  searchPosDeskCustomers: typeof searchPosDeskCustomers;
  selectWaitingVisitForPos: typeof selectWaitingVisitForPos;
  submitPosDeskReceipt: typeof submitPosDeskReceipt;
  touchCustomerDisplayLiveDraftActivity: typeof touchCustomerDisplayLiveDraftActivity;
  updatePosActiveDraft: typeof updatePosActiveDraft;
  updatePosLiveDraftCustomer: typeof updatePosLiveDraftCustomer;
};

const emptyDraft: DraftState = {
  amountInput: "",
  customerId: null,
  customerLookup: "",
  customerName: "",
  customerVisitId: null,
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

const EMPTY_REQUESTED_SERVICES: NonNullable<
  PosLiveDraftCustomer["requestedServices"]
> = [];

const POS_IDLE_RESET_MS = 3 * 60 * 1000;
const POS_TOAST_DISMISS_MS = 5000;
const VISIBLE_SERVICE_TILE_LIMIT = 10;
const WAITING_DRAWER_MARGIN = 12;
const WAITING_DRAWER_DESKTOP_WIDTH = 420;
const WAITING_DRAWER_PORTABLE_WIDTH = 460;
const WAITING_DRAWER_MAX_HEIGHT = 560;
const DISPLAY_IDLE_RESET_SECONDS = 180;
const DISPLAY_ACTIVITY_THROTTLE_MS = 5000;
const PASSCODE_IDLE_CLEAR_MS = 2 * 60 * 1000;
const STAFF_TURN_HOLD_MS = 3000;
const STAFF_TURN_HOLD_MOVE_CANCEL_PX = 10;

type WaitingDrawerPlacement = {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount);
}

function formatAppointmentTime(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatWaitDuration(value: string) {
  const checkedInAt = new Date(value).getTime();

  if (Number.isNaN(checkedInAt)) {
    return "Waiting";
  }

  const totalMinutes = Math.max(0, Math.floor((Date.now() - checkedInAt) / 60000));

  if (totalMinutes < 1) {
    return "Just now";
  }

  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function getVisitSourceLabel(source: CustomerVisitQueueItem["source"]) {
  if (source === "appointment") {
    return "Appt";
  }

  if (source === "walk_in") {
    return "Walk-in";
  }

  return "Screen";
}

function getWaitingVisitMetaParts(visit: CustomerVisitQueueItem) {
  const appointmentTime = formatAppointmentTime(visit.appointmentStartAt);

  return [
    formatWaitDuration(visit.checkedInAt),
    appointmentTime ?? getVisitSourceLabel(visit.source),
    visit.serviceLabel,
    visit.assignedStaffName,
  ].filter((part): part is string => Boolean(part));
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

function getSalonInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "S";
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

const STAFF_TURN_TONE_CLASSES = [
  "border-cyan-200/90 bg-gradient-to-br from-cyan-100/90 via-teal-50/90 to-white/80 text-zinc-950 shadow-[0_10px_24px_rgba(8,145,178,0.10)]",
  "border-lime-200/90 bg-gradient-to-br from-lime-100/90 via-green-50/90 to-white/80 text-zinc-950 shadow-[0_12px_26px_rgba(101,163,13,0.12)]",
  "border-yellow-300/90 bg-gradient-to-br from-yellow-100/95 via-amber-50/90 to-white/82 text-zinc-950 shadow-[0_14px_30px_rgba(217,119,6,0.14)]",
  "border-orange-300/90 bg-gradient-to-br from-orange-100/95 via-amber-100/90 to-white/82 text-zinc-950 shadow-[0_16px_34px_rgba(234,88,12,0.16)]",
  "border-rose-300/90 bg-gradient-to-br from-rose-100/95 via-orange-100/90 to-white/82 text-zinc-950 shadow-[0_18px_38px_rgba(244,63,94,0.18)]",
];

function clampNumber(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function getWaitingDrawerPlacement(
  anchorRect: DOMRect | null,
  viewportWidth: number,
  viewportHeight: number,
  portable: boolean,
): WaitingDrawerPlacement {
  const availableWidth = Math.max(0, viewportWidth - WAITING_DRAWER_MARGIN * 2);
  const preferredWidth = portable
    ? WAITING_DRAWER_PORTABLE_WIDTH
    : WAITING_DRAWER_DESKTOP_WIDTH;
  const width = Math.min(preferredWidth, availableWidth);
  const anchorBottom = anchorRect?.bottom ?? WAITING_DRAWER_MARGIN;
  const anchorTop = anchorRect?.top ?? WAITING_DRAWER_MARGIN;
  const preferredTop = anchorBottom + 8;
  const heightLimit = Math.min(
    WAITING_DRAWER_MAX_HEIGHT,
    Math.max(0, viewportHeight - WAITING_DRAWER_MARGIN * 2),
  );
  const availableBelow =
    viewportHeight - preferredTop - WAITING_DRAWER_MARGIN;
  const top =
    availableBelow >= 240
      ? preferredTop
      : clampNumber(
          anchorTop - heightLimit - 8,
          WAITING_DRAWER_MARGIN,
          viewportHeight - heightLimit - WAITING_DRAWER_MARGIN,
        );
  const maxHeight = Math.max(
    0,
    Math.min(
      WAITING_DRAWER_MAX_HEIGHT,
      viewportHeight - top - WAITING_DRAWER_MARGIN,
    ),
  );
  const preferredLeft = anchorRect?.left ?? WAITING_DRAWER_MARGIN;
  const rightAlignedLeft = anchorRect
    ? anchorRect.right - width
    : WAITING_DRAWER_MARGIN;
  const left =
    preferredLeft + width <= viewportWidth - WAITING_DRAWER_MARGIN ||
    rightAlignedLeft < WAITING_DRAWER_MARGIN
      ? preferredLeft
      : rightAlignedLeft;

  return {
    left: clampNumber(
      left,
      WAITING_DRAWER_MARGIN,
      viewportWidth - width - WAITING_DRAWER_MARGIN,
    ),
    maxHeight,
    top,
    width,
  };
}

function getStaffCardToneClass(toneLevel: number, selected: boolean) {
  const boundedToneLevel = clampNumber(
    toneLevel,
    0,
    STAFF_TURN_TONE_CLASSES.length - 1,
  );

  return [
    STAFF_TURN_TONE_CLASSES[boundedToneLevel],
    selected
      ? "ring-2 ring-brand-orange ring-offset-2 ring-offset-white after:absolute after:right-2 after:top-2 after:h-2.5 after:w-2.5 after:rounded-full after:bg-white after:ring-2 after:ring-brand-orange after:content-['']"
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function hasPositiveAmount(line: PosDeskSessionLine) {
  return line.amount > 0;
}

function ReceiptClock({
  className = "text-sm text-zinc-600",
  timeOnly = false,
}: {
  className?: string;
  timeOnly?: boolean;
} = {}) {
  const [currentTime, setCurrentTime] = useState("");

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setCurrentTime(
        timeOnly
          ? now.toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })
          : now.toLocaleString(),
      );
    }

    const timeoutId = window.setTimeout(updateClock, 0);
    const intervalId = window.setInterval(updateClock, 1000);

    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(intervalId);
    };
  }, [timeOnly]);

  return <time className={className}>{currentTime}</time>;
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
  actions,
  activeSession,
  defaults,
  liveDraft,
  salonLogoUrl,
  salonName,
  services,
  surface = "standard",
  staff,
  today,
  waitingVisits = [],
}: {
  actions?: Partial<PosDeskClientActions>;
  activeSession: PosDeskSessionView | null;
  defaults: PosDeskDefaults;
  liveDraft: PosLiveDraftView | null;
  salonLogoUrl?: string | null;
  salonName: string;
  services: PosDeskService[];
  surface?: "portable" | "standard";
  staff: PosDeskStaff[];
  today?: string;
  waitingVisits?: CustomerVisitQueueItem[];
}) {
  const adjustStaffTurnAction = actions?.adjustStaffTurn;
  const cancelWaitingVisitAction =
    actions?.cancelWaitingVisitForPos ?? cancelWaitingVisitForPos;
  const createCustomerAction =
    actions?.createPosDeskCustomer ?? createPosDeskCustomer;
  const getLiveDraftAction = actions?.getPosLiveDraft ?? getPosLiveDraft;
  const searchCustomersAction =
    actions?.searchPosDeskCustomers ?? searchPosDeskCustomers;
  const selectWaitingVisitAction =
    actions?.selectWaitingVisitForPos ?? selectWaitingVisitForPos;
  const submitReceiptAction =
    actions?.submitPosDeskReceipt ?? submitPosDeskReceipt;
  const updateActiveDraftAction =
    actions?.updatePosActiveDraft ?? updatePosActiveDraft;
  const updateLiveDraftCustomerAction =
    actions?.updatePosLiveDraftCustomer ?? updatePosLiveDraftCustomer;
  const touchLiveDraftActivityAction =
    actions?.touchCustomerDisplayLiveDraftActivity ??
    touchCustomerDisplayLiveDraftActivity;
  const router = useRouter();
  const pathname = usePathname();
  const liveDraftIsOpen = liveDraft?.status === "draft";
  const initialLiveDraftCustomer = liveDraftIsOpen ? liveDraft.customer : null;
  const initialLiveDraftSelectedStaffId = liveDraftIsOpen
    ? liveDraft.selected_staff_id
    : null;
  const initialLiveDraftTip = liveDraftIsOpen ? liveDraft.tip : 0;
  const [draftStaffLines, setDraftStaffLines] = useState<PosDeskSessionLine[]>(
    liveDraftIsOpen
      ? liveDraft.staff_lines.map(liveLineToSessionLine)
      : activeSession?.lines ?? [],
  );
  const initialSelectedLine =
    draftStaffLines.find(
      (line) => line.staff_id === initialLiveDraftSelectedStaffId,
    ) ??
    null;
  const [draft, setDraft] = useState<DraftState>({
    ...emptyDraft,
    amountInput: initialSelectedLine?.amount_input ?? "",
    customerId: initialLiveDraftCustomer?.id ?? null,
    customerLookup: initialLiveDraftCustomer?.phone ?? "",
    customerName: initialLiveDraftCustomer?.name ?? "",
    customerVisitId: initialLiveDraftCustomer?.visitId ?? null,
    editingLineId: initialSelectedLine?.id ?? null,
    selectedServiceId: initialSelectedLine?.service_id ?? null,
    selectedStaffId: initialLiveDraftSelectedStaffId,
    tipInput: initialLiveDraftTip ? String(initialLiveDraftTip) : "",
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
  const [turnAdjustStaff, setTurnAdjustStaff] = useState<PosDeskStaff | null>(
    null,
  );
  const [turnAdjustDelta, setTurnAdjustDelta] = useState(0);
  const [turnAdjustReason, setTurnAdjustReason] = useState("");
  const [turnAdjustOperatorStaffId, setTurnAdjustOperatorStaffId] =
    useState("");
  const [turnAdjustOperatorPasscode, setTurnAdjustOperatorPasscode] =
    useState("");
  const [turnAdjustError, setTurnAdjustError] = useState("");
  const [turnHoldStaffId, setTurnHoldStaffId] = useState<string | null>(null);
  const [turnHoldProgress, setTurnHoldProgress] = useState(0);
  const [liveCustomer, setLiveCustomer] = useState<PosLiveDraftCustomer | null>(
    initialLiveDraftCustomer,
  );
  const [removedWaitingVisitIds, setRemovedWaitingVisitIds] = useState<
    Set<string>
  >(() => new Set());
  const [waitingVisitBusyId, setWaitingVisitBusyId] = useState<string | null>(
    null,
  );
  const [waitingDrawerOpen, setWaitingDrawerOpen] = useState(false);
  const [waitingDrawerPlacement, setWaitingDrawerPlacement] =
    useState<WaitingDrawerPlacement | null>(null);
  const [openWaitingVisitMenuId, setOpenWaitingVisitMenuId] = useState<
    string | null
  >(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const [toast, setToast] = useState<PosToast | null>(null);
  const [customerClaim, setCustomerClaim] =
    useState<SubmittedCustomerClaim | null>(null);
  const [, setError] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [liveDraftSyncNonce, setLiveDraftSyncNonce] = useState(0);
  const [posActivityTick, setPosActivityTick] = useState(0);
  const [, setLastAction] = useState("Ready");
  const [isPending, startTransition] = useTransition();
  const discountInputRef = useRef<HTMLInputElement | null>(null);
  const liveDraftVersionRef = useRef(liveDraft?.version ?? 0);
  const lastSyncedLiveDraftPayloadKeyRef = useRef("");
  const lastCompletedDisplayTouchSyncRef = useRef(0);
  const holdCompletedDisplayRef = useRef(liveDraft?.status === "closed");
  const holdStaffPointerRef = useRef<{
    completed: boolean;
    intervalId: number | null;
    pointerId: number;
    staff: PosDeskStaff;
    startClientX: number;
    startClientY: number;
    startedAt: number;
    target: HTMLButtonElement | null;
    timeoutId: number | null;
  } | null>(null);
  const resetInFlightRef = useRef(false);
  const suppressNextStaffClickRef = useRef(false);
  const submitLockedRef = useRef(false);
  const tipInputRef = useRef<HTMLInputElement | null>(null);
  const waitingButtonRef = useRef<HTMLButtonElement | null>(null);
  const receiptLocked = isResetting || isSubmitting;
  const receiptLockMessage = isSubmitting
    ? "Receipt is submitting. Please wait."
    : isResetting
      ? "Receipt is resetting. Please wait."
      : "Receipt is locked.";
  const liveDraftToken = liveDraft?.token;
  const staffRealtimeSalonId = liveDraft?.salon_id ?? activeSession?.salon_id ?? null;
  const isPortableSurface = surface === "portable";
  const selectedWaitingVisitId = draft.customerVisitId;
  const visitQueue = useMemo(
    () => waitingVisits.filter((visit) => !removedWaitingVisitIds.has(visit.id)),
    [removedWaitingVisitIds, waitingVisits],
  );
  const updateWaitingDrawerPlacement = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    setWaitingDrawerPlacement(
      getWaitingDrawerPlacement(
        waitingButtonRef.current?.getBoundingClientRect() ?? null,
        window.innerWidth,
        window.innerHeight,
        isPortableSurface || window.innerWidth < 640,
      ),
    );
  }, [isPortableSurface]);

  const selectedService = services.find(
    (service) => service.id === draft.selectedServiceId,
  );
  const selectedCustomer = liveCustomer;
  const requestedServices =
    selectedCustomer?.requestedServices ?? EMPTY_REQUESTED_SERVICES;
  const serviceIdSet = useMemo(
    () => new Set(services.map((service) => service.id)),
    [services],
  );
  const tipAmount = Number(draft.tipInput || 0);
  const discountAmount = Number(draft.discountInput || 0);
  const staffLines = draftStaffLines;
  const positiveStaffLines = useMemo(
    () => staffLines.filter(hasPositiveAmount),
    [staffLines],
  );
  const unpricedRequestedServices = useMemo(
    () =>
      requestedServices.filter(
        (service) =>
          !positiveStaffLines.some((line) => line.service_id === service.id),
      ),
    [positiveStaffLines, requestedServices],
  );
  const tipSuggestions =
    defaults.tipSuggestions.length > 0
      ? defaults.tipSuggestions.slice(0, 4)
      : [5, 10, 15, 20];
  const sortedStaff = staff;
  const staffTurnToneCounts = useMemo(
    () =>
      staff.map((member) => member.turns.queueTurns ?? member.turns.largeTurns),
    [staff],
  );
  const customerClaimUrl = useMemo(() => {
    if (!customerClaim) {
      return null;
    }

    if (typeof window === "undefined") {
      return customerClaim.claimPath;
    }

    return new URL(customerClaim.claimPath, window.location.origin).toString();
  }, [customerClaim]);
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
  const visibleServiceTiles = useMemo(() => {
    const tiles: Array<{
      category: string | null;
      id: string;
      name: string;
      requested: boolean;
    }> = [];
    const seen = new Set<string>();
    const addTile = (input: {
      category?: string | null;
      id: string;
      name: string;
      requested?: boolean;
    }) => {
      if (seen.has(input.id) || tiles.length >= VISIBLE_SERVICE_TILE_LIMIT) {
        return;
      }

      seen.add(input.id);
      tiles.push({
        category: input.category ?? null,
        id: input.id,
        name: input.name,
        requested: Boolean(input.requested),
      });
    };

    for (const service of requestedServices) {
      addTile({
        category: service.category,
        id: service.id,
        name: service.name,
        requested: true,
      });
    }

    if (selectedService) {
      addTile({
        category: selectedService.category,
        id: selectedService.id,
        name: selectedService.name,
      });
    }

    for (const service of services) {
      addTile({
        category: service.category,
        id: service.id,
        name: service.name,
      });
    }

    return tiles;
  }, [requestedServices, selectedService, services]);
  const hasHiddenServiceTiles = services.some(
    (service) => !visibleServiceTiles.some((tile) => tile.id === service.id),
  );
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
  const liveTotalBeforeTip = useMemo(
    () => Math.max(0, totals.total - totals.tip_amount),
    [totals.tip_amount, totals.total],
  );
  const liveDraftPayloadKey = useMemo(
    () =>
      JSON.stringify({
        discount: totals.discount_amount,
        selectedStaffId: draft.selectedStaffId,
        staffLines: liveStaffLines,
        subtotal: totals.subtotal,
        tax: totals.tax_amount,
        tip: totals.tip_amount,
        token: liveDraftToken,
        total: totals.total,
        totalBeforeTip: liveTotalBeforeTip,
      }),
    [
      draft.selectedStaffId,
      liveDraftToken,
      liveStaffLines,
      liveTotalBeforeTip,
      totals.discount_amount,
      totals.subtotal,
      totals.tax_amount,
      totals.tip_amount,
      totals.total,
    ],
  );
  const hasUnsavedDraftWork = useMemo(
    () =>
      staffLines.length > 0 ||
      Boolean(selectedCustomer) ||
      Boolean(draft.customerId) ||
      Boolean(draft.customerLookup.trim()) ||
      Boolean(draft.customerName.trim()) ||
      Boolean(draft.customerVisitId) ||
      Boolean(draft.discountInput.trim()) ||
      Boolean(draft.giftCardInput.trim()) ||
      Boolean(draft.note.trim()) ||
      Boolean(draft.tipInput.trim()) ||
      Boolean(draft.selectedServiceId) ||
      Boolean(draft.selectedStaffId),
    [
      draft.customerId,
      draft.customerLookup,
      draft.customerName,
      draft.customerVisitId,
      draft.discountInput,
      draft.giftCardInput,
      draft.note,
      draft.selectedServiceId,
      draft.selectedStaffId,
      draft.tipInput,
      selectedCustomer,
      staffLines.length,
    ],
  );
  const idleResetKey = useMemo(
    () =>
      JSON.stringify({
        customerId: draft.customerId,
        customerLookup: draft.customerLookup,
        customerName: draft.customerName,
        customerVisitId: draft.customerVisitId,
        discountInput: draft.discountInput,
        discountType: draft.discountType,
        giftCardInput: draft.giftCardInput,
        lines: staffLines.map((line) => ({
          amountInput: line.amount_input,
          id: line.id,
          serviceId: line.service_id,
          staffId: line.staff_id,
        })),
        note: draft.note,
        selectedServiceId: draft.selectedServiceId,
        selectedStaffId: draft.selectedStaffId,
        tipInput: draft.tipInput,
      }),
    [
      draft.customerId,
      draft.customerLookup,
      draft.customerName,
      draft.customerVisitId,
      draft.discountInput,
      draft.discountType,
      draft.giftCardInput,
      draft.note,
      draft.selectedServiceId,
      draft.selectedStaffId,
      draft.tipInput,
      staffLines,
    ],
  );

  const updateDraft = useCallback((next: Partial<DraftState>) => {
    setDraft((current) => ({ ...current, ...next }));
    setError(null);
  }, []);

  const showToast = useCallback((input: Omit<PosToast, "id">) => {
    setToast({
      ...input,
      id: Date.now(),
    });
  }, []);

  const showError = useCallback((message: string) => {
    setError(message);
    showToast({
      detail: message,
      title: "POS action needs attention",
      tone: "error",
    });
  }, [showToast]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, POS_TOAST_DISMISS_MS);

    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    if (!waitingDrawerOpen) {
      return;
    }

    updateWaitingDrawerPlacement();
    function closeWaitingOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      setWaitingDrawerOpen(false);
      setOpenWaitingVisitMenuId(null);
    }

    window.addEventListener("keydown", closeWaitingOnEscape);
    window.addEventListener("resize", updateWaitingDrawerPlacement);
    window.addEventListener("scroll", updateWaitingDrawerPlacement, true);

    return () => {
      window.removeEventListener("keydown", closeWaitingOnEscape);
      window.removeEventListener("resize", updateWaitingDrawerPlacement);
      window.removeEventListener("scroll", updateWaitingDrawerPlacement, true);
    };
  }, [updateWaitingDrawerPlacement, waitingDrawerOpen]);

  const clearStaffTurnHold = useCallback(() => {
    const hold = holdStaffPointerRef.current;

    if (hold?.timeoutId !== null && hold?.timeoutId !== undefined) {
      window.clearTimeout(hold.timeoutId);
    }

    if (hold?.intervalId !== null && hold?.intervalId !== undefined) {
      window.clearInterval(hold.intervalId);
    }

    if (hold?.target?.hasPointerCapture(hold.pointerId)) {
      hold.target.releasePointerCapture(hold.pointerId);
    }

    holdStaffPointerRef.current = null;
    setTurnHoldStaffId(null);
    setTurnHoldProgress(0);
  }, []);

  const markPosActivity = useCallback(() => {
    setPosActivityTick((current) => current + 1);

    if (
      !liveDraftToken ||
      !holdCompletedDisplayRef.current ||
      resetInFlightRef.current ||
      submitLockedRef.current
    ) {
      return;
    }

    const now = Date.now();

    if (
      now - lastCompletedDisplayTouchSyncRef.current <
      DISPLAY_ACTIVITY_THROTTLE_MS
    ) {
      return;
    }

    lastCompletedDisplayTouchSyncRef.current = now;

    void touchLiveDraftActivityAction({
      resetSeconds: DISPLAY_IDLE_RESET_SECONDS,
      token: liveDraftToken,
    }).then((result) => {
      if (result.ok) {
        if (result.data) {
          liveDraftVersionRef.current = result.data.version;
        }
        return;
      }

      showError(result.error);
      setLastAction("Display activity sync failed");
    });
  }, [liveDraftToken, showError, touchLiveDraftActivityAction]);

  const focusReceiptMoneyInput = useCallback((mode: "discount" | "tip") => {
    setKeypadMode(mode);
    window.requestAnimationFrame(() => {
      if (mode === "discount") {
        discountInputRef.current?.focus();
        return;
      }

      tipInputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    window.addEventListener("pointerdown", markPosActivity, { passive: true });
    window.addEventListener("keydown", markPosActivity);

    return () => {
      window.removeEventListener("pointerdown", markPosActivity);
      window.removeEventListener("keydown", markPosActivity);
    };
  }, [markPosActivity]);

  useEffect(() => clearStaffTurnHold, [clearStaffTurnHold, pathname]);

  useEffect(() => {
    window.addEventListener("blur", clearStaffTurnHold);

    return () => {
      window.removeEventListener("blur", clearStaffTurnHold);
    };
  }, [clearStaffTurnHold]);

  useEffect(() => {
    if (!showCustomerCreateModal && !showServicePicker && !turnAdjustStaff) {
      return;
    }

    const timeoutId = window.setTimeout(clearStaffTurnHold, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    clearStaffTurnHold,
    showCustomerCreateModal,
    showServicePicker,
    turnAdjustStaff,
  ]);

  useEffect(() => {
    if (!turnAdjustStaff || !turnAdjustOperatorPasscode) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setTurnAdjustOperatorPasscode("");
    }, PASSCODE_IDLE_CLEAR_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [turnAdjustOperatorPasscode, turnAdjustStaff]);

  useEffect(() => {
    if (keypadMode === "discount") {
      discountInputRef.current?.focus();
    }

    if (keypadMode === "tip") {
      tipInputRef.current?.focus();
    }
  }, [keypadMode]);

  const publishCustomerToLiveDraft = useCallback(
    (customer: PosLiveDraftCustomer | null) => {
      if (resetInFlightRef.current || submitLockedRef.current) {
        return;
      }

      setLiveCustomer(customer);

      if (!liveDraftToken) {
        return;
      }

      startTransition(async () => {
        if (resetInFlightRef.current || submitLockedRef.current) {
          return;
        }

        const result = await updateLiveDraftCustomerAction({
          customer,
          token: liveDraftToken,
        });

        if (resetInFlightRef.current || submitLockedRef.current) {
          return;
        }

        if (!result.ok) {
          showError(result.error);
          setLastAction("Customer sync failed");
          return;
        }

        liveDraftVersionRef.current = result.data.version;
      });
    },
    [liveDraftToken, showError, startTransition, updateLiveDraftCustomerAction],
  );

  const saveCustomerToSession = useCallback(
    (customer?: PosDeskCustomer) => {
      if (receiptLocked) {
        showError(receiptLockMessage);
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
          customerVisitId: null,
        });
        setCustomerResults([]);
        setCustomerSearchComplete(false);
      }

      if (nextCustomer) {
        publishCustomerToLiveDraft(nextCustomer);
      }
      setLastAction("Customer saved locally");
    },
    [
      draft.customerLookup,
      draft.customerName,
      publishCustomerToLiveDraft,
      receiptLockMessage,
      receiptLocked,
      showError,
      updateDraft,
    ],
  );

  useEffect(() => {
    if (!liveDraftToken || isResetting || isSubmitting) {
      return;
    }

    if (holdCompletedDisplayRef.current && !hasUnsavedDraftWork) {
      return;
    }

    const shouldFlushCompletedHold =
      holdCompletedDisplayRef.current && hasUnsavedDraftWork;

    if (shouldFlushCompletedHold) {
      holdCompletedDisplayRef.current = false;
    }

    let timeoutId: number | undefined;
    const flushLiveDraft = () => {
      if (resetInFlightRef.current || submitLockedRef.current) {
        timeoutId = window.setTimeout(flushLiveDraft, 100);
        return;
      }

      void updateActiveDraftAction({
        discount: totals.discount_amount,
        selectedStaffId: draft.selectedStaffId,
        staffLines: liveStaffLines,
        subtotal: totals.subtotal,
        tax: totals.tax_amount,
        tip: totals.tip_amount,
        token: liveDraftToken,
        total: totals.total,
        totalBeforeTip: liveTotalBeforeTip,
      }).then((result) => {
        if (!result.ok) {
          showError(result.error);
          setLastAction("Live draft sync failed");
          return;
        }

        liveDraftVersionRef.current = result.data.version;
        lastSyncedLiveDraftPayloadKeyRef.current = liveDraftPayloadKey;
      });
    };

    timeoutId = window.setTimeout(
      flushLiveDraft,
      shouldFlushCompletedHold ? 0 : 350,
    );

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    draft.selectedStaffId,
    hasUnsavedDraftWork,
    isResetting,
    isSubmitting,
    liveDraftSyncNonce,
    liveDraftPayloadKey,
    liveDraftToken,
    liveStaffLines,
    liveTotalBeforeTip,
    totals.discount_amount,
    totals.subtotal,
    totals.tax_amount,
    totals.tip_amount,
    totals.total,
    updateActiveDraftAction,
    showError,
  ]);

  useEffect(() => {
    if (!liveDraftToken || !hasUnsavedDraftWork || isResetting || isSubmitting) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (lastSyncedLiveDraftPayloadKeyRef.current === liveDraftPayloadKey) {
        return;
      }

      if (resetInFlightRef.current || submitLockedRef.current) {
        return;
      }

      void updateActiveDraftAction({
        discount: totals.discount_amount,
        selectedStaffId: draft.selectedStaffId,
        staffLines: liveStaffLines,
        subtotal: totals.subtotal,
        tax: totals.tax_amount,
        tip: totals.tip_amount,
        token: liveDraftToken,
        total: totals.total,
        totalBeforeTip: liveTotalBeforeTip,
      }).then((result) => {
        if (!result.ok) {
          showError(result.error);
          setLastAction("Live draft sync failed");
          return;
        }

        liveDraftVersionRef.current = result.data.version;
        lastSyncedLiveDraftPayloadKeyRef.current = liveDraftPayloadKey;
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [
    draft.selectedStaffId,
    hasUnsavedDraftWork,
    isResetting,
    isSubmitting,
    liveDraftPayloadKey,
    liveDraftToken,
    liveStaffLines,
    liveTotalBeforeTip,
    totals.discount_amount,
    totals.subtotal,
    totals.tax_amount,
    totals.tip_amount,
    totals.total,
    updateActiveDraftAction,
    showError,
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
          const results = await searchCustomersAction(lookup);

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
            showError(
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
  }, [
    draft.customerLookup,
    receiptLocked,
    searchCustomersAction,
    selectedCustomer,
    showError,
  ]);

  const applyCustomerDisplaySnapshot = useCallback(
    (snapshot: PosLiveDraftView) => {
      if (snapshot.version <= liveDraftVersionRef.current) {
        return;
      }

      liveDraftVersionRef.current = snapshot.version;

      if (snapshot.status === "closed") {
        setLastAction("Customer display showing final receipt");
        return;
      }

      setLiveCustomer(snapshot.customer);
      setDraft((current) => {
        const next: DraftState = {
          ...current,
          tipInput: snapshot.tip > 0 ? String(snapshot.tip) : "",
        };

        if (snapshot.customer) {
          next.customerId = snapshot.customer.id;
          next.customerLookup = snapshot.customer.phone ?? current.customerLookup;
          next.customerName = snapshot.customer.name;
          next.customerVisitId = snapshot.customer.visitId ?? null;
          const firstRequestedServiceId =
            snapshot.customer.requestedServices?.find((service) =>
              serviceIdSet.has(service.id),
            )?.id ?? null;

          if (
            firstRequestedServiceId &&
            (!current.selectedServiceId ||
              !serviceIdSet.has(current.selectedServiceId))
          ) {
            next.selectedServiceId = firstRequestedServiceId;
          }
        }

        if (!snapshot.customer && (current.customerId || current.customerVisitId)) {
          next.customerId = null;
          next.customerLookup = "";
          next.customerName = "";
          next.customerVisitId = null;
        }

        return next;
      });
      setLastAction("Customer display synced");
    },
    [serviceIdSet],
  );

  useEffect(() => {
    if (!liveDraftToken) {
      return;
    }

    const token = liveDraftToken;
    let isMounted = true;

    async function loadLatestSnapshot() {
      const result = await getLiveDraftAction(token);

      if (!isMounted || !result.ok || !result.data) {
        return;
      }

      applyCustomerDisplaySnapshot(result.data);
    }

    void loadLatestSnapshot();

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      return () => {
        isMounted = false;
      };
    }

    const channel = supabase
      .channel(getPosLiveDraftRealtimeChannel(token), {
        config: { broadcast: { ack: false, self: true } },
      })
      .on(
        "broadcast",
        { event: POS_LIVE_DRAFT_BROADCAST_EVENT },
        (payload: { payload: PosLiveDraftBroadcastPayload }) => {
          if (payload.payload.token !== token) {
            return;
          }

          void loadLatestSnapshot();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void loadLatestSnapshot();
        }
      });

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [
    applyCustomerDisplaySnapshot,
    getLiveDraftAction,
    liveDraftToken,
  ]);

  useEffect(() => {
    if (!staffRealtimeSalonId) {
      return;
    }

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel(getPosStaffRealtimeChannel(staffRealtimeSalonId))
      .on(
        "broadcast",
        { event: POS_STAFF_BROADCAST_EVENT },
        ({ payload }: { payload: PosStaffBroadcastPayload }) => {
          if (payload.salonId === staffRealtimeSalonId) {
            router.refresh();
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, staffRealtimeSalonId]);

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

  function getNextRequestedServiceIdForLine(
    currentLine: PosDeskSessionLine | null,
  ) {
    if (requestedServices.length === 0) {
      return null;
    }

    const completedServiceIds = new Set(
      staffLines
        .filter(hasPositiveAmount)
        .map((line) => line.service_id)
        .filter((serviceId): serviceId is string => Boolean(serviceId)),
    );

    if (currentLine?.service_id) {
      completedServiceIds.add(currentLine.service_id);
    }

    return (
      requestedServices.find((service) => !completedServiceIds.has(service.id))
        ?.id ?? null
    );
  }

  function createNextStaffEntry(staffId: string, currentLine: PosDeskSessionLine | null) {
    const nextServiceId = getNextRequestedServiceIdForLine(currentLine);
    return createStaffLine(
      staffId,
      staffLines.length + 1,
      nextServiceId ?? null,
    );
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

  function releaseCompletedDisplayHold() {
    if (holdCompletedDisplayRef.current) {
      holdCompletedDisplayRef.current = false;
    }
  }

  function queueLiveDraftSync() {
    setLiveDraftSyncNonce((current) => current + 1);
  }

  function openTurnAdjustment(member: PosDeskStaff) {
    if (!adjustStaffTurnAction || !isPortableSurface) {
      return;
    }

    clearStaffTurnHold();
    setTurnAdjustStaff(member);
    setTurnAdjustDelta(0);
    setTurnAdjustReason("");
    setTurnAdjustOperatorPasscode("");
    setTurnAdjustOperatorStaffId(
      sortedStaff.find((candidate) => candidate.id !== member.id)?.id ?? "",
    );
    setTurnAdjustError("");
  }

  function handleStaffPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    member: PosDeskStaff,
  ) {
    if (
      !adjustStaffTurnAction ||
      !isPortableSurface ||
      receiptLocked ||
      (event.button !== 0 && event.pointerType === "mouse")
    ) {
      return;
    }

    clearStaffTurnHold();
    const startedAt = event.timeStamp;
    const hold = {
      completed: false,
      intervalId: null as number | null,
      pointerId: event.pointerId,
      staff: member,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startedAt,
      target: event.currentTarget,
      timeoutId: null as number | null,
    };

    hold.timeoutId = window.setTimeout(() => {
      const current = holdStaffPointerRef.current;

      if (!current || current.pointerId !== event.pointerId) {
        return;
      }

      current.completed = true;
      suppressNextStaffClickRef.current = true;
      openTurnAdjustment(member);
    }, STAFF_TURN_HOLD_MS);
    hold.intervalId = window.setInterval(() => {
      const current = holdStaffPointerRef.current;

      if (!current || current.pointerId !== event.pointerId) {
        return;
      }

      setTurnHoldProgress(
        Math.min(1, (performance.now() - current.startedAt) / STAFF_TURN_HOLD_MS),
      );
    }, 40);
    holdStaffPointerRef.current = hold;
    setTurnHoldStaffId(member.id);
    setTurnHoldProgress(0.02);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleStaffPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const hold = holdStaffPointerRef.current;

    if (!hold || hold.pointerId !== event.pointerId) {
      return;
    }

    const moved = Math.hypot(
      event.clientX - hold.startClientX,
      event.clientY - hold.startClientY,
    );

    if (moved > STAFF_TURN_HOLD_MOVE_CANCEL_PX) {
      clearStaffTurnHold();
    }
  }

  function handleStaffPointerEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const hold = holdStaffPointerRef.current;

    if (!hold || hold.pointerId !== event.pointerId) {
      return;
    }

    if (hold.completed) {
      suppressNextStaffClickRef.current = true;
    }

    clearStaffTurnHold();
  }

  function handleStaffCardClick(staffId: string) {
    if (suppressNextStaffClickRef.current) {
      suppressNextStaffClickRef.current = false;
      return;
    }

    selectStaff(staffId);
  }

  function handleStaffCardKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    member: PosDeskStaff,
  ) {
    if (
      (event.key === "Enter" && event.shiftKey) ||
      event.key === "ContextMenu"
    ) {
      event.preventDefault();
      openTurnAdjustment(member);
    }
  }

  function selectStaff(staffId: string) {
    if (receiptLocked) {
      showError(receiptLockMessage);
      setLastAction("Staff select blocked");
      return;
    }

    releaseCompletedDisplayHold();

    const existingStaffLine = getStaffLine(staffId);
    const activeLine = getActiveLine();

    if (activeLine && !hasPositiveAmount(activeLine)) {
      if (existingStaffLine && existingStaffLine.id !== activeLine.id) {
        setDraftStaffLines((current) =>
          current.filter((line) => line.id !== activeLine.id),
        );
        focusLine(existingStaffLine);
        queueLiveDraftSync();
        setLastAction("Empty staff line removed");
        return;
      }

      if (existingStaffLine) {
        focusLine(existingStaffLine);
        queueLiveDraftSync();
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
      queueLiveDraftSync();
      setLastAction("Empty staff line replaced");
      return;
    }

    if (existingStaffLine && (!activeLine || !hasPositiveAmount(activeLine))) {
      focusLine(existingStaffLine);
      queueLiveDraftSync();
      setLastAction("Existing staff line selected");
      return;
    }

    const nextLine =
      activeLine && hasPositiveAmount(activeLine)
        ? createNextStaffEntry(staffId, activeLine)
        : createStaffLine(
            staffId,
            staffLines.length + 1,
            draft.selectedServiceId,
          );
    setDraftStaffLines((current) => [...current, nextLine]);
    focusLine(nextLine);
    queueLiveDraftSync();
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
      showError(receiptLockMessage);
      setLastAction("Edit blocked");
      return;
    }

    const nextLines = staffLines.filter((line) => line.id !== lineId);
    setDraftStaffLines(nextLines);
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
      showError("Select staff before entering an amount.");
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
    queueLiveDraftSync();
    setLastAction("Line amount synced");
  }

  function selectService(serviceId: string | null) {
    releaseCompletedDisplayHold();

    const service = services.find((item) => item.id === serviceId);

    if (!draft.editingLineId && !draft.selectedStaffId) {
      updateDraft({ selectedServiceId: serviceId });
      setShowServicePicker(false);
      setServiceSearch("");
      setKeypadMode("amount");
      return;
    }

    const activeLine = getActiveLine();

    if (activeLine && hasPositiveAmount(activeLine)) {
      const staffId = activeLine.staff_id ?? draft.selectedStaffId;

      if (!staffId) {
        updateDraft({ selectedServiceId: serviceId });
        setShowServicePicker(false);
        setServiceSearch("");
        setKeypadMode("amount");
        return;
      }

      const nextLine = createStaffLine(
        staffId,
        staffLines.length + 1,
        serviceId,
      );

      setDraftStaffLines((current) => [...current, nextLine]);
      focusLine(nextLine);
      queueLiveDraftSync();
      setShowServicePicker(false);
      setServiceSearch("");
      setKeypadMode("amount");
      return;
    }

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
    releaseCompletedDisplayHold();

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
    releaseCompletedDisplayHold();

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
    releaseCompletedDisplayHold();

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

  const clearDraft = useCallback(() => {
    setDraft(emptyDraft);
    setDraftStaffLines([]);
    setLiveCustomer(null);
    setDraftRestored(false);
    setError(null);
    setCustomerClaim(null);
    setCustomerResults([]);
    setCustomerSearchComplete(false);
    setCustomerCreateDraft(emptyCustomerCreateDraft);
    setCustomerCreateField("name");
    setKeypadMode("amount");
    setServiceSearch("");
    setShowCustomerCreateModal(false);
    setShowServicePicker(false);
  }, []);

  const syncEmptyLiveDraft = useCallback(async () => {
    if (!liveDraftToken) {
      return;
    }

    const customerResult = await updateLiveDraftCustomerAction({
      customer: null,
      token: liveDraftToken,
    });

    if (!customerResult.ok) {
      throw new Error(customerResult.error);
    }

    const draftResult = await updateActiveDraftAction({
      discount: 0,
      selectedStaffId: null,
      staffLines: [],
      subtotal: 0,
      tax: 0,
      tip: 0,
      token: liveDraftToken,
      total: 0,
      totalBeforeTip: 0,
    });

    if (!draftResult.ok) {
      throw new Error(draftResult.error);
    }

    liveDraftVersionRef.current = draftResult.data.version;
  }, [liveDraftToken, updateActiveDraftAction, updateLiveDraftCustomerAction]);

  const resetReceipt = useCallback(
    async (reason: "idle" | "manual" | "submitted" = "manual") => {
      if (resetInFlightRef.current) {
        return;
      }

      resetInFlightRef.current = true;
      holdCompletedDisplayRef.current = false;
      setIsResetting(true);
      setError(null);

      try {
        await syncEmptyLiveDraft();
        clearDraft();
        router.refresh();

        if (reason === "idle") {
          setLastAction("Idle reset");
        } else if (reason === "manual") {
          setLastAction("Receipt reset");
        }

        return true;
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Unable to reset POS receipt.",
        );
        setLastAction("Reset failed");
        return false;
      } finally {
        resetInFlightRef.current = false;
        setIsResetting(false);
      }
    },
    [clearDraft, router, showError, syncEmptyLiveDraft],
  );

  useEffect(() => {
    if (!hasUnsavedDraftWork || isResetting || isSubmitting) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void resetReceipt("idle");
    }, POS_IDLE_RESET_MS);

    return () => window.clearTimeout(timeoutId);
  }, [
    hasUnsavedDraftWork,
    idleResetKey,
    isResetting,
    isSubmitting,
    posActivityTick,
    resetReceipt,
  ]);

  function submitReceipt() {
    if (submitLockedRef.current) {
      showError("Receipt is already submitting. Please wait.");
      setLastAction("Submit already running");
      return;
    }

    if (isResetting) {
      showError("Receipt is resetting. Please wait.");
      setLastAction("Submit blocked");
      return;
    }

    const positiveLines = staffLines.filter(hasPositiveAmount);

    if (positiveLines.length === 0) {
      setDraftStaffLines([]);
      updateDraft({
        amountInput: "",
        editingLineId: null,
        selectedStaffId: null,
      });
      showError("Add at least one service amount before submit.");
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

    submitLockedRef.current = true;
    setIsSubmitting(true);
    setCustomerClaim(null);
    const submittedCustomerName =
      draft.customerName.trim() ||
      selectedCustomer?.name ||
      draft.customerLookup.trim() ||
      "Walk-in";
    const submittedTotal = totals.total;
    startTransition(async () => {
      try {
        setError(null);
        const result = await submitReceiptAction({
          customerId: draft.customerId ?? selectedCustomer?.id,
          customerLookup: draft.customerLookup || selectedCustomer?.phone,
          customerName: draft.customerName || selectedCustomer?.name,
          customerVisitId:
            draft.customerVisitId ?? selectedCustomer?.visitId ?? null,
          discountType: draft.discountType,
          discountValue: totals.discount_value,
          lines: submitLines,
          liveDraftToken,
          note: draft.note,
          tipAmount: totals.tip_value,
        });

        if (!result.ok) {
          showError(result.error);
          setLastAction("Submit failed");
          return;
        }

        holdCompletedDisplayRef.current = true;
        clearDraft();
        showToast({
          amount: formatMoney(submittedTotal),
          detail: submittedCustomerName,
          title: `Ticket ${result.ticketNumber} submitted`,
          tone: "success",
        });
        setCustomerClaim(result.customerClaim ?? null);
        setLastAction("Receipt submitted");
      } catch (error) {
        showError(
          error instanceof Error ? error.message : "Unable to submit POS receipt.",
        );
        setLastAction("Submit failed");
      } finally {
        submitLockedRef.current = false;
        setIsSubmitting(false);
      }
    });
  }

  function cancelActiveSession() {
    void resetReceipt("manual");
  }

  function closeTurnAdjustment() {
    setTurnAdjustStaff(null);
    setTurnAdjustDelta(0);
    setTurnAdjustReason("");
    setTurnAdjustOperatorPasscode("");
    setTurnAdjustOperatorStaffId("");
    setTurnAdjustError("");
  }

  function submitTurnAdjustment() {
    if (!turnAdjustStaff || !adjustStaffTurnAction || isPending) {
      return;
    }

    if (turnAdjustDelta === 0) {
      setTurnAdjustError("Choose plus one or minus one before confirming.");
      return;
    }

    if (!turnAdjustOperatorStaffId) {
      setTurnAdjustError("Choose the manager approving this adjustment.");
      return;
    }

    if (turnAdjustOperatorPasscode.length < 4) {
      setTurnAdjustError("Enter the manager passcode.");
      return;
    }

    if (!turnAdjustReason.trim()) {
      setTurnAdjustError("Reason is required.");
      return;
    }

    const staffName = turnAdjustStaff.display_name;
    startTransition(async () => {
      const result = await adjustStaffTurnAction({
        delta: turnAdjustDelta,
        operatorPasscode: turnAdjustOperatorPasscode,
        operatorStaffId: turnAdjustOperatorStaffId,
        reason: turnAdjustReason.trim(),
        targetStaffId: turnAdjustStaff.id,
      });

      setTurnAdjustOperatorPasscode("");

      if (!result.ok) {
        setTurnAdjustError(result.error);
        return;
      }

      closeTurnAdjustment();
      showToast({
        detail: `${staffName} ${result.data.delta > 0 ? "+" : ""}${
          result.data.delta
        } to ${result.data.newTurn}`,
        title: "Turn adjusted",
        tone: "success",
      });
      setLastAction("Staff turn adjusted");
      router.refresh();
    });
  }

  function clearSelectedCustomer() {
    updateDraft({
      customerId: null,
      customerLookup: "",
      customerName: "",
      customerVisitId: null,
    });
    setCustomerResults([]);
    setCustomerSearchComplete(false);
    setShowCustomerCreateModal(false);
    publishCustomerToLiveDraft(null);
    setLastAction("Customer cleared");
  }

  function selectWaitingVisit(visit: CustomerVisitQueueItem) {
    if (receiptLocked) {
      showError(receiptLockMessage);
      setLastAction("Waiting client select blocked");
      return;
    }

    if (!liveDraftToken) {
      showError("Live draft is unavailable. Open POS again and retry.");
      setLastAction("Waiting client select blocked");
      return;
    }

    setWaitingVisitBusyId(visit.id);
    startTransition(async () => {
      try {
        const result = await selectWaitingVisitAction({
          token: liveDraftToken,
          visitId: visit.id,
        });

        if (!result.ok) {
          showError(result.error);
          setLastAction("Waiting client select failed");
          return;
        }

        if (result.data.snapshot) {
          applyCustomerDisplaySnapshot(result.data.snapshot);
        } else {
          const customer = {
            id: visit.customerId,
            name: visit.customerName,
            phone: visit.customerPhone,
            requestedServices: visit.requestedServices,
            visitId: visit.id,
          };
          const firstRequestedServiceId =
            visit.requestedServices.find((service) => serviceIdSet.has(service.id))
              ?.id ?? null;
          setLiveCustomer(customer);
          updateDraft({
            customerId: visit.customerId,
            customerLookup: visit.customerPhone ?? "",
            customerName: visit.customerName,
            customerVisitId: visit.id,
            selectedServiceId: firstRequestedServiceId ?? draft.selectedServiceId,
          });
        }

        setLastAction("Waiting client selected");
        setOpenWaitingVisitMenuId(null);
        setWaitingDrawerOpen(false);
        router.refresh();
      } catch (error) {
        showError(
          error instanceof Error
            ? error.message
            : "Unable to select waiting client.",
        );
        setLastAction("Waiting client select failed");
      } finally {
        setWaitingVisitBusyId((current) => (current === visit.id ? null : current));
      }
    });
  }

  function removeWaitingVisit(visit: CustomerVisitQueueItem) {
    setWaitingVisitBusyId(visit.id);
    startTransition(async () => {
      try {
        const result = await cancelWaitingVisitAction({
          visitId: visit.id,
        });

        if (!result.ok) {
          showError(result.error);
          setLastAction("Waiting client remove failed");
          return;
        }

        setRemovedWaitingVisitIds((current) => {
          const next = new Set(current);
          next.add(visit.id);
          return next;
        });

        if (draft.customerVisitId === visit.id) {
          const customer = liveCustomer
            ? { ...liveCustomer, visitId: null }
            : null;

          updateDraft({ customerVisitId: null });

          if (customer) {
            publishCustomerToLiveDraft(customer);
          }
        }

        showToast({
          detail: getFirstName(visit.customerName),
          title: "Removed from waiting",
          tone: "success",
        });
        setLastAction("Waiting client removed");
        setOpenWaitingVisitMenuId(null);
        router.refresh();
      } catch (error) {
        showError(
          error instanceof Error
            ? error.message
            : "Unable to remove waiting client.",
        );
        setLastAction("Waiting client remove failed");
      } finally {
        setWaitingVisitBusyId((current) => (current === visit.id ? null : current));
      }
    });
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
      showError("Customer name is required.");
      setLastAction("Customer create blocked");
      return;
    }

    startTransition(async () => {
      const result = await createCustomerAction({
        email: customerCreateDraft.email,
        name,
        phone: customerCreateDraft.phone,
      });

      if (!result.ok) {
        showError(result.error);
        setLastAction("Customer create failed");
        return;
      }

      setShowCustomerCreateModal(false);
      setCustomerCreateDraft(emptyCustomerCreateDraft);
      saveCustomerToSession(result.data);
      setLastAction("Customer created");
    });
  }

  function saveTipToSession(value: string) {
    const nextTip = Number(value || 0);

    if (!Number.isFinite(nextTip) || nextTip < 0) {
      showError("Tip must be zero or greater.");
      setLastAction("Tip save blocked");
      return;
    }

    if (receiptLocked) {
      showError(receiptLockMessage);
      setLastAction("Tip save blocked");
      return;
    }

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

  const rootClass = isPortableSurface
    ? "portable-pos-auto-scale grid h-full min-h-0 w-full gap-2 overflow-hidden"
    : "grid min-h-[calc(100vh-120px)] grid-cols-1 gap-4 xl:grid-cols-[380px_minmax(360px,1fr)_360px]";
  const rootStyle = isPortableSurface
    ? {
        gridTemplateColumns:
          "minmax(300px, 320px) minmax(300px, 1fr) minmax(300px, 340px)",
      }
    : undefined;
  const panelClass = [
    "flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/70 bg-white/80 shadow-[0_18px_46px_rgba(24,24,27,0.10)] backdrop-blur",
    isPortableSurface ? "p-3" : "p-4",
  ].join(" ");
  const showSubtotalRow =
    isPortableSurface &&
    (totals.discount_amount > 0 ||
      totals.tax_amount !== 0 ||
      totals.tip_amount > 0);
  const waitingDrawerTitle = `Waiting ${visitQueue.length}`;
  const waitingRows = (
    <div className="grid gap-2">
      {visitQueue.map((visit) => {
        const selected = selectedWaitingVisitId === visit.id;
        const busy = waitingVisitBusyId === visit.id;
        const menuOpen = openWaitingVisitMenuId === visit.id;
        const meta = getWaitingVisitMetaParts(visit);

        return (
          <div
            className={[
              "grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border p-1.5",
              selected
                ? "border-emerald-400 bg-emerald-50"
                : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50",
            ].join(" ")}
            data-pos-waiting-row
            key={visit.id}
          >
            <button
              aria-label={`Select ${visit.customerName} from waiting`}
              className="grid min-h-14 min-w-0 rounded px-2 py-1 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-wait disabled:opacity-60"
              data-pos-waiting-row-select
              disabled={isPending || receiptLocked || !liveDraftToken || busy}
              onClick={() => selectWaitingVisit(visit)}
              type="button"
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-sm font-semibold text-zinc-950">
                    {visit.customerName}
                  </p>
                  {selected ? (
                    <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                      Selected
                    </span>
                  ) : null}
                  {busy ? (
                    <span className="shrink-0 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-700">
                      Working
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-zinc-600">
                  {meta.join(" / ")}
                </p>
              </div>
            </button>
            <div className="relative">
              <button
                aria-expanded={menuOpen}
                aria-label={`More actions for ${visit.customerName}`}
                className="grid h-10 w-10 place-items-center rounded-md border border-zinc-300 bg-white text-sm font-bold text-zinc-700 disabled:opacity-50"
                disabled={isPending || busy}
                onClick={() =>
                  setOpenWaitingVisitMenuId((current) =>
                    current === visit.id ? null : visit.id,
                  )
                }
                type="button"
              >
                ...
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-11 z-10 w-44 rounded-md border border-zinc-200 bg-white p-1 shadow-lg">
                  <button
                    className="min-h-10 w-full rounded px-3 text-left text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                    disabled={isPending || busy}
                    onClick={() => removeWaitingVisit(visit)}
                    type="button"
                  >
                    Remove from waiting
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
  const waitingButton = (
    <button
      aria-expanded={waitingDrawerOpen}
      aria-label={`Open waiting list${visitQueue.length > 0 ? `, ${visitQueue.length} waiting` : ""}`}
      className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
      data-pos-waiting-launcher
      onClick={() => {
        updateWaitingDrawerPlacement();
        setWaitingDrawerOpen((current) => {
          if (current) {
            setOpenWaitingVisitMenuId(null);
          }

          return !current;
        });
      }}
      ref={waitingButtonRef}
      type="button"
    >
      <span>Waiting</span>
      {visitQueue.length > 0 ? (
        <span
          className="rounded-full bg-zinc-950 px-2 py-0.5 text-xs font-semibold text-white"
          data-pos-waiting-count
        >
          {visitQueue.length}
        </span>
      ) : null}
    </button>
  );
  const waitingDrawer = waitingDrawerOpen ? (
    <div
      className="fixed inset-0 z-[45] pointer-events-none"
      data-pos-waiting-portal-layer
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-auto bg-transparent"
        onClick={() => {
          setWaitingDrawerOpen(false);
          setOpenWaitingVisitMenuId(null);
        }}
      />
      <div
        aria-label={waitingDrawerTitle}
        className="fixed z-10 pointer-events-auto flex min-w-0 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white/95 shadow-2xl backdrop-blur"
        data-pos-waiting-drawer
        data-pos-waiting-drawer-placement={
          isPortableSurface ||
          (waitingDrawerPlacement?.width ?? WAITING_DRAWER_DESKTOP_WIDTH) <
            WAITING_DRAWER_DESKTOP_WIDTH
            ? "sheet"
            : "popover"
        }
        role="dialog"
        style={
          waitingDrawerPlacement ?? {
            left: WAITING_DRAWER_MARGIN,
            maxHeight: WAITING_DRAWER_MAX_HEIGHT,
            top: WAITING_DRAWER_MARGIN,
            width: WAITING_DRAWER_DESKTOP_WIDTH,
          }
        }
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-950">
              {waitingDrawerTitle}
            </h2>
            <p className="text-xs font-medium text-zinc-500">
              Oldest check-in first
            </p>
          </div>
          <button
            className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold"
            onClick={() => {
              setWaitingDrawerOpen(false);
              setOpenWaitingVisitMenuId(null);
            }}
            type="button"
          >
            Close
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto px-3 py-3"
          data-pos-waiting-drawer-scroll
        >
          {visitQueue.length === 0 ? (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-3 text-sm font-medium text-zinc-600">
              Waiting 0
            </div>
          ) : (
            waitingRows
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-zinc-200 px-4 py-3">
          <button
            className="min-h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-700"
            onClick={() => {
              setOpenWaitingVisitMenuId(null);
              router.refresh();
            }}
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  ) : null;
  const waitingDrawerLayer =
    waitingDrawer && typeof document !== "undefined"
      ? createPortal(waitingDrawer, document.body)
      : null;

  return (
    <>
      {toast ? (
        <div
          aria-live="polite"
          className="fixed left-1/2 top-1/2 z-[70] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-white/80 bg-white/78 p-4 shadow-[0_22px_60px_rgba(24,24,27,0.18)] backdrop-blur-xl"
          data-pos-toast
          data-pos-toast-tone={toast.tone}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/92 via-white/74 to-teal-50/64" />
          <div className="relative flex items-start gap-3">
            <div
              aria-hidden="true"
              className={[
                "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_0_5px_rgba(255,255,255,0.62)]",
                toast.tone === "success" ? "bg-emerald-500" : "bg-red-500",
              ].join(" ")}
            />
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold text-zinc-950">{toast.title}</p>
              {toast.detail ? (
                <p className="mt-1 truncate text-sm font-medium text-zinc-600">
                  {toast.detail}
                </p>
              ) : null}
              {toast.amount ? (
                <p
                  className="mt-2 text-3xl font-black leading-none tracking-normal text-zinc-950 tabular-nums"
                  data-pos-toast-amount
                >
                  {toast.amount}
                </p>
              ) : null}
            </div>
            <button
              aria-label="Close notification"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/80 bg-white/80 text-sm font-bold text-zinc-600 shadow-sm transition hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              data-pos-toast-close
              onClick={() => setToast(null)}
              onPointerDown={(event) => event.stopPropagation()}
              type="button"
            >
              X
            </button>
          </div>
        </div>
      ) : null}
      {waitingDrawerLayer}
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
                disabled={isPending || isResetting || isSubmitting}
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
          <div
            className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-lg border border-white/70 bg-white/90 p-4 shadow-2xl backdrop-blur"
            data-pos-service-picker
          >
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
                className="min-h-14 rounded-lg border border-zinc-200 bg-zinc-50/80 px-4 py-3 text-left text-sm font-semibold text-zinc-700 transition hover:bg-white"
                onClick={() => selectService(null)}
                type="button"
              >
                Custom amount
              </button>
              {filteredServices.map((service) => (
                <button
                  className="min-h-14 rounded-lg border border-zinc-200 bg-white/80 px-4 py-3 text-left text-sm shadow-sm transition hover:bg-white"
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

      {turnAdjustStaff ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 p-4"
          role="dialog"
        >
          <div className="grid max-h-[calc(100dvh-2rem)] w-full max-w-md gap-4 overflow-auto rounded-lg border border-zinc-200 bg-white p-4 shadow-2xl">
            <div>
              <p className="text-sm font-semibold text-zinc-500">Adjust turn</p>
              <h2 className="text-xl font-semibold text-zinc-950">
                {turnAdjustStaff.display_name}
              </h2>
              <p className="mt-1 text-sm text-zinc-600">
                Current canonical turn{" "}
                <span className="font-semibold text-zinc-950">
                  {turnAdjustStaff.turns.queueTurns ??
                    turnAdjustStaff.turns.largeTurns}
                </span>
              </p>
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <button
                className="min-h-12 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40"
                disabled={
                  (turnAdjustStaff.turns.queueTurns ??
                    turnAdjustStaff.turns.largeTurns) +
                    turnAdjustDelta <=
                  0
                }
                onClick={() =>
                  setTurnAdjustDelta((current) =>
                    Math.max(
                      -(turnAdjustStaff.turns.queueTurns ??
                        turnAdjustStaff.turns.largeTurns),
                      current - 1,
                    ),
                  )
                }
                type="button"
              >
                Minus one
              </button>
              <div className="grid min-w-24 justify-items-center rounded-md bg-zinc-50 px-3 py-2">
                <span className="text-xs font-semibold text-zinc-500">
                  Projected
                </span>
                <span className="text-3xl font-bold tabular-nums">
                  {Math.max(
                    0,
                    (turnAdjustStaff.turns.queueTurns ??
                      turnAdjustStaff.turns.largeTurns) + turnAdjustDelta,
                  )}
                </span>
              </div>
              <button
                className="min-h-12 rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white"
                onClick={() => setTurnAdjustDelta((current) => current + 1)}
                type="button"
              >
                Plus one
              </button>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-zinc-700">
                Manager
              </span>
              <select
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 text-sm"
                onChange={(event) =>
                  setTurnAdjustOperatorStaffId(event.target.value)
                }
                value={turnAdjustOperatorStaffId}
              >
                <option value="">Choose manager</option>
                {sortedStaff
                  .filter((member) => member.id !== turnAdjustStaff.id)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.display_name}
                    </option>
                  ))}
              </select>
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-zinc-700">
                Manager passcode
              </span>
              <input
                autoComplete="off"
                className="min-h-11 rounded-md border border-zinc-300 px-3 text-center text-lg font-semibold tracking-[0.2em]"
                inputMode="numeric"
                onChange={(event) =>
                  setTurnAdjustOperatorPasscode(event.target.value)
                }
                type="password"
                value={turnAdjustOperatorPasscode}
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium text-zinc-700">Reason</span>
              <textarea
                className="min-h-20 rounded-md border border-zinc-300 px-3 py-2 text-sm"
                onChange={(event) => setTurnAdjustReason(event.target.value)}
                value={turnAdjustReason}
              />
            </label>

            <p className="text-xs leading-5 text-amber-800">
              Use the approving manager&apos;s own staff passcode. Reset default
              passcodes in Staff Settings.
            </p>

            {turnAdjustError ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {turnAdjustError}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2">
              <button
                className="min-h-11 rounded-md border border-zinc-300 bg-white px-3 py-2 font-semibold"
                onClick={closeTurnAdjustment}
                type="button"
              >
                Cancel
              </button>
              <button
                className="min-h-11 rounded-md bg-zinc-950 px-3 py-2 font-semibold text-white disabled:bg-zinc-300"
                disabled={isPending || turnAdjustDelta === 0}
                onClick={submitTurnAdjustment}
                type="button"
              >
                {isPending ? "Confirming" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={rootClass} style={rootStyle}>
      <section className={panelClass} data-pos-receipt-panel>
        <div
          className={
            isPortableSurface
              ? "shrink-0 border-b border-zinc-200 pb-2"
              : "shrink-0 border-b border-zinc-200 pb-3"
          }
          data-pos-receipt-header
        >
          {isPortableSurface ? (
            <div className="flex min-w-0 items-center gap-2">
              {salonLogoUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={`${salonName} logo`}
                    className="h-9 w-9 shrink-0 rounded-md border border-zinc-200 object-cover"
                    src={salonLogoUrl}
                  />
                </>
              ) : (
                <span
                  aria-hidden="true"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-zinc-950 text-xs font-semibold text-white"
                >
                  {getSalonInitials(salonName)}
                </span>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">
                  {salonName}
                </p>
                <p className="text-[11px] font-medium leading-tight text-zinc-500">
                  {today ? `${today} / ` : null}
                  <ReceiptClock
                    className="text-[11px] font-medium leading-tight text-zinc-500"
                    timeOnly
                  />
                </p>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-lg font-semibold">{salonName}</p>
              <ReceiptClock />
            </div>
          )}
          {!liveDraft ? (
            <p className="mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Live draft is unavailable. Local POS still works.
            </p>
          ) : null}
        </div>

        <div
          className={
            isPortableSurface
              ? "shrink-0 space-y-2 border-b border-zinc-200 py-2"
              : "shrink-0 space-y-3 border-b border-zinc-200 py-3"
          }
        >
          <div className="flex items-center justify-between gap-2">
            <label className="block text-sm font-medium">Customer</label>
            <div className="relative shrink-0">
              {waitingButton}
            </div>
          </div>
          {selectedCustomer ? (
            <div className="flex items-center justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5">
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

        <div
          className={
            isPortableSurface
              ? "min-h-0 flex-1 overflow-auto py-2 pr-1"
              : "min-h-0 flex-1 space-y-2 overflow-auto py-3 pr-1"
          }
          data-pos-receipt-lines
        >
          {staffLines.length === 0 ? (
            <p className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
              No receipt lines yet.
            </p>
          ) : (
            staffLines.map((line, index) => {
              const member = staff.find((item) => item.id === line.staff_id);
              const serviceLabel = defaults.showServiceName
                ? line.service_label
                : `Service ${index + 1}`;
              const staffLabel = defaults.showStaffName
                ? (member?.display_name ?? "Assigned staff")
                : "Assigned";
              const quantity =
                line.amount_parts.length > 1 ? line.amount_parts.length : null;
              const rowTitle = `${staffLabel} - ${serviceLabel}${
                quantity ? ` x${quantity}` : ""
              }`;

              if (isPortableSurface) {
                return (
                  <div
                    className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b border-zinc-200 px-1 py-1.5 last:border-b-0"
                    data-pos-receipt-line
                    key={line.id}
                    title={`${rowTitle} ${formatMoney(line.amount)}`}
                  >
                    <button
                      className="min-w-0 rounded px-1 py-2 text-left transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                      data-pos-receipt-line-item
                      onClick={() => editLine(line)}
                      type="button"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-sm leading-none">
                        <span
                          className="truncate font-semibold text-zinc-950"
                          data-pos-receipt-line-staff
                        >
                          {staffLabel}
                        </span>
                        <span aria-hidden="true" className="shrink-0 text-zinc-400">
                          &middot;
                        </span>
                        <span
                          className="truncate text-zinc-600"
                          data-pos-receipt-line-service
                        >
                          {serviceLabel}
                        </span>
                        {quantity ? (
                          <span
                            className="shrink-0 text-xs font-semibold text-zinc-500"
                            data-pos-receipt-line-quantity
                          >
                            &times;{quantity}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <p
                      className="min-w-[5.25rem] text-right text-sm font-semibold tabular-nums text-zinc-950"
                      data-pos-receipt-line-price
                    >
                      {formatMoney(line.amount)}
                    </p>
                    <button
                      aria-label={`Remove ${rowTitle}`}
                      className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-lg font-semibold text-red-600 transition hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                      data-pos-receipt-line-remove
                      onClick={() => removeLine(line.id)}
                      type="button"
                    >
                      &times;
                    </button>
                  </div>
                );
              }

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
                        {serviceLabel}
                      </p>
                      <p className="text-sm text-zinc-600">
                        {staffLabel}
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

        <div
          className={
            isPortableSurface
              ? "shrink-0 space-y-1.5 border-t border-zinc-200 pt-2 text-sm"
              : "shrink-0 space-y-2 border-t border-zinc-200 pt-3 text-sm"
          }
          data-pos-receipt-totals
        >
          {isPortableSurface ? (
            <>
              {showSubtotalRow ? (
                <div className="flex justify-between text-zinc-500">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatMoney(totals.subtotal)}</span>
                </div>
              ) : null}
              {totals.discount_amount > 0 ? (
                <div
                  className="flex items-center justify-between gap-3 rounded-md px-1 py-1 text-zinc-500"
                  data-pos-receipt-adjustment="discount"
                >
                  <button
                    className="text-left font-medium"
                    disabled={receiptLocked}
                    onClick={() => focusReceiptMoneyInput("discount")}
                    type="button"
                  >
                    Discount
                  </button>
                  {keypadMode === "discount" ? (
                    <label className="flex min-w-0 items-center justify-end gap-1 font-semibold text-zinc-950">
                      {draft.discountType === "fixed_amount" ? <span>$</span> : null}
                      <input
                        className="w-20 bg-transparent text-right outline-none caret-emerald-700"
                        disabled={receiptLocked}
                        inputMode="decimal"
                        onChange={(event) =>
                          updateDraft({ discountInput: event.target.value })
                        }
                        ref={discountInputRef}
                        value={draft.discountInput}
                      />
                      {draft.discountType === "percentage" ? <span>%</span> : null}
                    </label>
                  ) : (
                    <button
                      className="font-semibold tabular-nums"
                      disabled={receiptLocked}
                      onClick={() => focusReceiptMoneyInput("discount")}
                      type="button"
                    >
                      {formatMoney(-totals.discount_amount)}
                    </button>
                  )}
                </div>
              ) : null}
              {totals.tax_amount !== 0 ? (
                <div
                  className="flex justify-between text-zinc-500"
                  data-pos-receipt-adjustment="tax"
                >
                  <span>Tax</span>
                  <span className="tabular-nums">{formatMoney(totals.tax_amount)}</span>
                </div>
              ) : null}
              {totals.tip_amount > 0 ? (
                <div
                  className="flex items-center justify-between gap-3 rounded-md px-1 py-1 text-zinc-500"
                  data-pos-receipt-adjustment="tip"
                >
                  <button
                    className="text-left font-medium"
                    disabled={receiptLocked}
                    onClick={() => focusReceiptMoneyInput("tip")}
                    type="button"
                  >
                    Tip
                  </button>
                  {keypadMode === "tip" ? (
                    <label className="flex min-w-0 items-center justify-end gap-1 font-semibold text-zinc-950">
                      <span>$</span>
                      <input
                        className="w-20 bg-transparent text-right outline-none caret-emerald-700"
                        disabled={receiptLocked}
                        inputMode="decimal"
                        onBlur={(event) => saveTipToSession(event.target.value)}
                        onChange={(event) =>
                          updateDraft({ tipInput: event.target.value })
                        }
                        ref={tipInputRef}
                        value={draft.tipInput}
                      />
                    </label>
                  ) : (
                    <button
                      className="font-semibold tabular-nums"
                      disabled={receiptLocked}
                      onClick={() => focusReceiptMoneyInput("tip")}
                      type="button"
                    >
                      {formatMoney(totals.tip_amount)}
                    </button>
                  )}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div
                className={[
                  "flex items-center justify-between gap-3 rounded-md px-1 py-1",
                  keypadMode === "discount" ? "bg-emerald-50" : "",
                ].join(" ")}
              >
                <button
                  className="text-left font-medium"
                  disabled={receiptLocked}
                  onClick={() => focusReceiptMoneyInput("discount")}
                  type="button"
                >
                  Discount
                </button>
                {keypadMode === "discount" ? (
                  <label className="flex min-w-0 items-center justify-end gap-1 font-semibold">
                    {draft.discountType === "fixed_amount" ? <span>$</span> : null}
                    <input
                      className="w-24 bg-transparent text-right outline-none caret-emerald-700"
                      disabled={receiptLocked}
                      inputMode="decimal"
                      onChange={(event) =>
                        updateDraft({ discountInput: event.target.value })
                      }
                      ref={discountInputRef}
                      value={draft.discountInput}
                    />
                    {draft.discountType === "percentage" ? <span>%</span> : null}
                  </label>
                ) : (
                  <button
                    className="font-semibold"
                    disabled={receiptLocked}
                    onClick={() => focusReceiptMoneyInput("discount")}
                    type="button"
                  >
                    {draft.discountType === "percentage" && draft.discountInput
                      ? `${draft.discountInput}%`
                      : formatMoney(totals.discount_amount)}
                  </button>
                )}
              </div>
              <div className="flex justify-between">
                <span>Tax</span>
                <span>{formatMoney(totals.tax_amount)}</span>
              </div>
              <div className="flex justify-between text-zinc-500">
                <span>Gift card</span>
                <span>{formatMoney(0)}</span>
              </div>
              <div
                className={[
                  "flex items-center justify-between gap-3 rounded-md px-1 py-1",
                  keypadMode === "tip" ? "bg-emerald-50" : "",
                ].join(" ")}
              >
                <button
                  className="text-left font-medium"
                  disabled={receiptLocked}
                  onClick={() => focusReceiptMoneyInput("tip")}
                  type="button"
                >
                  Tip
                </button>
                {keypadMode === "tip" ? (
                  <label className="flex min-w-0 items-center justify-end gap-1 font-semibold">
                    <span>$</span>
                    <input
                      className="w-24 bg-transparent text-right outline-none caret-emerald-700"
                      disabled={receiptLocked}
                      inputMode="decimal"
                      onBlur={(event) => saveTipToSession(event.target.value)}
                      onChange={(event) =>
                        updateDraft({ tipInput: event.target.value })
                      }
                      ref={tipInputRef}
                      value={draft.tipInput}
                    />
                  </label>
                ) : (
                  <button
                    className="font-semibold"
                    disabled={receiptLocked}
                    onClick={() => focusReceiptMoneyInput("tip")}
                    type="button"
                  >
                    {formatMoney(totals.tip_amount)}
                  </button>
                )}
              </div>
            </>
          )}
          <div
            className="flex items-end justify-between gap-3 border-t border-zinc-200 pt-2 text-xl font-semibold"
            data-pos-receipt-total
          >
            <span className="text-sm uppercase text-zinc-500">Total</span>
            <span className="text-2xl tabular-nums">{formatMoney(totals.total)}</span>
          </div>
          {!isPortableSurface ? (
            <textarea
              className="mt-2 w-full rounded border border-zinc-300 px-3 py-2"
              onChange={(event) => updateDraft({ note: event.target.value })}
              placeholder="Note"
              rows={2}
              value={draft.note}
            />
          ) : null}
          {defaults.adsFooter ? (
            <p className="text-xs text-zinc-500">{defaults.adsFooter}</p>
          ) : null}
        </div>
      </section>

      <section
        className={[
          "flex min-h-0 flex-col overflow-y-auto overflow-x-hidden rounded-lg border border-white/70 bg-white/80 shadow-[0_18px_46px_rgba(24,24,27,0.10)] backdrop-blur",
          isPortableSurface ? "p-3" : "p-4",
        ].join(" ")}
        data-pos-staff-turn-board
      >
        <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-zinc-950">
            Staff Turn Board
          </h2>
          <p className="rounded-full border border-teal-100 bg-teal-50/80 px-2.5 py-1 text-xs font-semibold text-teal-900">
            Large turn: {formatMoney(defaults.largeTurnThreshold)}
          </p>
        </div>
        <div className="grid max-h-[min(42dvh,390px)] min-h-0 shrink-0 grid-cols-[repeat(auto-fill,minmax(90px,104px))] content-start justify-start gap-2 overflow-y-auto overflow-x-hidden pr-1">
          {sortedStaff.map((member) => {
            const selected = draft.selectedStaffId === member.id;
            const unavailable =
              member.today_status === "checked_out" ||
              member.today_status === "auto_checked_out" ||
              member.today_status === "unavailable" ||
              !member.is_active;
            const staffTurnCount =
              member.turns.queueTurns ?? member.turns.largeTurns;
            const turnToneLevel = getStaffTurnToneLevel(
              staffTurnCount,
              staffTurnToneCounts,
            );
            const colorClass = getStaffCardToneClass(turnToneLevel, selected);
            const holdActive = turnHoldStaffId === member.id;
            const staffStatusLabel = member.today_status.replaceAll("_", " ");

            return (
              <button
                aria-label={`${member.display_name}, ${staffTurnCount} large turns, ${member.turns.smallTurns} small turns. ${staffStatusLabel}`}
                aria-pressed={selected}
                className={`relative aspect-square overflow-hidden rounded-lg border p-2 text-center transition duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(35,25,22,0.14)] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 ${colorClass} ${
                  unavailable ? "opacity-60" : ""
                }`}
                data-pos-staff-large-turns={staffTurnCount}
                data-pos-staff-tone={turnToneLevel}
                disabled={receiptLocked}
                key={member.id}
                onClick={() => handleStaffCardClick(member.id)}
                onContextMenu={(event) => {
                  if (adjustStaffTurnAction && isPortableSurface) {
                    event.preventDefault();
                    openTurnAdjustment(member);
                  }
                }}
                onKeyDown={(event) => handleStaffCardKeyDown(event, member)}
                onPointerCancel={handleStaffPointerEnd}
                onPointerDown={(event) => handleStaffPointerDown(event, member)}
                onPointerMove={handleStaffPointerMove}
                onPointerUp={handleStaffPointerEnd}
                type="button"
                title={`${member.display_name}: ${staffTurnCount} large turns, ${member.turns.smallTurns} small turns. ${staffStatusLabel}`}
              >
                {member.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover opacity-20"
                    src={member.avatar_url}
                  />
                ) : null}
                {holdActive ? (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-1 rounded-md opacity-95"
                    style={{
                      background: `conic-gradient(rgba(20, 184, 166, 0.72) ${Math.round(
                        turnHoldProgress * 360,
                      )}deg, transparent 0deg)`,
                    }}
                  />
                ) : null}
                <span className="relative z-10 block truncate text-[15px] font-semibold leading-tight">
                  {getFirstName(member.display_name)}
                </span>
                <span className="relative z-10 mt-1 block text-[34px] font-bold leading-none tabular-nums">
                  {member.turns.queueTurns ?? member.turns.largeTurns}
                </span>
                <span className="relative z-10 mt-1 block text-sm font-semibold leading-none opacity-80">
                  {member.turns.smallTurns}
                </span>
              </button>
            );
          })}
        </div>
        <div
          className="mt-3 shrink-0 border-t border-white/70 pt-3"
          data-pos-service-workspace
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-zinc-950">Services</h2>
            </div>
            <button
              className="min-h-8 shrink-0 rounded-lg border border-zinc-200 bg-white/70 px-2.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2"
              disabled={receiptLocked}
              onClick={() => {
                setShowServicePicker(true);
                setKeypadMode("amount");
              }}
              type="button"
            >
              {hasHiddenServiceTiles ? "More" : "Catalog"}
            </button>
          </div>

          {visibleServiceTiles.length > 0 ? (
            <div
              className="grid max-h-40 grid-cols-[repeat(auto-fill,minmax(96px,112px))] content-start justify-start gap-2 overflow-hidden"
              data-pos-service-tiles
              data-pos-requested-services={
                requestedServices.length > 0 ? "visible" : undefined
              }
            >
              {visibleServiceTiles.map((service) => {
                const entered = positiveStaffLines.some(
                  (line) => line.service_id === service.id,
                );
                const selected = draft.selectedServiceId === service.id;

                return (
                  <button
                    aria-pressed={selected}
                    className={[
                      "relative min-h-12 overflow-hidden rounded-lg border px-2.5 py-2 text-left text-sm font-semibold shadow-[0_9px_18px_rgba(35,25,22,0.08)] transition duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(242,111,61,0.13)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-offset-2",
                      selected
                        ? "border-brand-orange bg-gradient-to-br from-brand-orange-soft via-white/90 to-amber-50/90 text-zinc-950 ring-2 ring-brand-orange/25"
                        : entered
                          ? "border-zinc-200 bg-zinc-100/80 text-zinc-500 shadow-inner"
                          : service.requested
                            ? "border-brand-orange/35 bg-gradient-to-br from-brand-orange-soft/90 via-white/85 to-amber-50/85 text-zinc-950 hover:border-brand-orange/55"
                            : "border-brand-orange/25 bg-gradient-to-br from-[#fffaf7] via-white/85 to-brand-orange-soft/60 text-zinc-950 hover:border-brand-orange/45",
                    ].join(" ")}
                    data-pos-requested-service={
                      service.requested ? "true" : undefined
                    }
                    data-pos-service-tile
                    disabled={receiptLocked}
                    key={service.id}
                    onClick={() => selectService(service.id)}
                    type="button"
                  >
                    {selected ? (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-2 left-1.5 w-1 rounded-full bg-brand-orange"
                      />
                    ) : null}
                    <span className="block truncate pl-1.5 leading-tight">
                      {service.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg border border-zinc-200 bg-white/70 px-3 py-3 text-sm font-medium text-zinc-500">
              Service catalog empty. Custom price entry stays available.
            </p>
          )}

          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {hasHiddenServiceTiles ? (
              <button
                className="min-h-8 rounded-lg border border-zinc-200 bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2"
                data-pos-service-more
                disabled={receiptLocked}
                onClick={() => {
                  setShowServicePicker(true);
                  setKeypadMode("amount");
                }}
                type="button"
              >
                More
              </button>
            ) : null}
          </div>
          {unpricedRequestedServices.length > 0 ? (
            <p className="mt-2 truncate text-xs font-medium text-teal-800">
              Next requested: {unpricedRequestedServices[0].name}
            </p>
          ) : null}
        </div>
      </section>

      <section
        className={panelClass}
        data-pos-keypad-mode={keypadMode}
        data-pos-amount-panel
      >
        <div className="min-h-0 flex-1 overflow-auto pr-1">
          {draftRestored ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-sm font-medium text-amber-900">
              Unsaved POS draft saved on this device.
            </p>
          ) : null}
          {customerClaim && customerClaimUrl ? (
            <div className="mb-3 grid justify-items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-4 text-center shadow-sm">
              <div>
                <p className="text-sm font-bold text-emerald-950">
                  Save receipt & visit history to ReyLUMI
                </p>
                <p className="mt-1 text-xs font-medium text-emerald-800">
                  Scan with your phone to connect this visit.
                </p>
              </div>
              <QrCodeTile
                ariaLabel="Customer history claim QR code"
                className="aspect-square w-40 rounded-lg bg-white p-3 shadow-sm"
                dataKind="claim"
                fallbackMessage="Open the claim link on the customer's phone."
                valueToEncode={customerClaimUrl}
              />
              <a
                className="text-xs font-bold text-emerald-900 underline"
                href={customerClaim.claimPath}
                rel="noreferrer"
                target="_blank"
              >
                Open claim link
              </a>
            </div>
          ) : null}

          <div
            className="mb-3 rounded-lg border border-white/80 bg-gradient-to-br from-white/90 via-zinc-50/80 to-teal-50/60 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(24,24,27,0.08)]"
            data-pos-current-input
          >
            <p className="text-[11px] font-semibold uppercase text-zinc-500">
              Current input
            </p>
            <p className="mt-1 min-h-10 text-3xl font-semibold tabular-nums text-zinc-950">
              {keypadMode === "amount"
                ? draft.amountInput
                  ? `$${draft.amountInput}`
                  : "$0"
                : keypadMode === "tip"
                  ? `Tip ${draft.tipInput ? `$${draft.tipInput}` : "$0"}`
                  : keypadMode === "discount"
                    ? `Discount ${
                        draft.discountInput ? `$${draft.discountInput}` : "$0"
                      }`
                    : draft.customerLookup || "$0"}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "/"].map(
              (key) => (
                <button
                  className="min-h-14 rounded-lg border border-zinc-800 bg-gradient-to-b from-zinc-800 to-zinc-950 text-xl font-semibold text-white shadow-[0_10px_22px_rgba(24,24,27,0.18)] transition hover:-translate-y-0.5 active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2"
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
              className="min-h-12 rounded-lg border border-zinc-200 bg-white/75 font-semibold text-zinc-700 shadow-sm transition hover:bg-white active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2"
              disabled={receiptLocked}
              onClick={handleKeypadBack}
              type="button"
            >
              Back
            </button>
            <button
              className="min-h-12 rounded-lg border border-zinc-200 bg-white/75 font-semibold text-zinc-700 shadow-sm transition hover:bg-white active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2"
              data-pos-keypad-clear
              disabled={receiptLocked}
              onClick={handleKeypadClear}
              type="button"
            >
              Clear
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className={[
                "min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold shadow-sm transition active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2",
                keypadMode === "discount"
                  ? "border-teal-500 bg-teal-50 text-teal-950 ring-2 ring-teal-600/20"
                  : "border-zinc-200 bg-white/75 text-zinc-800 hover:bg-white",
              ].join(" ")}
              disabled={receiptLocked}
              onClick={() => focusReceiptMoneyInput("discount")}
              type="button"
            >
              Discount
            </button>
            <button
              className={[
                "min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold shadow-sm transition active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2",
                keypadMode === "tip"
                  ? "border-teal-500 bg-teal-50 text-teal-950 ring-2 ring-teal-600/20"
                  : "border-zinc-200 bg-white/75 text-zinc-800 hover:bg-white",
              ].join(" ")}
              disabled={receiptLocked}
              onClick={() => focusReceiptMoneyInput("tip")}
              type="button"
            >
              Tip
            </button>
          </div>

          <div className="mt-3 grid grid-cols-[auto_1fr] gap-3">
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-zinc-200 bg-white/75 text-sm shadow-sm">
              <button
                className={`px-3 py-2 font-semibold transition ${
                  draft.discountType === "fixed_amount"
                    ? "bg-zinc-950 text-white"
                    : "text-zinc-700 hover:bg-white"
                }`}
                onClick={() => {
                  updateDraft({ discountType: "fixed_amount" });
                  focusReceiptMoneyInput("discount");
                }}
                type="button"
              >
                $
              </button>
              <button
                className={`px-3 py-2 font-semibold transition ${
                  draft.discountType === "percentage"
                    ? "bg-zinc-950 text-white"
                    : "text-zinc-700 hover:bg-white"
                }`}
                onClick={() => {
                  updateDraft({ discountType: "percentage" });
                  focusReceiptMoneyInput("discount");
                }}
                type="button"
              >
                %
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {tipSuggestions.map((amount, index) => (
                <button
                  className="rounded-lg border border-zinc-200 bg-white/75 px-2 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition hover:bg-white active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2"
                  disabled={receiptLocked}
                  key={`${amount}-${index}`}
                  onClick={() => {
                    updateDraft({ tipInput: String(amount) });
                    focusReceiptMoneyInput("tip");
                    saveTipToSession(String(amount));
                  }}
                  type="button"
                >
                  ${amount}
                </button>
              ))}
            </div>
          </div>

          <button
            className="mt-3 min-h-10 w-full rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2 text-left text-sm font-medium text-zinc-500 shadow-inner"
            disabled
            onFocus={() => setKeypadMode("gift_card")}
            type="button"
          >
            Gift card
          </button>

          <div className="mt-4 grid grid-cols-[0.85fr_1.15fr] gap-2">
            <button
              className="rounded-lg border border-zinc-200 bg-white/80 px-3 py-3 font-semibold text-zinc-700 shadow-sm transition hover:bg-white active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2"
              disabled={isPending || isResetting || isSubmitting}
              onClick={cancelActiveSession}
              type="button"
            >
              {isResetting ? "Resetting" : "Reset"}
            </button>
            <button
              className="rounded-lg border border-brand-orange bg-gradient-to-b from-brand-orange via-[#ef5d28] to-brand-orange-hover px-3 py-3 font-bold text-white shadow-[0_16px_30px_rgba(242,111,61,0.28)] transition hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(242,111,61,0.34)] active:translate-y-px disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange focus-visible:ring-offset-2"
              disabled={isPending || isResetting || isSubmitting}
              onClick={submitReceipt}
              type="button"
            >
              {isSubmitting ? "Submitting" : "Submit"}
            </button>
          </div>
        </div>
      </section>
      </div>
    </>
  );
}

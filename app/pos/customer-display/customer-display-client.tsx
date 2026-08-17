"use client";

/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  confirmCustomerDisplayLiveDraftTip,
  getCustomerDisplayLiveDraftTipOptions,
  getPosLiveDraft,
  resetCustomerDisplayCompletedDraft,
  saveCustomerDisplayRequestedServices,
  searchCustomerDisplayLiveDraftCustomers,
  submitCustomerDisplayPhone,
  type CustomerDisplayPhoneResult,
  type CustomerDisplayTipOption,
} from "@/app/pos/actions";
import { QrCodeTile } from "@/components/qr-code-tile";
import {
  getPosLiveDraftRealtimeChannel,
  POS_LIVE_DRAFT_BROADCAST_EVENT,
  type PosLiveDraftBroadcastPayload,
} from "@/lib/pos-live-draft-realtime";
import {
  DEFAULT_CUSTOMER_DISPLAY_PROMO_SLIDE_URL,
  DEFAULT_CUSTOMER_DISPLAY_RECEIPT_BACKGROUND_URL,
} from "@/lib/pos-display-default-assets";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type {
  PosLiveDraftCustomer,
  PosLiveDraftView,
} from "@/types/pos-desk";
import type { CustomerVisitRequestedService } from "@/types/customer-visit";

type CustomerDisplaySettings = {
  appDownloadUrl: string;
  customerBackgroundImageUrl: string | null;
  customerLeftAdImageUrl: string | null;
  customerLeftAdText: string;
  customerPromoBody: string;
  customerPromoTitle: string;
  customerRightAdImageUrl: string | null;
  customerRightAdText: string;
  customerShowBarcode: boolean;
  customerShowCustomerName: boolean;
  customerShowReceiptStatus: boolean;
  customerShowSalonName: boolean;
  customerShowServiceName: boolean;
  customerShowStaffName: boolean;
  salonLogoUrl: string | null;
  salonName: string | null;
  tipSuggestions: number[];
};

type ConnectionState = "connected" | "connecting" | "reconnecting";
type DisplayMode =
  | "attract"
  | "checkin"
  | "completed"
  | "phone"
  | "profile"
  | "service_select"
  | "tip";
type TipOption = CustomerDisplayTipOption;
type CheckInState = Extract<CustomerDisplayPhoneResult, { mode: "check_in" }>;
type CustomerDisplayService = CustomerVisitRequestedService;

const CHECKIN_SUCCESS_RESET_MS = 5500;
const SLIDESHOW_INTERVAL_MS = 7000;

const PHONE_KEYPAD_STYLE = {
  "--customer-display-key-size": "clamp(80px, min(9.6vh, 6.8vw), 94px)",
  gridTemplateColumns: "repeat(3, var(--customer-display-key-size))",
} as CSSProperties;

const PHONE_KEY_BASE_STYLE = {
  aspectRatio: "1 / 1",
  border: "1px solid #e7e5e4",
  boxShadow: "0 10px 24px rgba(24, 24, 27, 0.08)",
  color: "#09090b",
  fontSize: "30px",
  fontVariantNumeric: "tabular-nums",
  height: "var(--customer-display-key-size)",
  touchAction: "manipulation",
  width: "var(--customer-display-key-size)",
} as CSSProperties;

const PHONE_DIGIT_KEY_STYLE = {
  ...PHONE_KEY_BASE_STYLE,
  backgroundColor: "#fafaf9",
} as CSSProperties;

const PHONE_SECONDARY_KEY_STYLE = {
  ...PHONE_KEY_BASE_STYLE,
  backgroundColor: "#f4f4f5",
  border: "1px solid #e4e4e7",
  boxShadow: "0 10px 22px rgba(24, 24, 27, 0.06)",
  color: "#27272a",
} as CSSProperties;

const PHONE_DISABLED_KEY_STYLE = {
  ...PHONE_KEY_BASE_STYLE,
  backgroundColor: "#f4f4f5",
  border: "1px solid #e4e4e7",
  boxShadow: "none",
  color: "#a1a1aa",
} as CSSProperties;

const RECEIPT_PANEL_STYLE = {
  gap: "clamp(8px, 1.2vh, 12px)",
  gridTemplateRows: "auto auto minmax(0, 1fr) auto auto",
  padding: "clamp(14px, 1.8vh, 20px)",
} as CSSProperties;

const RECEIPT_HEADER_STYLE = {
  paddingBottom: "clamp(8px, 1.2vh, 14px)",
} as CSSProperties;

const RECEIPT_TITLE_STYLE = {
  fontSize: "clamp(32px, 4.1vh, 48px)",
  lineHeight: "1.04",
} as CSSProperties;

const RECEIPT_TOTAL_STYLE = {
  fontSize: "clamp(30px, 3.9vh, 48px)",
  lineHeight: "1",
} as CSSProperties;

const RECEIPT_LINES_SECTION_STYLE = {
  gridTemplateRows: "auto minmax(0, 1fr)",
} as CSSProperties;

const RECEIPT_COLUMNS_STYLE = {
  gridTemplateColumns:
    "minmax(0, 1fr) clamp(108px, 10vw, 140px)",
} as CSSProperties;

const RECEIPT_COLUMN_HEADER_STYLE = {
  ...RECEIPT_COLUMNS_STYLE,
  minHeight: "32px",
} as CSSProperties;

const RECEIPT_LINE_REGION_STYLE = {
  alignContent: "start",
  gridAutoRows: "auto",
  overscrollBehaviorY: "contain",
  scrollbarWidth: "thin",
  WebkitOverflowScrolling: "touch",
} as CSSProperties;

const RECEIPT_LINE_ROW_STYLE = {
  ...RECEIPT_COLUMNS_STYLE,
  maxHeight: "54px",
  minHeight: "46px",
} as CSSProperties;

const RECEIPT_ITEM_TEXT_STYLE = {
  fontSize: "16px",
  lineHeight: "1.1",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as CSSProperties;

const RECEIPT_SUMMARY_STYLE = {
  gap: "6px",
  padding: "10px 16px",
} as CSSProperties;

const RECEIPT_FOOTER_STYLE = {
  paddingTop: "clamp(8px, 1.2vh, 14px)",
} as CSSProperties;

function formatMoney(amount: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function localPhoneKey(value: string | null | undefined) {
  const digits = digitsOnly(value ?? "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function formatPhoneDisplay(value: string) {
  const digits = digitsOnly(value).slice(0, 11);
  const localDigits = localPhoneKey(digits);
  const area = localDigits.slice(0, 3);
  const prefix = localDigits.slice(3, 6);
  const line = localDigits.slice(6, 10);

  if (line) {
    return `(${area}) ${prefix}-${line}`;
  }

  if (prefix) {
    return `(${area}) ${prefix}`;
  }

  if (area) {
    return `(${area}`;
  }

  return "";
}

function maskPhone(value: string | null | undefined) {
  const localDigits = localPhoneKey(value);
  const lastFour = localDigits.slice(-4);

  return lastFour ? `***-***-${lastFour}` : "Phone confirmed";
}

function isUsPhoneCandidate(value: string) {
  const digits = digitsOnly(value);
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

function getRequestId() {
  return crypto.randomUUID();
}

function getInitials(value: string | null | undefined) {
  const words = (value ?? "Salon")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  return (words.map((word) => word[0]).join("") || "S").toUpperCase();
}

function getFirstName(value: string | null | undefined) {
  return value?.trim().split(/\s+/).filter(Boolean)[0] ?? "";
}

function hasMeaningfulReceipt(liveDraft: PosLiveDraftView | null) {
  if (!liveDraft || liveDraft.status !== "draft") {
    return false;
  }

  return (
    liveDraft.staff_lines.length > 0 ||
    liveDraft.subtotal > 0 ||
    liveDraft.discount > 0 ||
    liveDraft.tax > 0 ||
    liveDraft.tip > 0 ||
    liveDraft.total > 0 ||
    liveDraft.total_before_tip > 0
  );
}

function isEmptyDraft(liveDraft: PosLiveDraftView | null) {
  return (
    Boolean(liveDraft) &&
    liveDraft?.status === "draft" &&
    !liveDraft.customer &&
    !hasMeaningfulReceipt(liveDraft)
  );
}

function getTipBase(liveDraft: PosLiveDraftView | null) {
  if (!liveDraft) {
    return 0;
  }

  if (liveDraft.total_before_tip > 0) {
    return liveDraft.total_before_tip;
  }

  return Math.max(0, liveDraft.total - liveDraft.tip);
}

function getTipOptions(settings: CustomerDisplaySettings, liveDraft: PosLiveDraftView | null) {
  const base = getTipBase(liveDraft);
  const percentages = settings.tipSuggestions
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(0, 3);
  const source = percentages.length > 0 ? percentages : [15, 18, 20];

  return source.map((percentage) => ({
    amount: roundMoney((base * percentage) / 100),
    percentage,
  }));
}

function serviceSummaryLabel(services: CustomerDisplayService[]) {
  return services.map((service) => service.name).join(" / ");
}

function FullscreenIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M8 4H4v4m12-4h4v4M8 20H4v-4m16 0v4h-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="m5 12 4 4L19 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
    </svg>
  );
}

function BackspaceIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24">
      <path
        d="M20 6H9l-6 6 6 6h11V6Zm-7 4 4 4m0-4-4 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

function FullscreenButton({
  hidden,
  onClick,
}: {
  hidden: boolean;
  onClick: () => void;
}) {
  if (hidden) {
    return null;
  }

  return (
    <button
      aria-label="Enter full view"
      className="absolute right-4 top-4 z-40 grid h-12 w-12 place-items-center rounded-lg border border-white/40 bg-white/90 text-zinc-800 shadow-lg backdrop-blur transition hover:bg-white"
      data-customer-display-fullscreen-button
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title="Full view"
      type="button"
    >
      <FullscreenIcon />
    </button>
  );
}

function SalonBrand({
  logoUrl,
  name,
  showName,
  tone = "light",
}: {
  logoUrl: string | null;
  name: string | null;
  showName: boolean;
  tone?: "dark" | "light";
}) {
  const displayName = name?.trim() || "Your salon";
  const isLight = tone === "light";

  return (
    <div className="flex min-w-0 items-center gap-3">
      <div
        className={[
          "grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border shadow-sm",
          isLight ? "border-white/30 bg-white/95" : "border-zinc-200 bg-white",
        ].join(" ")}
      >
        {logoUrl ? (
          <img
            alt={`${displayName} logo`}
            className="h-full w-full object-cover"
            src={logoUrl}
          />
        ) : (
          <span className="text-lg font-semibold text-teal-800">
            {getInitials(displayName)}
          </span>
        )}
      </div>
      {showName ? (
        <div className="min-w-0">
          <p
            className={[
              "truncate text-sm font-medium",
              isLight ? "text-white/70" : "text-zinc-500",
            ].join(" ")}
          >
            Welcome to
          </p>
          <p
            className={[
              "truncate text-2xl font-semibold leading-tight",
              isLight ? "text-white" : "text-zinc-950",
            ].join(" ")}
          >
            {displayName}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ReylumiCornerLogo({
  behindPanels = false,
}: {
  behindPanels?: boolean;
}) {
  return (
    <div
      className={[
        "pointer-events-none absolute",
        behindPanels ? "z-0 opacity-70" : "z-30 opacity-90",
      ].join(" ")}
      data-customer-display-reylumi-logo
      style={{
        bottom: "max(1rem, env(safe-area-inset-bottom))",
        right: "max(1rem, env(safe-area-inset-right))",
      }}
    >
      <img
        alt="Reylumi"
        className="h-auto w-24 object-contain drop-shadow-lg sm:w-28"
        src="/brand/reylumi-logo-horizontal.png"
      />
    </div>
  );
}

function AttractScreen({
  currentSlide,
  error,
  images,
  isFullscreen,
  onBegin,
  onFullscreen,
  settings,
}: {
  currentSlide: number;
  error: string | null;
  images: string[];
  isFullscreen: boolean;
  onBegin: () => void;
  onFullscreen: () => void;
  settings: CustomerDisplaySettings;
}) {
  const displayName = settings.salonName?.trim() || "Your salon";

  return (
    <section
      aria-label="Customer display attract screen"
      className="relative h-full w-full overflow-hidden bg-zinc-950 text-white"
      data-customer-display-attract
      onClick={onBegin}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onBegin();
        }
      }}
      role="button"
      tabIndex={0}
    >
      {images.map((imageUrl, index) => (
        <img
          alt=""
          aria-hidden="true"
          className={[
            "absolute inset-0 h-full w-full object-contain transition-opacity duration-1000",
            index === currentSlide % images.length ? "opacity-100" : "opacity-0",
          ].join(" ")}
          data-customer-display-ad-image={
            index === currentSlide % images.length ? "active" : undefined
          }
          key={`${imageUrl}-${index}`}
          src={imageUrl}
        />
      ))}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(9,9,11,0.62), rgba(9,9,11,0.18) 45%, rgba(9,9,11,0.72))",
        }}
      />

      <FullscreenButton hidden={isFullscreen} onClick={onFullscreen} />
      <ReylumiCornerLogo />

      <div
        className="relative z-10 grid h-full min-h-0 px-6 py-6 sm:px-8"
        style={{ gridTemplateRows: "auto minmax(0, 1fr) auto" }}
      >
        <header className="flex min-w-0 items-center justify-between gap-4 pr-14">
          <SalonBrand
            logoUrl={settings.salonLogoUrl}
            name={settings.salonName}
            showName={settings.customerShowSalonName}
            tone="light"
          />
        </header>

        <div className="grid min-h-0 place-items-center text-center">
          <div className="max-w-3xl">
            <p className="text-base font-semibold uppercase tracking-normal text-white/70">
              {displayName}
            </p>
            <h1 className="mt-4 text-5xl font-semibold leading-tight sm:text-6xl lg:text-7xl">
              Touch anywhere to begin
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-xl leading-8 text-white/82">
              {settings.customerRightAdText || settings.customerLeftAdText}
            </p>
            {error ? (
              <p className="mx-auto mt-5 max-w-xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex min-w-0 items-center justify-center gap-3 text-sm font-medium text-white/70">
          <span className="h-2 w-2 rounded-full bg-emerald-300" />
          <span>Ready for checkout</span>
        </footer>
      </div>
    </section>
  );
}

function PhoneKeypad({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const digits = digitsOnly(value);
  const digitKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const digitButtonClass =
    "grid shrink-0 select-none place-items-center rounded-full border border-stone-200 bg-stone-50 text-3xl font-semibold tabular-nums text-zinc-950 shadow-lg outline-none transition duration-150 active:translate-y-px active:scale-95 active:shadow-sm disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-300 focus-visible:border-teal-700 focus-visible:ring-4 focus-visible:ring-teal-700/20";
  const secondaryButtonClass =
    "grid shrink-0 select-none place-items-center rounded-full border border-zinc-200 bg-zinc-100 text-3xl font-semibold tabular-nums text-zinc-800 shadow-md outline-none transition duration-150 active:translate-y-px active:scale-95 active:shadow-sm disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-300 focus-visible:border-teal-700 focus-visible:ring-4 focus-visible:ring-teal-700/20";

  function appendDigit(digit: string) {
    if (disabled || digits.length >= 11) {
      return;
    }

    onChange(`${digits}${digit}`);
  }

  return (
    <div
      className="mx-auto grid justify-center gap-3"
      data-customer-display-keypad-panel
      style={PHONE_KEYPAD_STYLE}
    >
      {digitKeys.map((digit) => (
        <button
          aria-label={`Digit ${digit}`}
          className={digitButtonClass}
          disabled={disabled}
          key={digit}
          onClick={() => appendDigit(digit)}
          style={disabled ? PHONE_DISABLED_KEY_STYLE : PHONE_DIGIT_KEY_STYLE}
          type="button"
        >
          {digit}
        </button>
      ))}
      <button
        aria-label="Clear"
        className={secondaryButtonClass}
        disabled={disabled || digits.length === 0}
        onClick={() => onChange("")}
        style={
          disabled || digits.length === 0
            ? PHONE_DISABLED_KEY_STYLE
            : PHONE_SECONDARY_KEY_STYLE
        }
        type="button"
      >
        C
      </button>
      <button
        aria-label="Digit 0"
        className={digitButtonClass}
        disabled={disabled}
        onClick={() => appendDigit("0")}
        style={disabled ? PHONE_DISABLED_KEY_STYLE : PHONE_DIGIT_KEY_STYLE}
        type="button"
      >
        0
      </button>
      <button
        aria-label="Backspace"
        className={secondaryButtonClass}
        disabled={disabled || digits.length === 0}
        onClick={() => onChange(digits.slice(0, -1))}
        style={
          disabled || digits.length === 0
            ? PHONE_DISABLED_KEY_STYLE
            : PHONE_SECONDARY_KEY_STYLE
        }
        type="button"
      >
        <BackspaceIcon />
      </button>
    </div>
  );
}

function PhoneEntryPanel({
  customerResults,
  customerStatus,
  disabled,
  isCustomerPending,
  isSearching,
  onConfirmCustomer,
  onPhoneInput,
  onSkipToTip,
  onSubmitPhone,
  phoneInput,
  showTipShortcut,
}: {
  customerResults: PosLiveDraftCustomer[];
  customerStatus: string | null;
  disabled: boolean;
  isCustomerPending: boolean;
  isSearching: boolean;
  onConfirmCustomer: (customer: PosLiveDraftCustomer) => void;
  onPhoneInput: (value: string) => void;
  onSkipToTip: () => void;
  onSubmitPhone: () => void;
  phoneInput: string;
  showTipShortcut: boolean;
}) {
  const formattedPhone = formatPhoneDisplay(phoneInput);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) {
      return;
    }

    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      onPhoneInput(`${digitsOnly(phoneInput)}${event.key}`);
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      onPhoneInput(digitsOnly(phoneInput).slice(0, -1));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onSubmitPhone();
    }
  }

  return (
    <section
      className="flex h-full min-h-0 flex-col rounded-2xl border border-stone-200/80 bg-stone-50/95 p-5 shadow-2xl"
      data-customer-display-interaction-panel
      data-customer-display-phone
    >
      <div>
        <h2 className="text-3xl font-semibold leading-tight text-zinc-950">
          Enter your phone number
        </h2>
        <p className="mt-2 text-sm font-medium leading-6 text-zinc-500">
          We&apos;ll find your profile and keep your visit connected.
        </p>
      </div>

      <label className="mt-5 block">
        <span className="sr-only">Phone</span>
        <div
          className="grid min-h-16 items-center gap-3 rounded-2xl border border-stone-200 bg-white/85 px-4 shadow-inner transition focus-within:border-teal-700 focus-within:ring-4 focus-within:ring-teal-700/10"
          style={{ gridTemplateColumns: "minmax(0, 1fr) auto" }}
        >
          <input
            aria-label="Phone"
            autoFocus
            className="min-w-0 bg-transparent text-3xl font-semibold tabular-nums text-zinc-950 outline-none placeholder:text-zinc-400"
            disabled={disabled}
            inputMode="tel"
            onChange={(event) => onPhoneInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="(xxx) xxx-xxxx"
            readOnly
            value={formattedPhone}
          />
          <button
            aria-label="Confirm phone number"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-teal-700 text-white shadow-lg transition active:translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20"
            disabled={disabled || digitsOnly(phoneInput).length < 4}
            onClick={onSubmitPhone}
            type="button"
          >
            <CheckIcon />
          </button>
        </div>
      </label>

      <div className="mt-5 flex justify-center">
        <PhoneKeypad
          disabled={disabled || isCustomerPending}
          onChange={onPhoneInput}
          value={phoneInput}
        />
      </div>

      {showTipShortcut ? (
        <button
          className="mt-4 min-h-14 rounded-2xl bg-zinc-950 px-4 text-lg font-semibold text-white shadow-lg transition active:translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-950/20"
          disabled={disabled || isCustomerPending}
          onClick={onSkipToTip}
          type="button"
        >
          Tip
        </button>
      ) : null}

      <div className="mt-4 grid min-h-20 content-start gap-2">
        {isSearching ? (
          <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-600">
            Searching
          </p>
        ) : null}
        {customerStatus ? (
          <p className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-600">
            {customerStatus}
          </p>
        ) : null}
        {customerResults.length > 0 ? (
          <div className="grid gap-2">
            {customerResults.slice(0, 2).map((customer) => (
              <button
                className="min-h-12 rounded-lg border border-zinc-200 bg-white px-3 text-left transition hover:border-teal-400 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isCustomerPending || !customer.id}
                key={customer.id}
                onClick={() => onConfirmCustomer(customer)}
                type="button"
              >
                <span className="block truncate font-semibold text-zinc-950">
                  {getFirstName(customer.name) || "Guest"}
                </span>
                <span className="block text-sm text-zinc-500">
                  {maskPhone(customer.phone)}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function ProfileCreationPanel({
  customerStatus,
  disabled,
  isPending,
  nameInput,
  onBack,
  onNameInput,
  onSubmit,
  phone,
}: {
  customerStatus: string | null;
  disabled: boolean;
  isPending: boolean;
  nameInput: string;
  onBack: () => void;
  onNameInput: (value: string) => void;
  onSubmit: () => void;
  phone: string;
}) {
  const nameIsReady = nameInput.trim().length >= 2;

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <section
      className="grid h-full min-h-0 gap-4 rounded-2xl border border-stone-200/80 bg-stone-50/95 p-5 shadow-2xl"
      data-customer-display-create-profile
      data-customer-display-interaction-panel
      style={{ gridTemplateRows: "auto auto minmax(0, 1fr) auto" }}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase text-teal-700">
            New profile
          </p>
          <h2 className="mt-1 text-3xl font-semibold leading-tight text-zinc-950">
            Enter customer name
          </h2>
          <p className="mt-2 text-sm font-medium text-zinc-500">
            {maskPhone(phone)}
          </p>
        </div>
        <button
          className="min-h-11 shrink-0 rounded-xl border border-stone-200 bg-white/80 px-3 text-sm font-semibold text-zinc-700 shadow-sm transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/15"
          disabled={disabled || isPending}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
      </div>

      <label className="block">
        <span className="sr-only">Customer name</span>
        <input
          aria-label="Customer name"
          autoComplete="name"
          autoFocus
          className="min-h-16 w-full rounded-2xl border border-stone-200 bg-white/85 px-4 text-2xl font-semibold text-zinc-950 shadow-inner outline-none transition placeholder:text-zinc-400 focus:border-teal-700 focus:bg-white focus:ring-4 focus:ring-teal-700/10"
          disabled={disabled || isPending}
          maxLength={80}
          onChange={(event) => onNameInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="First and last name"
          value={nameInput}
        />
      </label>

      <div className="grid content-center gap-3">
        <p className="rounded-2xl border border-teal-700/10 bg-teal-50/80 px-4 py-3 text-sm font-medium leading-6 text-teal-900">
          We did not find this phone number. Create a profile to continue your
          visit.
        </p>
        {customerStatus ? (
          <p className="rounded-xl bg-white/80 px-3 py-2 text-sm font-medium text-zinc-600">
            {customerStatus}
          </p>
        ) : null}
      </div>

      <button
        className="min-h-14 rounded-2xl bg-teal-700 px-4 font-semibold text-white shadow-lg transition active:translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20"
        disabled={disabled || isPending || !nameIsReady}
        onClick={onSubmit}
        type="button"
      >
        {isPending ? "Creating" : "Continue"}
      </button>
    </section>
  );
}

function MoneyKeypad({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: string) => void;
  value: string;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  const buttonClass =
    "grid min-h-14 place-items-center rounded-lg border border-zinc-200 bg-white text-xl font-semibold text-zinc-950 transition hover:border-teal-400 hover:bg-teal-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-300";

  function appendDigit(digit: string) {
    if (disabled || value.length >= 6) {
      return;
    }

    onChange(`${value}${digit}`);
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map((digit) => (
        <button
          aria-label={`Custom tip digit ${digit}`}
          className={buttonClass}
          disabled={disabled}
          key={digit}
          onClick={() => appendDigit(digit)}
          type="button"
        >
          {digit}
        </button>
      ))}
      <button
        aria-label="Clear custom tip"
        className={buttonClass}
        disabled={disabled || value.length === 0}
        onClick={() => onChange("")}
        type="button"
      >
        C
      </button>
      <button
        aria-label="Custom tip digit 0"
        className={buttonClass}
        disabled={disabled}
        onClick={() => appendDigit("0")}
        type="button"
      >
        0
      </button>
      <button
        aria-label="Delete custom tip digit"
        className={buttonClass}
        disabled={disabled || value.length === 0}
        onClick={() => onChange(value.slice(0, -1))}
        type="button"
      >
        <BackspaceIcon />
      </button>
    </div>
  );
}

function TipPanel({
  confirmedPhone,
  customTipInput,
  customTipMode,
  identityLabel,
  isTipPending,
  liveDraft,
  onChangeCustomer,
  onConfirmTip,
  onCustomTipInput,
  onSetCustomTipMode,
  tipOptions,
}: {
  confirmedPhone: string | null;
  customTipInput: string;
  customTipMode: boolean;
  identityLabel: string;
  isTipPending: boolean;
  liveDraft: PosLiveDraftView | null;
  onChangeCustomer: () => void;
  onConfirmTip: (amount: number) => void;
  onCustomTipInput: (value: string) => void;
  onSetCustomTipMode: (value: boolean) => void;
  tipOptions: TipOption[];
}) {
  const baseTotal = getTipBase(liveDraft);
  const selectedTip = liveDraft?.tip ?? 0;
  const isActiveCheckout = liveDraft?.status === "draft";
  const customTipAmount = roundMoney(Number(customTipInput || 0));
  const disabled = !isActiveCheckout || isTipPending;

  return (
    <section
      className="grid h-full min-h-0 gap-4 rounded-2xl border border-stone-200/80 bg-stone-50/95 p-5 shadow-2xl"
      data-customer-display-interaction-panel
      data-customer-display-tip
      style={{ gridTemplateRows: "auto auto minmax(0, 1fr) auto" }}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold uppercase text-teal-700">
            Customer
          </p>
          <h2 className="mt-1 break-words text-2xl font-semibold leading-tight text-zinc-950">
            {identityLabel}
          </h2>
          {confirmedPhone ? (
            <p className="mt-1 text-sm text-zinc-500">{maskPhone(confirmedPhone)}</p>
          ) : null}
        </div>
        <button
          className="min-h-11 shrink-0 rounded-xl border border-stone-200 bg-white/80 px-3 text-sm font-semibold text-zinc-700 shadow-sm transition active:translate-y-px focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/15"
          onClick={onChangeCustomer}
          type="button"
        >
          Change
        </button>
      </div>

      <div className="rounded-2xl border border-stone-200 bg-white/82 px-4 py-3 shadow-inner">
        <p className="text-sm font-medium text-zinc-600">Current total</p>
        <p className="mt-1 text-3xl font-semibold text-zinc-950">
          {formatMoney(liveDraft?.total ?? 0)}
        </p>
      </div>

      {customTipMode ? (
        <div
          className="grid min-h-0 gap-3"
          style={{ gridTemplateRows: "auto minmax(0, 1fr)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase text-zinc-500">
                Custom tip
              </p>
              <p className="text-3xl font-semibold text-zinc-950">
                {formatMoney(customTipAmount)}
              </p>
            </div>
            <button
              className="min-h-11 rounded-xl border border-stone-200 bg-white/80 px-3 text-sm font-semibold text-zinc-700"
              onClick={() => onSetCustomTipMode(false)}
              type="button"
            >
              Back
            </button>
          </div>
          <MoneyKeypad
            disabled={disabled}
            onChange={onCustomTipInput}
            value={customTipInput}
          />
        </div>
      ) : (
        <div className="grid min-h-0 content-center gap-3">
          <p className="text-sm font-medium text-zinc-600">
            100% goes to your service team
          </p>
          <div className="grid grid-cols-3 gap-2">
            {tipOptions.map((option) => {
              const selected = selectedTip === option.amount && option.amount > 0;

              return (
              <button
                className={[
                    "grid min-h-20 place-items-center rounded-2xl border px-2 text-center shadow-sm transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
                    selected
                      ? "border-teal-700 bg-teal-50 text-zinc-950"
                      : "border-stone-200 bg-white/90 text-zinc-950 hover:border-teal-400",
                  ].join(" ")}
                  disabled={disabled || baseTotal <= 0}
                  key={option.percentage}
                  onClick={() => onConfirmTip(option.amount)}
                  type="button"
                >
                  <span className="text-2xl font-semibold">
                    {option.percentage}%
                  </span>
                  <span className="text-sm font-medium text-zinc-500">
                    {formatMoney(option.amount)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="min-h-14 rounded-2xl border border-stone-200 bg-white/90 px-3 font-semibold text-zinc-800 shadow-sm transition active:translate-y-px hover:border-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onClick={() => onSetCustomTipMode(true)}
              type="button"
            >
              Custom tip
            </button>
            <button
              className="min-h-14 rounded-2xl border border-stone-200 bg-white/90 px-3 font-semibold text-zinc-800 shadow-sm transition active:translate-y-px hover:border-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onClick={() => onConfirmTip(0)}
              type="button"
            >
              No tip
            </button>
          </div>
        </div>
      )}

      <button
        className="min-h-14 rounded-2xl bg-teal-700 px-4 font-semibold text-white shadow-lg transition active:translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20"
        disabled={disabled}
        onClick={() => onConfirmTip(customTipMode ? customTipAmount : selectedTip)}
        type="button"
      >
        {isTipPending ? "Saving" : customTipMode ? "Apply custom tip" : "Confirm tip"}
      </button>
    </section>
  );
}

function safeAppDownloadUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function CustomerAppDownloadCard({ appDownloadUrl }: { appDownloadUrl: string }) {
  return (
    <aside
      className="grid w-[clamp(132px,13vw,156px)] justify-items-center gap-1.5 rounded-2xl border border-stone-200 bg-white/86 p-2.5 text-center shadow-inner"
      data-customer-display-download-card
      data-customer-display-download-url={appDownloadUrl}
    >
      <div className="flex items-center gap-1.5">
        <img
          alt=""
          aria-hidden="true"
          className="h-5 w-5 shrink-0"
          src="/brand/reylumi-favicon.png"
        />
        <p className="text-sm font-semibold leading-tight text-zinc-950">
          Get Reylumi
        </p>
      </div>
      <QrCodeTile
        ariaLabel="Reylumi app download QR code"
        className="aspect-square w-[clamp(88px,8vw,108px)] rounded-lg bg-white p-2 shadow-sm"
        dataKind="download"
        fallbackClassName="grid aspect-square w-[clamp(88px,8vw,108px)] place-items-center rounded-lg border border-dashed border-zinc-300 bg-white p-2 text-center text-[10px] font-medium text-zinc-500"
        fallbackMessage="Download link is too long."
        valueToEncode={appDownloadUrl}
      />
      <p className="text-[11px] font-medium leading-tight text-zinc-500">
        Scan to download the app.
      </p>
    </aside>
  );
}

function TransactionSummary({
  connectionState,
  displayMode,
  identityLabel,
  liveDraft,
  settings,
}: {
  connectionState: ConnectionState;
  displayMode: DisplayMode;
  identityLabel: string;
  liveDraft: PosLiveDraftView | null;
  settings: CustomerDisplaySettings;
}) {
  const lines = liveDraft?.staff_lines ?? [];
  const appDownloadUrl = safeAppDownloadUrl(settings.appDownloadUrl);
  const showAppDownloadCard = displayMode === "tip" && Boolean(appDownloadUrl);
  const showWaiting = !hasMeaningfulReceipt(liveDraft);
  const connectionLabel =
    connectionState === "connected"
      ? "Connected"
      : connectionState === "connecting"
        ? "Connecting"
        : "Reconnecting";
  const statusLabel =
    displayMode === "tip"
      ? "Ready for tip"
      : displayMode === "checkin"
        ? "Checked in"
      : displayMode === "profile"
        ? "Creating profile"
        : connectionLabel;
  const neutralWelcomeLabel = settings.salonName?.trim()
    ? `Welcome to ${settings.salonName.trim()}`
    : "Welcome";
  const showReceiptIdentity = identityLabel !== neutralWelcomeLabel;

  return (
    <section
      className="grid h-full min-h-0 rounded-2xl border border-stone-200/80 bg-stone-50/95 shadow-2xl"
      data-customer-display-summary
      style={RECEIPT_PANEL_STYLE}
    >
      <header className="min-w-0">
        <SalonBrand
          logoUrl={settings.salonLogoUrl}
          name={settings.salonName}
          showName={settings.customerShowSalonName}
          tone="dark"
        />
      </header>

      <div
        className="flex min-w-0 items-end justify-between gap-4 border-b border-stone-200"
        style={RECEIPT_HEADER_STYLE}
      >
        <div className="min-w-0">
          {showReceiptIdentity ? (
            <p className="truncate text-lg font-semibold text-zinc-700">
              {identityLabel}
            </p>
          ) : null}
          <h1
            className="mt-1 text-4xl font-semibold text-zinc-950 lg:text-5xl"
            style={RECEIPT_TITLE_STYLE}
          >
            Your Receipt
          </h1>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold uppercase tracking-normal text-zinc-500">
            Current total
          </p>
          <p
            className="mt-1 text-4xl font-semibold text-teal-800 lg:text-5xl"
            style={RECEIPT_TOTAL_STYLE}
          >
            {formatMoney(liveDraft?.total ?? 0)}
          </p>
        </div>
      </div>

      <div
        className="grid min-h-0 gap-0"
        data-customer-display-receipt-section
        style={RECEIPT_LINES_SECTION_STYLE}
      >
        <div
          className="grid items-center gap-3 border-b border-stone-200 text-xs font-semibold uppercase text-zinc-500"
          data-customer-display-receipt-column-header
          style={RECEIPT_COLUMN_HEADER_STYLE}
        >
          <span>Item</span>
          <span className="text-right">Amount</span>
        </div>

        {showWaiting ? (
          <div
            className="grid min-h-0 place-items-center overflow-y-auto px-4 text-center"
            data-customer-display-empty-receipt
            style={RECEIPT_LINE_REGION_STYLE}
          >
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white/72 px-5 py-4">
              <p className="text-lg font-semibold text-zinc-600">
                Waiting for services
              </p>
              <p className="mt-1 text-sm font-medium text-zinc-500">
                Your receipt will update automatically.
              </p>
            </div>
          </div>
        ) : (
          <div
            className="grid min-h-0 overflow-y-auto pr-1"
            data-customer-display-receipt-lines
            style={RECEIPT_LINE_REGION_STYLE}
          >
            {lines.map((line, index) => {
              const quantity = Math.max(1, line.amountParts?.length ?? 0);
              const label = settings.customerShowServiceName
                ? line.label
                : `Service ${index + 1}`;
              const staffLabel = settings.customerShowStaffName
                ? line.staffName
                : "";
              const itemTitle = [label, staffLabel].filter(Boolean).join(" - ");

              return (
                <div
                  className="grid flex-none items-center gap-3 border-b border-stone-200/75 px-2 py-1.5 last:border-b-0"
                  data-customer-display-receipt-line
                  key={line.id}
                  style={RECEIPT_LINE_ROW_STYLE}
                  title={`${itemTitle} ${formatMoney(line.amount)}`}
                >
                  <p
                    className="min-w-0 font-semibold text-zinc-950"
                    data-customer-display-receipt-item
                    style={RECEIPT_ITEM_TEXT_STYLE}
                  >
                    <span data-customer-display-receipt-service>
                      {label}
                    </span>
                    {staffLabel ? (
                      <>
                        <span aria-hidden="true" className="text-zinc-400">
                          {" "}
                          &middot;{" "}
                        </span>
                        <span
                          className="font-medium text-zinc-500"
                          data-customer-display-receipt-staff
                        >
                          {staffLabel}
                        </span>
                      </>
                    ) : null}
                    {quantity > 1 ? (
                      <span
                        className="font-semibold text-zinc-500"
                        data-customer-display-receipt-quantity
                      >
                        {" "}
                        &times;{quantity}
                      </span>
                    ) : null}
                  </p>
                  <p
                    className="text-right text-base font-semibold tabular-nums text-zinc-950"
                    data-customer-display-receipt-amount
                  >
                    {formatMoney(line.amount)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={
          showAppDownloadCard
            ? "grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto]"
            : "grid"
        }
        data-customer-display-receipt-lower
      >
        <div
          className="grid gap-1 rounded-2xl border border-stone-200 bg-white/82 text-sm font-semibold text-zinc-700 shadow-inner"
          data-customer-display-totals
          style={RECEIPT_SUMMARY_STYLE}
        >
          <div className="flex items-center justify-between gap-4">
            <span>Subtotal</span>
            <span>{formatMoney(liveDraft?.subtotal ?? 0)}</span>
          </div>
          {liveDraft?.discount ? (
            <div className="flex items-center justify-between gap-4 text-zinc-500">
              <span>Discount</span>
              <span>-{formatMoney(liveDraft.discount)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-4 text-zinc-500">
            <span>Tax</span>
            <span>{formatMoney(liveDraft?.tax ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-zinc-500">
            <span>Tip</span>
            <span>{formatMoney(liveDraft?.tip ?? 0)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-4 border-t border-stone-200 pt-2 text-lg text-teal-800">
            <span>Total</span>
            <span>{formatMoney(liveDraft?.total ?? 0)}</span>
          </div>
        </div>
        {showAppDownloadCard && appDownloadUrl ? (
          <CustomerAppDownloadCard appDownloadUrl={appDownloadUrl} />
        ) : null}
      </div>

      <footer
        className="flex min-w-0 items-center justify-between gap-4 border-t border-stone-200"
        style={RECEIPT_FOOTER_STYLE}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-zinc-500">
          <img
            alt=""
            aria-hidden="true"
            className="h-5 w-auto shrink-0"
            src="/brand/reylumi-favicon.png"
          />
          <span className="truncate">Secure checkout by Reylumi</span>
        </span>
        {settings.customerShowReceiptStatus ? (
          <span className="shrink-0 rounded-xl border border-teal-700/10 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800">
            {statusLabel}
          </span>
        ) : null}
      </footer>
    </section>
  );
}

function CheckoutShell({
  backgroundImageUrl,
  children,
  connectionState,
  displayMode,
  error,
  identityLabel,
  liveDraft,
  settings,
}: {
  backgroundImageUrl: string;
  children: React.ReactNode;
  connectionState: ConnectionState;
  displayMode: DisplayMode;
  error: string | null;
  identityLabel: string;
  liveDraft: PosLiveDraftView | null;
  settings: CustomerDisplaySettings;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-stone-100">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center opacity-58"
        data-customer-display-receipt-background
        style={{ backgroundImage: `url(${backgroundImageUrl})` }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.74), rgba(240,253,250,0.58) 48%, rgba(255,247,237,0.56))",
        }}
      />
      <ReylumiCornerLogo behindPanels />
      <div className="relative z-10 grid h-full place-items-center px-4 py-4 sm:px-6 sm:py-6">
        <div
          className="grid h-full max-h-[880px] min-h-0 w-full max-w-[1280px] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,430px)]"
          data-customer-display-checkout
        >
          <TransactionSummary
            connectionState={connectionState}
            displayMode={displayMode}
            identityLabel={identityLabel}
            liveDraft={liveDraft}
            settings={settings}
          />
          <div className="min-h-0">{children}</div>
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 lg:col-span-2">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CheckInShell({
  backgroundImageUrl,
  children,
  error,
  isFullscreen,
  onFullscreen,
  settings,
}: {
  backgroundImageUrl: string;
  children: React.ReactNode;
  error: string | null;
  isFullscreen: boolean;
  onFullscreen: () => void;
  settings: CustomerDisplaySettings;
}) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-stone-100">
      <img
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover opacity-100"
        data-customer-display-checkin-background
        src={backgroundImageUrl}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.82), rgba(240,253,250,0.7) 50%, rgba(255,247,237,0.58))",
        }}
      />
      <FullscreenButton hidden={isFullscreen} onClick={onFullscreen} />
      <ReylumiCornerLogo behindPanels />
      <div
        className="relative z-10 grid h-full min-h-0 px-4 py-4 sm:px-6 sm:py-6"
        data-customer-display-checkin-shell
        style={{ gridTemplateRows: "auto minmax(0, 1fr) auto" }}
      >
        <header className="flex min-w-0 items-center justify-between gap-4 pr-14">
          <SalonBrand
            logoUrl={settings.salonLogoUrl}
            name={settings.salonName}
            showName={settings.customerShowSalonName}
            tone="dark"
          />
        </header>

        <div className="grid min-h-0 place-items-center py-3">
          <div className="h-full min-h-0 w-full max-w-3xl">{children}</div>
        </div>

        {error ? (
          <p className="mx-auto max-w-3xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

function CompletedScreen({
  backgroundImageUrl,
  isFullscreen,
  liveDraft,
  onReset,
  onFullscreen,
  resetSeconds,
}: {
  backgroundImageUrl: string;
  isFullscreen: boolean;
  liveDraft: PosLiveDraftView | null;
  onReset: () => void;
  onFullscreen: () => void;
  resetSeconds: number | null;
}) {
  const firstName = getFirstName(liveDraft?.customer?.name);
  const nameLabel = firstName ? `, ${firstName}` : "";

  return (
    <section
      className="relative grid h-full w-full place-items-center overflow-hidden bg-stone-50 px-6 text-center text-zinc-950"
      data-customer-display-completed
      onClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onReset();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <img
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover opacity-100"
        src={backgroundImageUrl}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-br from-white/70 via-white/58 to-orange-50/48"
      />
      <FullscreenButton hidden={isFullscreen} onClick={onFullscreen} />
      <ReylumiCornerLogo />
      <div className="relative z-10 max-w-3xl">
        <p className="text-base font-semibold uppercase text-teal-800">
          Payment complete
        </p>
        <h1 className="mt-4 text-6xl font-semibold leading-tight lg:text-7xl">
          Thank you{nameLabel}!
        </h1>
        <p className="mt-5 text-3xl font-semibold text-zinc-950">
          Final total {formatMoney(liveDraft?.total ?? 0)}
        </p>
        <p className="mx-auto mt-5 max-w-2xl text-xl leading-8 text-zinc-800">
          We appreciate your visit. Please see our team if you need anything else.
        </p>
        <p className="mt-6 text-sm font-semibold uppercase text-teal-800">
          Tap to continue
        </p>
        {resetSeconds !== null ? (
          <p className="mt-6 text-sm font-medium text-zinc-600">
            Resetting in {resetSeconds}s
          </p>
        ) : null}
      </div>
    </section>
  );
}

function CheckInConfirmationPanel({
  checkIn,
}: {
  checkIn: CheckInState;
}) {
  const firstName = checkIn.visit.firstName ?? "Guest";
  const requestedServices = checkIn.visit.requestedServices;
  const requestedServiceLabel = serviceSummaryLabel(requestedServices);
  const title =
    checkIn.state === "already_checked_in"
      ? "You are already checked in"
      : "You are checked in";
  const sourceLabel =
    checkIn.visit.source === "appointment"
      ? "Appointment"
      : checkIn.visit.source === "walk_in"
        ? "Walk-in"
        : "Customer screen";

  return (
    <section
      className="grid h-full min-h-0 content-center gap-5 rounded-2xl border border-stone-200/80 bg-stone-50/95 p-5 text-center shadow-2xl"
      data-customer-display-checkin
    >
      <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-teal-700 text-white shadow-lg">
        <CheckIcon />
      </div>
      <div>
        <p className="text-sm font-semibold uppercase text-teal-700">
          {sourceLabel}
        </p>
        <h2 className="mt-2 text-4xl font-semibold leading-tight text-zinc-950">
          {title}
        </h2>
        <p className="mt-3 text-2xl font-semibold text-zinc-800">
          Thanks, {firstName}.
        </p>
      </div>
      <p className="mx-auto max-w-sm text-base font-medium leading-7 text-zinc-600">
        {requestedServiceLabel || "Our team has your arrival."}
      </p>
      {requestedServiceLabel ? (
        <p className="mx-auto max-w-sm text-base font-medium leading-7 text-zinc-600">
          We&apos;ll be with you shortly.
        </p>
      ) : null}
    </section>
  );
}

function ServiceSelectionPanel({
  checkIn,
  disabled,
  onBack,
  onSubmit,
  selectedServiceIds,
  services,
  toggleService,
}: {
  checkIn: CheckInState;
  disabled: boolean;
  onBack: () => void;
  onSubmit: () => void;
  selectedServiceIds: string[];
  services: CustomerDisplayService[];
  toggleService: (serviceId: string) => void;
}) {
  const selectedSet = new Set(selectedServiceIds);
  const firstName = checkIn.visit.firstName ?? "Guest";

  return (
    <section
      className="grid h-full min-h-0 gap-3 rounded-lg border border-white/70 bg-stone-50/90 p-4 shadow-2xl backdrop-blur"
      data-customer-display-service-select
      style={{ gridTemplateRows: "auto minmax(0, 1fr) auto" }}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase text-teal-700">
            Check in
          </p>
          <h2 className="mt-1 text-2xl font-semibold leading-tight text-zinc-950">
            What are you here for?
          </h2>
          <p className="mt-1 text-sm font-medium leading-6 text-zinc-500">
            Thanks, {firstName}. Select any services you&apos;d like today.
          </p>
        </div>
        <button
          className="min-h-10 shrink-0 rounded-lg border border-stone-200 bg-white/80 px-3 text-sm font-semibold text-zinc-700 shadow-sm transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20"
          disabled={disabled}
          onClick={onBack}
          type="button"
        >
          Back
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto pr-1">
        <div
          className="grid gap-2 sm:grid-cols-2 md:grid-cols-3"
          data-customer-display-service-grid
        >
          {services.map((service) => {
            const selected = selectedSet.has(service.id);
            const meta = [
              service.category,
              service.durationMinutes ? `${service.durationMinutes} min` : null,
            ]
              .filter(Boolean)
              .join(" / ");

            return (
              <button
                aria-pressed={selected}
                className={[
                  "relative grid min-h-[76px] content-between overflow-hidden rounded-lg border px-3 py-2.5 text-left shadow-[0_10px_22px_rgba(35,25,22,0.08)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(242,111,61,0.12)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-orange/20",
                  selected
                    ? "border-brand-orange bg-gradient-to-br from-brand-orange-soft via-white to-amber-50 text-zinc-950 ring-2 ring-brand-orange/25"
                    : "border-brand-orange/25 bg-gradient-to-br from-[#fffaf7] via-white/90 to-brand-orange-soft/55 text-zinc-950 hover:border-brand-orange/45",
                ].join(" ")}
                data-customer-display-service-card
                disabled={disabled}
                key={service.id}
                onClick={() => toggleService(service.id)}
                type="button"
              >
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-2 left-1.5 w-1 rounded-full bg-brand-orange"
                  />
                ) : null}
                <span className="block truncate pl-1.5 text-base font-semibold leading-tight">
                  {service.name}
                </span>
                {meta ? (
                  <span className="mt-1 block truncate pl-1.5 text-xs font-medium text-zinc-500">
                    {meta}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <button
        className="min-h-[52px] rounded-lg bg-teal-700 px-4 py-3 text-lg font-semibold text-white shadow-lg transition active:translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-700/20"
        disabled={disabled}
        onClick={onSubmit}
        type="button"
      >
        {disabled ? "Saving" : "Check in"}
      </button>
    </section>
  );
}

export function CustomerDisplayClient({
  serviceCatalog,
  settings,
  token,
}: {
  serviceCatalog: CustomerDisplayService[];
  settings: CustomerDisplaySettings;
  token: string;
}) {
  const [liveDraft, setLiveDraft] = useState<PosLiveDraftView | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [phoneInput, setPhoneInput] = useState("");
  const [confirmedPhone, setConfirmedPhone] = useState<string | null>(null);
  const [guestConfirmed, setGuestConfirmed] = useState(false);
  const [isChangingCustomer, setIsChangingCustomer] = useState(false);
  const [createCustomerMode, setCreateCustomerMode] = useState(false);
  const [customerNameInput, setCustomerNameInput] = useState("");
  const [newCustomerKey, setNewCustomerKey] = useState<string | null>(null);
  const [checkInState, setCheckInState] = useState<CheckInState | null>(null);
  const [serviceSelectionState, setServiceSelectionState] =
    useState<CheckInState | null>(null);
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [customerResults, setCustomerResults] = useState<PosLiveDraftCustomer[]>(
    [],
  );
  const [customerStatus, setCustomerStatus] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isCustomerPending, setIsCustomerPending] = useState(false);
  const [isServicePending, setIsServicePending] = useState(false);
  const [customTipInput, setCustomTipInput] = useState("");
  const [customTipMode, setCustomTipMode] = useState(false);
  const [isTipPending, setIsTipPending] = useState(false);
  const [resetSeconds, setResetSeconds] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [serverTipOptions, setServerTipOptions] = useState<TipOption[] | null>(
    null,
  );
  const lastSubmittedPhoneRef = useRef("");
  const liveDraftRef = useRef<PosLiveDraftView | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const serverOffsetRef = useRef(0);
  const lastCustomerInteractionServerMsRef = useRef<number | null>(null);
  const versionRef = useRef<number | null>(null);
  const completedResetInFlightRef = useRef(false);

  const attractImages = useMemo(
    () => [
      settings.customerLeftAdImageUrl ??
        DEFAULT_CUSTOMER_DISPLAY_PROMO_SLIDE_URL,
    ],
    [settings.customerLeftAdImageUrl],
  );
  const backgroundImageUrl =
    settings.customerBackgroundImageUrl ??
    DEFAULT_CUSTOMER_DISPLAY_RECEIPT_BACKGROUND_URL;
  const liveDraftCustomer = liveDraft?.customer;
  const liveDraftResetAt = liveDraft?.reset_at;
  const liveDraftStatus = liveDraft?.status;
  const checkInFirstName = checkInState?.visit.firstName ?? null;
  const selectableServiceIds = useMemo(
    () => new Set(serviceCatalog.map((service) => service.id)),
    [serviceCatalog],
  );
  const phoneDigits = digitsOnly(phoneInput);
  const currentServerMs = nowMs + serverOffsetMs;
  const customerInteractionInProgress =
    phoneDigits.length > 0 ||
    isSearching ||
    isCustomerPending ||
    isChangingCustomer ||
    createCustomerMode ||
    Boolean(checkInState) ||
    Boolean(serviceSelectionState) ||
    customerNameInput.trim().length > 0 ||
    customerResults.length > 0;
  const resetAtMs = liveDraftResetAt ? new Date(liveDraftResetAt).getTime() : 0;
  const completedResetActive =
    liveDraftStatus === "closed" &&
    Boolean(liveDraftResetAt) &&
    resetAtMs > currentServerMs;
  const hasCheckoutHandoff =
    liveDraftStatus === "draft" &&
    (Boolean(liveDraft?.customer_handoff_started_at) ||
      hasMeaningfulReceipt(liveDraft));
  const neutralWelcomeLabel = settings.salonName?.trim()
    ? `Welcome to ${settings.salonName.trim()}`
    : "Welcome";
  const liveDraftCustomerKeys = liveDraftCustomer
    ? [liveDraftCustomer.id, localPhoneKey(liveDraftCustomer.phone)].filter(
        (value): value is string => Boolean(value),
      )
    : [];
  const identityLabel = (() => {
    if (checkInState) {
      return `Welcome${checkInFirstName ? `, ${checkInFirstName}` : ""}`;
    }

    if (guestConfirmed) {
      return "Welcome, Guest";
    }

    if (liveDraftCustomer) {
      const profileWasJustCreated =
        customerStatus === "Customer profile created.";
      const prefix =
        profileWasJustCreated ||
        (newCustomerKey && liveDraftCustomerKeys.includes(newCustomerKey))
          ? "Welcome"
          : "Welcome back";

      return `${prefix}, ${getFirstName(liveDraftCustomer.name) || "Guest"}`;
    }

    return neutralWelcomeLabel;
  })();
  const displayMode: DisplayMode = (() => {
    if (completedResetActive) {
      return "completed";
    }

    if (checkInState) {
      return "checkin";
    }

    if (serviceSelectionState) {
      return "service_select";
    }

    if (
      !token &&
      (!liveDraft || isEmptyDraft(liveDraft)) &&
      !customerInteractionInProgress
    ) {
      return "attract";
    }

    if (createCustomerMode && !liveDraftCustomer && !guestConfirmed) {
      return "profile";
    }

    if (
      hasCheckoutHandoff &&
      (liveDraftCustomer || guestConfirmed) &&
      !isChangingCustomer
    ) {
      return "tip";
    }

    return "phone";
  })();
  const fallbackTipOptions = useMemo(
    () => getTipOptions(settings, liveDraft),
    [liveDraft, settings],
  );
  const tipOptions = serverTipOptions ?? fallbackTipOptions;
  const rootClass = [
    "customer-display-kiosk-surface relative h-dvh w-dvw touch-manipulation overflow-hidden overscroll-none text-zinc-950",
    isFullscreen ? "cursor-none" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const markCustomerInteraction = useCallback(() => {
    lastCustomerInteractionServerMsRef.current =
      Date.now() + serverOffsetRef.current;
  }, []);

  const applySnapshot = useCallback((snapshot: PosLiveDraftView) => {
    if (
      versionRef.current !== null &&
      snapshot.version < versionRef.current
    ) {
      return;
    }

    versionRef.current = snapshot.version;
    const nextServerOffsetMs = new Date(snapshot.server_now).getTime() - Date.now();

    serverOffsetRef.current = nextServerOffsetMs;
    setServerOffsetMs(nextServerOffsetMs);
    liveDraftRef.current = snapshot;
    setLiveDraft(snapshot);
    setConnectionState("connected");

    if (
      snapshot.status === "closed" ||
      (snapshot.status === "draft" && !snapshot.customer && !hasMeaningfulReceipt(snapshot))
    ) {
      setPhoneInput("");
      setConfirmedPhone(null);
      setGuestConfirmed(false);
      setIsChangingCustomer(false);
      setCreateCustomerMode(false);
      setCustomerNameInput("");
      setNewCustomerKey(null);
      setCustomerResults([]);
      setCustomerStatus(null);
      setCustomTipInput("");
      setCustomTipMode(false);
      lastSubmittedPhoneRef.current = "";
    }

    if (snapshot.customer) {
      setGuestConfirmed(false);
      setIsChangingCustomer(false);
      setCreateCustomerMode(false);
      setCustomerNameInput("");
      setCheckInState(null);
      setServiceSelectionState(null);
      setSelectedServiceIds([]);
      setConfirmedPhone(snapshot.customer.phone);
    }
  }, []);

  const loadLatestSnapshot = useCallback(async () => {
    if (!token) {
      setLiveDraft(null);
      liveDraftRef.current = null;
      setConnectionState("connected");
      return;
    }

    const result = await getPosLiveDraft(token);

    if (!result.ok) {
      setError(result.error);
      setConnectionState("reconnecting");
      return;
    }

    if (result.data) {
      applySnapshot(result.data);
    } else {
      setLiveDraft(null);
      liveDraftRef.current = null;
      setConnectionState("connected");
    }

    setError(null);
  }, [applySnapshot, token]);

  const handlePhoneInput = useCallback(
    (value: string) => {
      const nextDigits = digitsOnly(value).slice(0, 11);

      markCustomerInteraction();
      setPhoneInput(nextDigits);
      setGuestConfirmed(false);
      setCreateCustomerMode(false);
      setCheckInState(null);
      setCustomerNameInput("");
      setNewCustomerKey(null);
      setCustomerStatus(null);
      setServiceSelectionState(null);
      setSelectedServiceIds([]);

      if (nextDigits.length < 10) {
        lastSubmittedPhoneRef.current = "";
      }
    },
    [markCustomerInteraction],
  );

  const applyCustomerPhoneResult = useCallback(
    (
      result: CustomerDisplayPhoneResult,
      phone: string,
      options?: { newCustomer?: boolean },
    ) => {
      setConfirmedPhone(phone);
      setGuestConfirmed(false);
      setIsChangingCustomer(false);
      setCreateCustomerMode(false);
      setCustomerNameInput("");
      setCustomerResults([]);
      setCustomTipInput("");
      setCustomTipMode(false);
      setServiceSelectionState(null);

      if (result.mode === "checkout") {
        setCheckInState(null);
        setSelectedServiceIds([]);
        setNewCustomerKey(
          options?.newCustomer ? localPhoneKey(phone) : null,
        );
        applySnapshot(result.snapshot);
        setCustomerStatus("Customer confirmed.");
        return;
      }

      if (serviceCatalog.length > 0) {
        const nextSelectedIds = result.visit.requestedServices
          .map((service) => service.id)
          .filter((serviceId) => selectableServiceIds.has(serviceId));

        setSelectedServiceIds(nextSelectedIds);
        setServiceSelectionState(result);
        setCheckInState(null);
      } else {
        setSelectedServiceIds([]);
        setServiceSelectionState(null);
        setCheckInState(result);
      }
      setPhoneInput("");
      setNewCustomerKey(options?.newCustomer ? result.visit.customerId : null);
      setCustomerStatus(null);
      lastSubmittedPhoneRef.current = "";
    },
    [applySnapshot, selectableServiceIds, serviceCatalog.length],
  );

  const submitPhoneLookup = useCallback(
    async (value = phoneInput) => {
      const nextDigits = digitsOnly(value).slice(0, 11);

      if (!token || liveDraftStatus !== "draft" || nextDigits.length < 4) {
        return;
      }

      markCustomerInteraction();
      setIsSearching(false);
      setError(null);

      if (!isUsPhoneCandidate(nextDigits)) {
        setCustomerStatus("Enter a 10 digit phone number.");
        return;
      }

      setConfirmedPhone(nextDigits);
      setIsCustomerPending(true);
      const result = await submitCustomerDisplayPhone({
        phone: nextDigits,
        requestId: getRequestId(),
        token,
      });
      setIsCustomerPending(false);

      if (!result.ok) {
        if (result.code === "profile_required") {
          setConfirmedPhone(nextDigits);
          setGuestConfirmed(false);
          setIsChangingCustomer(false);
          setCreateCustomerMode(true);
          setCustomerNameInput("");
          setCustomerResults([]);
          setCustomerStatus(result.error);
          return;
        }

        setCustomerStatus(result.error);
        return;
      }

      applyCustomerPhoneResult(result.data, nextDigits);
    },
    [
      applyCustomerPhoneResult,
      liveDraftStatus,
      markCustomerInteraction,
      phoneInput,
      token,
    ],
  );
  const enterFullscreen = useCallback(() => {
    const target = rootRef.current;

    if (!target || document.fullscreenElement) {
      return;
    }

    void target.requestFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (attractImages.length <= 1 || displayMode !== "attract") {
      return;
    }

    const intervalId = window.setInterval(() => {
      setSlideIndex((current) => (current + 1) % attractImages.length);
    }, SLIDESHOW_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
  }, [attractImages.length, displayMode]);

  useEffect(() => {
    const nextImage = attractImages[(slideIndex + 1) % attractImages.length];

    if (!nextImage || typeof window === "undefined") {
      return;
    }

    const image = new window.Image();
    image.src = nextImage;
  }, [attractImages, slideIndex]);

  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    handleFullscreenChange();
    document.addEventListener("fullscreenchange", handleFullscreenChange);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!token) {
      const timeoutId = window.setTimeout(() => {
        setLiveDraft(null);
        liveDraftRef.current = null;
        setConnectionState("connected");
      }, 0);

      return () => window.clearTimeout(timeoutId);
    }

    let isMounted = true;
    const initialLoadId = window.setTimeout(() => {
      void loadLatestSnapshot();
    }, 0);

    const supabase = createSupabaseBrowserClient();

    if (!supabase) {
      return () => {
        isMounted = false;
        window.clearTimeout(initialLoadId);
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
          if (!isMounted || payload.payload.token !== token) {
            return;
          }

          if (
            versionRef.current !== null &&
            payload.payload.version < versionRef.current
          ) {
            return;
          }

          void loadLatestSnapshot();
        },
      )
      .subscribe((status) => {
        if (!isMounted) {
          return;
        }

        if (status === "SUBSCRIBED") {
          setConnectionState("connected");
          void loadLatestSnapshot();
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionState("reconnecting");
        }
      });

    return () => {
      isMounted = false;
      window.clearTimeout(initialLoadId);
      void supabase.removeChannel(channel);
    };
  }, [loadLatestSnapshot, token]);

  useEffect(() => {
    if (!token || liveDraftStatus !== "draft") {
      const timeoutId = window.setTimeout(() => setServerTipOptions(null), 0);
      return () => window.clearTimeout(timeoutId);
    }

    let cancelled = false;

    async function loadTipOptions() {
      const result = await getCustomerDisplayLiveDraftTipOptions({ token });

      if (cancelled) {
        return;
      }

      setServerTipOptions(result.ok ? result.data : null);
    }

    void loadTipOptions();

    return () => {
      cancelled = true;
    };
  }, [
    liveDraft?.receipt_version,
    liveDraft?.subtotal,
    liveDraft?.tax,
    liveDraft?.tip,
    liveDraft?.total,
    liveDraft?.total_before_tip,
    liveDraftStatus,
    token,
  ]);

  useEffect(() => {
    if (!liveDraft?.reset_at) {
      const timeoutId = window.setTimeout(() => setResetSeconds(null), 0);
      return () => window.clearTimeout(timeoutId);
    }

    let timeoutId: number | null = null;
    let intervalId: number | null = null;

    function updateRemaining() {
      if (!liveDraft?.reset_at) {
        setResetSeconds(null);
        return;
      }

      const serverNow = Date.now() + serverOffsetRef.current;
      const remainingMs = new Date(liveDraft.reset_at).getTime() - serverNow;
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setResetSeconds(remainingSeconds);

      if (remainingMs <= 0) {
        void loadLatestSnapshot();
      }
    }

    updateRemaining();
    intervalId = window.setInterval(updateRemaining, 250);
    const serverNow = Date.now() + serverOffsetRef.current;
    const remainingMs = new Date(liveDraft.reset_at).getTime() - serverNow;
    timeoutId = window.setTimeout(
      () => void loadLatestSnapshot(),
      Math.max(0, remainingMs + 50),
    );

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [liveDraft?.reset_at, loadLatestSnapshot]);

  useEffect(() => {
    if (
      displayMode !== "phone" ||
      liveDraftStatus !== "draft" ||
      !hasCheckoutHandoff ||
      phoneDigits.length < 4 ||
      isUsPhoneCandidate(phoneDigits)
    ) {
      if (displayMode !== "profile") {
        const timeoutId = window.setTimeout(() => {
          setCustomerResults([]);
          setCustomerStatus(null);
        }, 0);
        return () => window.clearTimeout(timeoutId);
      }

      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);
      const result = await searchCustomerDisplayLiveDraftCustomers({
        phone: phoneInput,
        token,
      });

      if (cancelled) {
        return;
      }

      setIsSearching(false);

      if (!result.ok) {
        setCustomerStatus(result.error);
        return;
      }

      setCustomerResults(result.data);
      setCustomerStatus(result.data.length > 0 ? null : "No customer found.");
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    displayMode,
    hasCheckoutHandoff,
    liveDraftStatus,
    phoneDigits,
    phoneInput,
    token,
  ]);

  useEffect(() => {
    if (
      displayMode !== "phone" ||
      liveDraftStatus !== "draft" ||
      !isUsPhoneCandidate(phoneDigits)
    ) {
      return;
    }

    if (lastSubmittedPhoneRef.current === phoneDigits) {
      return;
    }

    lastSubmittedPhoneRef.current = phoneDigits;
    void submitPhoneLookup(phoneDigits);
  }, [displayMode, liveDraftStatus, phoneDigits, submitPhoneLookup]);

  useEffect(() => {
    if (!checkInState) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCheckInState(null);
      setPhoneInput("");
      setConfirmedPhone(null);
      setGuestConfirmed(false);
      setIsChangingCustomer(false);
      setCreateCustomerMode(false);
      setCustomerNameInput("");
      setNewCustomerKey(null);
      setCustomerResults([]);
      setCustomerStatus(null);
      setCustomTipInput("");
      setCustomTipMode(false);
      setServiceSelectionState(null);
      setSelectedServiceIds([]);
      lastSubmittedPhoneRef.current = "";
    }, CHECKIN_SUCCESS_RESET_MS);

    return () => window.clearTimeout(timeoutId);
  }, [checkInState]);

  async function confirmCustomer(customer: PosLiveDraftCustomer) {
    const phone = digitsOnly(customer.phone ?? phoneInput).slice(0, 11);

    if (!token || liveDraftStatus !== "draft" || !customer.id || !isUsPhoneCandidate(phone)) {
      return;
    }

    markCustomerInteraction();
    setIsCustomerPending(true);
    setError(null);

    const result = await submitCustomerDisplayPhone({
      phone,
      requestId: getRequestId(),
      token,
    });

    setIsCustomerPending(false);

    if (!result.ok) {
      setCustomerStatus(result.error);
      return;
    }

    applyCustomerPhoneResult(result.data, phone);
  }

  async function createCustomerProfile() {
    const name = customerNameInput.trim();
    const phone = digitsOnly(confirmedPhone ?? phoneInput).slice(0, 11);

    if (!token || liveDraftStatus !== "draft") {
      return;
    }

    if (!name) {
      setCustomerStatus("Customer name is required.");
      return;
    }

    if (!isUsPhoneCandidate(phone)) {
      setCustomerStatus("Enter a valid phone number first.");
      return;
    }

    markCustomerInteraction();
    setIsCustomerPending(true);
    setError(null);

    const result = await submitCustomerDisplayPhone({
      name,
      phone,
      requestId: getRequestId(),
      token,
    });

    setIsCustomerPending(false);

    if (!result.ok) {
      setCustomerStatus(result.error);
      return;
    }

    setConfirmedPhone(phone);
    applyCustomerPhoneResult(result.data, phone, { newCustomer: true });
    setCustomerStatus(
      result.data.mode === "checkout"
        ? "Customer profile created."
        : "Profile created.",
    );
  }

  async function confirmTip(tipAmount: number) {
    if (!Number.isFinite(tipAmount) || tipAmount < 0) {
      setError("Tip must be zero or greater.");
      return;
    }

    markCustomerInteraction();
    setIsTipPending(true);
    setError(null);

    const result = await confirmCustomerDisplayLiveDraftTip({
      requestId: getRequestId(),
      tipAmount,
      token,
    });

    setIsTipPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setCustomTipInput("");
    setCustomTipMode(false);
    applySnapshot(result.data);
  }

  function beginFromAttract() {
    markCustomerInteraction();
    setCheckInState(null);
    setServiceSelectionState(null);
    setSelectedServiceIds([]);
    setIsChangingCustomer(false);
  }

  function changeCustomer() {
    markCustomerInteraction();
    setCheckInState(null);
    setServiceSelectionState(null);
    setSelectedServiceIds([]);
    setIsChangingCustomer(true);
    setGuestConfirmed(false);
    setCreateCustomerMode(false);
    setCustomerNameInput("");
    setNewCustomerKey(null);
    setConfirmedPhone(null);
    setPhoneInput("");
    setCustomerResults([]);
    setCustomerStatus(null);
    lastSubmittedPhoneRef.current = "";
  }

  function continueToTipAsGuest() {
    if (!hasMeaningfulReceipt(liveDraft)) {
      return;
    }

    markCustomerInteraction();
    setCheckInState(null);
    setServiceSelectionState(null);
    setSelectedServiceIds([]);
    setGuestConfirmed(true);
    setIsChangingCustomer(false);
    setCreateCustomerMode(false);
    setCustomerNameInput("");
    setNewCustomerKey(null);
    setConfirmedPhone(null);
    setPhoneInput("");
    setCustomerResults([]);
    setCustomerStatus(null);
    lastSubmittedPhoneRef.current = "";
  }

  function returnToPhoneEntry() {
    markCustomerInteraction();
    setCheckInState(null);
    setServiceSelectionState(null);
    setSelectedServiceIds([]);
    setCreateCustomerMode(false);
    setCustomerNameInput("");
    setCustomerStatus(null);
    lastSubmittedPhoneRef.current = "";
  }

  function toggleRequestedService(serviceId: string) {
    if (isServicePending || !selectableServiceIds.has(serviceId)) {
      return;
    }

    markCustomerInteraction();
    setSelectedServiceIds((current) =>
      current.includes(serviceId)
        ? current.filter((id) => id !== serviceId)
        : [...current, serviceId],
    );
    setError(null);
    setCustomerStatus(null);
  }

  async function submitRequestedServices() {
    if (!serviceSelectionState || !token || liveDraftStatus !== "draft") {
      return;
    }

    markCustomerInteraction();
    setIsServicePending(true);
    setError(null);

    const result = await saveCustomerDisplayRequestedServices({
      serviceIds: selectedServiceIds,
      token,
      visitId: serviceSelectionState.visit.id,
    });

    setIsServicePending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (result.data.mode !== "check_in") {
      setError("Unable to save service request. Please ask the front desk.");
      return;
    }

    setServiceSelectionState(null);
    setSelectedServiceIds([]);
    setCheckInState(result.data);
    setCustomerStatus(null);
  }

  async function resetCompletedNow() {
    if (
      completedResetInFlightRef.current ||
      !token ||
      liveDraftStatus !== "closed"
    ) {
      return;
    }

    completedResetInFlightRef.current = true;
    setError(null);

    const result = await resetCustomerDisplayCompletedDraft({ token });

    completedResetInFlightRef.current = false;

    if (!result.ok) {
      setError(result.error);
      return;
    }

    if (result.data) {
      applySnapshot(result.data);
    } else {
      setLiveDraft(null);
      liveDraftRef.current = null;
    }

    setPhoneInput("");
    setConfirmedPhone(null);
    setGuestConfirmed(false);
    setIsChangingCustomer(false);
    setCreateCustomerMode(false);
    setCustomerNameInput("");
    setNewCustomerKey(null);
    setCustomerResults([]);
    setCustomerStatus(null);
    setCustomTipInput("");
    setCustomTipMode(false);
    setCheckInState(null);
    setServiceSelectionState(null);
    setSelectedServiceIds([]);
    lastSubmittedPhoneRef.current = "";
  }

  return (
    <div className={rootClass} ref={rootRef}>
      {displayMode === "tip" ? (
        <FullscreenButton hidden={isFullscreen} onClick={enterFullscreen} />
      ) : null}
      <div className="customer-display-auto-scale h-full w-full">
        {displayMode === "attract" ? (
          <AttractScreen
            currentSlide={slideIndex}
            error={error}
            images={attractImages}
            isFullscreen={isFullscreen}
            onBegin={beginFromAttract}
            onFullscreen={enterFullscreen}
            settings={settings}
          />
        ) : displayMode === "completed" ? (
          <CompletedScreen
            backgroundImageUrl={backgroundImageUrl}
            isFullscreen={isFullscreen}
            liveDraft={liveDraft}
            onFullscreen={enterFullscreen}
            onReset={() => void resetCompletedNow()}
            resetSeconds={resetSeconds}
          />
        ) : displayMode === "tip" ||
          (hasCheckoutHandoff &&
            (displayMode === "phone" || displayMode === "profile")) ? (
          <CheckoutShell
            backgroundImageUrl={backgroundImageUrl}
            connectionState={connectionState}
            displayMode={displayMode}
            error={error}
            identityLabel={identityLabel}
            liveDraft={liveDraft}
            settings={settings}
          >
            {displayMode === "tip" ? (
              <TipPanel
                confirmedPhone={
                  confirmedPhone ?? liveDraftCustomer?.phone ?? phoneInput ?? null
                }
                customTipInput={customTipInput}
                customTipMode={customTipMode}
                identityLabel={identityLabel}
                isTipPending={isTipPending}
                liveDraft={liveDraft}
                onChangeCustomer={changeCustomer}
                onConfirmTip={confirmTip}
                onCustomTipInput={setCustomTipInput}
                onSetCustomTipMode={setCustomTipMode}
                tipOptions={tipOptions}
              />
            ) : displayMode === "profile" ? (
              <ProfileCreationPanel
                customerStatus={customerStatus}
                disabled={!token || liveDraftStatus !== "draft"}
                isPending={isCustomerPending}
                nameInput={customerNameInput}
                onBack={returnToPhoneEntry}
                onNameInput={(value) => {
                  markCustomerInteraction();
                  setCustomerNameInput(value);
                  setCustomerStatus(null);
                }}
                onSubmit={() => void createCustomerProfile()}
                phone={confirmedPhone ?? phoneInput}
              />
            ) : (
              <PhoneEntryPanel
                customerResults={customerResults}
                customerStatus={customerStatus}
                disabled={!token || liveDraftStatus !== "draft"}
                isCustomerPending={isCustomerPending}
                isSearching={isSearching}
                onConfirmCustomer={confirmCustomer}
                onPhoneInput={handlePhoneInput}
                onSkipToTip={continueToTipAsGuest}
                onSubmitPhone={() => void submitPhoneLookup(phoneInput)}
                phoneInput={phoneInput}
                showTipShortcut={hasCheckoutHandoff}
              />
            )}
          </CheckoutShell>
        ) : (
          <CheckInShell
            backgroundImageUrl={backgroundImageUrl}
            error={error}
            isFullscreen={isFullscreen}
            onFullscreen={enterFullscreen}
            settings={settings}
          >
            {displayMode === "checkin" && checkInState ? (
              <CheckInConfirmationPanel checkIn={checkInState} />
            ) : displayMode === "service_select" && serviceSelectionState ? (
              <ServiceSelectionPanel
                checkIn={serviceSelectionState}
                disabled={isServicePending}
                onBack={returnToPhoneEntry}
                onSubmit={() => void submitRequestedServices()}
                selectedServiceIds={selectedServiceIds}
                services={serviceCatalog}
                toggleService={toggleRequestedService}
              />
            ) : displayMode === "profile" ? (
              <ProfileCreationPanel
                customerStatus={customerStatus}
                disabled={!token || liveDraftStatus !== "draft"}
                isPending={isCustomerPending}
                nameInput={customerNameInput}
                onBack={returnToPhoneEntry}
                onNameInput={(value) => {
                  markCustomerInteraction();
                  setCustomerNameInput(value);
                  setCustomerStatus(null);
                }}
                onSubmit={() => void createCustomerProfile()}
                phone={confirmedPhone ?? phoneInput}
              />
            ) : (
              <PhoneEntryPanel
                customerResults={customerResults}
                customerStatus={customerStatus}
                disabled={!token || liveDraftStatus !== "draft"}
                isCustomerPending={isCustomerPending}
                isSearching={isSearching}
                onConfirmCustomer={confirmCustomer}
                onPhoneInput={handlePhoneInput}
                onSkipToTip={continueToTipAsGuest}
                onSubmitPhone={() => void submitPhoneLookup(phoneInput)}
                phoneInput={phoneInput}
                showTipShortcut={hasCheckoutHandoff}
              />
            )}
          </CheckInShell>
        )}
      </div>
    </div>
  );
}

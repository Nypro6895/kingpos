"use client";

/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  confirmCustomerDisplayLiveDraftCustomer,
  confirmCustomerDisplayLiveDraftTip,
  createCustomerDisplayLiveDraftCustomer,
  getCustomerDisplayLiveDraftTipOptions,
  getPosLiveDraft,
  searchCustomerDisplayLiveDraftCustomers,
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
type DisplayMode = "attract" | "completed" | "phone" | "profile" | "tip";
type TipOption = CustomerDisplayTipOption;

const EMPTY_IDLE_TIMEOUT_MS = 120 * 1000;
const SLIDESHOW_INTERVAL_MS = 7000;

const PHONE_KEYPAD_STYLE = {
  "--customer-display-key-size": "clamp(72px, min(8.8vh, 6.2vw), 92px)",
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

function formatPhoneDisplay(value: string) {
  const digits = digitsOnly(value).slice(0, 11);
  const localDigits =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
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
  const digits = digitsOnly(value ?? "");
  const localDigits =
    digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
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

function hasDraftActivity(liveDraft: PosLiveDraftView | null) {
  return (
    Boolean(liveDraft?.selected_staff_id) ||
    Boolean(liveDraft?.customer) ||
    hasMeaningfulReceipt(liveDraft)
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
          We&apos;ll find your profile and keep your receipt connected.
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

      <button
        className="mt-4 min-h-14 rounded-2xl bg-zinc-950 px-4 text-lg font-semibold text-white shadow-lg transition active:translate-y-px active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:shadow-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-zinc-950/20"
        disabled={disabled || isCustomerPending}
        onClick={onSkipToTip}
        type="button"
      >
        Tip
      </button>

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
          We did not find this phone number. Create a profile to earn rewards
          and continue checkout.
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
          className="grid h-full max-h-[880px] min-h-0 w-full max-w-[1280px] gap-4"
          data-customer-display-checkout
          style={{
            gridTemplateColumns: "minmax(0, 1fr) minmax(320px, 430px)",
          }}
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
            <p className="col-span-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CompletedScreen({
  backgroundImageUrl,
  isFullscreen,
  liveDraft,
  onFullscreen,
  resetSeconds,
}: {
  backgroundImageUrl: string;
  isFullscreen: boolean;
  liveDraft: PosLiveDraftView | null;
  onFullscreen: () => void;
  resetSeconds: number | null;
}) {
  const firstName = getFirstName(liveDraft?.customer?.name);
  const nameLabel = firstName ? `, ${firstName}` : "";

  return (
    <section
      className="relative grid h-full w-full place-items-center overflow-hidden bg-stone-50 px-6 text-center text-zinc-950"
      data-customer-display-completed
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
        {resetSeconds !== null ? (
          <p className="mt-6 text-sm font-medium text-zinc-600">
            Resetting in {resetSeconds}s
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function CustomerDisplayClient({
  settings,
  token,
}: {
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
  const [newCustomerId, setNewCustomerId] = useState<string | null>(null);
  const [customerResults, setCustomerResults] = useState<PosLiveDraftCustomer[]>(
    [],
  );
  const [customerStatus, setCustomerStatus] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isCustomerPending, setIsCustomerPending] = useState(false);
  const [customTipInput, setCustomTipInput] = useState("");
  const [customTipMode, setCustomTipMode] = useState(false);
  const [isTipPending, setIsTipPending] = useState(false);
  const [resetSeconds, setResetSeconds] = useState<number | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [lastCustomerInteractionServerMs, setLastCustomerInteractionServerMs] =
    useState<number | null>(null);
  const [forceAttractAfterReset, setForceAttractAfterReset] = useState(false);
  const [serverTipOptions, setServerTipOptions] = useState<TipOption[] | null>(
    null,
  );
  const lastSubmittedPhoneRef = useRef("");
  const liveDraftRef = useRef<PosLiveDraftView | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const serverOffsetRef = useRef(0);
  const versionRef = useRef<number | null>(null);

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
  const phoneDigits = digitsOnly(phoneInput);
  const currentServerMs = nowMs + serverOffsetMs;
  const updatedAtMs = liveDraft?.updated_at
    ? new Date(liveDraft.updated_at).getTime()
    : 0;
  const latestInteractionMs = Math.max(
    updatedAtMs,
    lastCustomerInteractionServerMs ?? 0,
  );
  const customerInteractionInProgress =
    phoneDigits.length > 0 ||
    isSearching ||
    isCustomerPending ||
    isChangingCustomer ||
    createCustomerMode ||
    customerNameInput.trim().length > 0 ||
    customerResults.length > 0;
  const idleExpired =
    latestInteractionMs > 0 &&
    currentServerMs - latestInteractionMs >= EMPTY_IDLE_TIMEOUT_MS;
  const resetAtMs = liveDraftResetAt ? new Date(liveDraftResetAt).getTime() : 0;
  const completedResetActive =
    liveDraftStatus === "closed" &&
    Boolean(liveDraftResetAt) &&
    resetAtMs > currentServerMs;
  const neutralWelcomeLabel = settings.salonName?.trim()
    ? `Welcome to ${settings.salonName.trim()}`
    : "Welcome";
  const identityLabel = guestConfirmed
    ? "Welcome, Guest"
    : liveDraftCustomer
      ? `${newCustomerId && newCustomerId === liveDraftCustomer.id ? "Welcome" : "Welcome back"}, ${
          getFirstName(liveDraftCustomer.name) || "Guest"
        }`
      : neutralWelcomeLabel;
  const displayMode: DisplayMode = (() => {
    if (completedResetActive) {
      return "completed";
    }

    if (
      forceAttractAfterReset &&
      isEmptyDraft(liveDraft) &&
      !customerInteractionInProgress
    ) {
      return "attract";
    }

    if (
      (!liveDraft && !lastCustomerInteractionServerMs) ||
      (isEmptyDraft(liveDraft) &&
        !hasDraftActivity(liveDraft) &&
        !customerInteractionInProgress &&
        idleExpired)
    ) {
      return "attract";
    }

    if (createCustomerMode && !liveDraftCustomer && !guestConfirmed) {
      return "profile";
    }

    if ((liveDraftCustomer || guestConfirmed) && !isChangingCustomer) {
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
    setLastCustomerInteractionServerMs(Date.now() + serverOffsetRef.current);
    setForceAttractAfterReset(false);
  }, []);

  const applySnapshot = useCallback((snapshot: PosLiveDraftView) => {
    if (
      versionRef.current !== null &&
      snapshot.version < versionRef.current
    ) {
      return;
    }

    const previous = liveDraftRef.current;
    const wasCompleted = previous?.status === "closed";

    versionRef.current = snapshot.version;
    const nextServerOffsetMs = new Date(snapshot.server_now).getTime() - Date.now();

    serverOffsetRef.current = nextServerOffsetMs;
    setServerOffsetMs(nextServerOffsetMs);
    liveDraftRef.current = snapshot;
    setLiveDraft(snapshot);
    setConnectionState("connected");

    if (hasDraftActivity(snapshot)) {
      setForceAttractAfterReset(false);
    }

    if (wasCompleted && isEmptyDraft(snapshot)) {
      setForceAttractAfterReset(true);
    }

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
      setNewCustomerId(null);
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
      setCustomerNameInput("");
      setNewCustomerId(null);
      setCustomerStatus(null);

      if (nextDigits.length < 10) {
        lastSubmittedPhoneRef.current = "";
      }
    },
    [markCustomerInteraction],
  );

  const submitPhoneLookup = useCallback(
    async (value = phoneInput) => {
      const nextDigits = digitsOnly(value).slice(0, 11);

      if (!token || liveDraftStatus !== "draft" || nextDigits.length < 4) {
        return;
      }

      markCustomerInteraction();
      setIsSearching(true);
      setError(null);

      const result = await searchCustomerDisplayLiveDraftCustomers({
        phone: nextDigits,
        token,
      });

      setIsSearching(false);

      if (!result.ok) {
        setCustomerStatus(result.error);
        return;
      }

      const matches = result.data;
      setCustomerResults(matches);

      if (!isUsPhoneCandidate(nextDigits)) {
        setCustomerStatus(matches.length > 0 ? null : "No customer found.");
        return;
      }

      const exactMatch =
        matches.find((customer) => digitsOnly(customer.phone ?? "") === nextDigits) ??
        (matches.length === 1 ? matches[0] : null);

      setConfirmedPhone(nextDigits);

      if (!exactMatch?.id) {
        setGuestConfirmed(false);
        setIsChangingCustomer(false);
        setCreateCustomerMode(true);
        setCustomerNameInput("");
        setCustomerResults([]);
        setCustomerStatus("No matching profile found. Create a profile to continue.");
        return;
      }

      setIsCustomerPending(true);
      const confirmResult = await confirmCustomerDisplayLiveDraftCustomer({
        customerId: exactMatch.id,
        requestId: getRequestId(),
        token,
      });
      setIsCustomerPending(false);

      if (!confirmResult.ok) {
        setError(confirmResult.error);
        return;
      }

      applySnapshot(confirmResult.data);
      setCustomerStatus("Customer confirmed.");
    },
    [applySnapshot, liveDraftStatus, markCustomerInteraction, phoneInput, token],
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
  }, [displayMode, liveDraftStatus, phoneDigits, phoneInput, token]);

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

  async function confirmCustomer(customer: PosLiveDraftCustomer) {
    if (!customer.id) {
      return;
    }

    markCustomerInteraction();
    setIsCustomerPending(true);
    setError(null);

    const result = await confirmCustomerDisplayLiveDraftCustomer({
      customerId: customer.id,
      requestId: getRequestId(),
      token,
    });

    setIsCustomerPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setConfirmedPhone(customer.phone ?? phoneInput);
    setNewCustomerId(null);
    applySnapshot(result.data);
    setCustomerStatus("Customer confirmed.");
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

    const result = await createCustomerDisplayLiveDraftCustomer({
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
    setCreateCustomerMode(false);
    setCustomerNameInput("");
    setNewCustomerId(result.data.customer?.id ?? null);
    applySnapshot(result.data);
    setCustomerStatus("Customer profile created.");
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
    setIsChangingCustomer(false);
  }

  function changeCustomer() {
    markCustomerInteraction();
    setIsChangingCustomer(true);
    setGuestConfirmed(false);
    setCreateCustomerMode(false);
    setCustomerNameInput("");
    setNewCustomerId(null);
    setConfirmedPhone(null);
    setPhoneInput("");
    setCustomerResults([]);
    setCustomerStatus(null);
    lastSubmittedPhoneRef.current = "";
  }

  function continueToTipAsGuest() {
    markCustomerInteraction();
    setGuestConfirmed(true);
    setIsChangingCustomer(false);
    setCreateCustomerMode(false);
    setCustomerNameInput("");
    setNewCustomerId(null);
    setConfirmedPhone(null);
    setPhoneInput("");
    setCustomerResults([]);
    setCustomerStatus(null);
    lastSubmittedPhoneRef.current = "";
  }

  function returnToPhoneEntry() {
    markCustomerInteraction();
    setCreateCustomerMode(false);
    setCustomerNameInput("");
    setCustomerStatus(null);
    lastSubmittedPhoneRef.current = "";
  }

  return (
    <div className={rootClass} ref={rootRef}>
      {displayMode === "attract" || displayMode === "completed" ? null : (
        <FullscreenButton hidden={isFullscreen} onClick={enterFullscreen} />
      )}
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
            resetSeconds={resetSeconds}
          />
        ) : (
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
              />
            )}
          </CheckoutShell>
        )}
      </div>
    </div>
  );
}

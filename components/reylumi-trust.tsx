"use client";

import type {
  LumiTrustLevel,
  ReylumiTrustFact,
  ReylumiTrustSummary,
} from "@/lib/reylumi-trust";
import Link from "next/link";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from "react";
import { createPortal } from "react-dom";

type LumiTrustSparkSize = "lg" | "md" | "sm" | "xs";

const LUMI_SPARK_PATH =
  "M10 1.8 12.08 7.92 18.2 10l-6.12 2.08L10 18.2l-2.08-6.12L1.8 10l6.12-2.08L10 1.8Z";

const LUMI_TRUST_FILL_RATIO: Record<LumiTrustLevel, number> = {
  empty: 0,
  level_1: 0.28,
  level_2: 0.52,
  level_3: 0.76,
  full: 1,
};

const LUMI_TRUST_SPARK_SIZE_CLASS: Record<LumiTrustSparkSize, string> = {
  lg: "h-8 w-8",
  md: "h-6 w-6",
  sm: "h-5 w-5",
  xs: "h-4 w-4",
};
const LUMI_TRUST_POPOVER_GAP = 8;
const LUMI_TRUST_POPOVER_VIEWPORT_MARGIN = 12;

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function reylumiTrustFactLabel(fact: ReylumiTrustFact) {
  return fact.kind === "rating" ? fact.label.replace(/^\u2605\s*/, "") : fact.label;
}

export function LumiTrustSpark({
  className = "",
  interactive = false,
  level,
  size = "sm",
}: {
  className?: string;
  interactive?: boolean;
  level: LumiTrustLevel;
  size?: LumiTrustSparkSize;
}) {
  const reactId = useId();
  const clipPathId = `lumi-trust-spark-${reactId.replace(/:/g, "")}`;
  const fillRatio = LUMI_TRUST_FILL_RATIO[level];
  const fillHeight = 20 * fillRatio;
  const fillY = 20 - fillHeight;

  return (
    <svg
      aria-hidden
      className={joinClasses(
        "shrink-0 overflow-visible",
        LUMI_TRUST_SPARK_SIZE_CLASS[size],
        className,
      )}
      data-lumi-trust-interactive={interactive ? "true" : undefined}
      data-lumi-trust-level={level}
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id={clipPathId}>
          <rect height={fillHeight} width="20" x="0" y={fillY} />
        </clipPath>
      </defs>
      {fillRatio > 0 ? (
        <path clipPath={`url(#${clipPathId})`} d={LUMI_SPARK_PATH} fill="currentColor" />
      ) : null}
      <path
        d={LUMI_SPARK_PATH}
        fill="none"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.65"
      />
    </svg>
  );
}

export function LumiTrustMark({
  className = "",
  presentation = "label",
  size = "sm",
  summary,
}: {
  className?: string;
  presentation?: "label" | "spark";
  size?: LumiTrustSparkSize;
  summary: ReylumiTrustSummary;
}) {
  return (
    <span
      aria-label={summary.mark.ariaLabel}
      className={joinClasses(
        presentation === "spark"
          ? "inline-grid min-w-0 place-items-center rounded-full text-brand-orange"
          : "inline-flex min-w-0 items-center gap-1.5 rounded-full text-xs font-semibold text-brand-orange",
        className,
      )}
    >
      <LumiTrustSpark interactive={false} level={summary.level} size={size} />
      {presentation === "label" ? (
        <span className="truncate">{summary.mark.label}</span>
      ) : null}
    </span>
  );
}

export function TrustFactPill({
  className = "",
  fact,
}: {
  className?: string;
  fact: ReylumiTrustFact;
}) {
  return (
    <span
      aria-label={fact.ariaLabel}
      className={joinClasses(
        "inline-flex min-w-0 items-center gap-1 rounded-full text-xs font-semibold",
        className,
      )}
    >
      {fact.kind === "rating" ? (
        <span aria-hidden className="text-brand-orange">
          &#9733;
        </span>
      ) : null}
      <span className="truncate">{reylumiTrustFactLabel(fact)}</span>
    </span>
  );
}

export function LumiTrustPopover({
  actionHref,
  actionLabel = "View trust details",
  align = "left",
  className = "",
  entityName,
  markClassName = "",
  panelClassName = "",
  presentation = "label",
  size = "sm",
  summary,
  title = "LUMI TRUST",
}: {
  actionHref?: string | null;
  actionLabel?: string;
  align?: "left" | "right";
  className?: string;
  entityName?: string | null;
  facts?: ReylumiTrustFact[];
  markClassName?: string;
  panelClassName?: string;
  presentation?: "label" | "spark";
  size?: LumiTrustSparkSize;
  summary: ReylumiTrustSummary;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [panelPosition, setPanelPosition] = useState({
    left: LUMI_TRUST_POPOVER_VIEWPORT_MARGIN,
    top: LUMI_TRUST_POPOVER_VIEWPORT_MARGIN,
    visible: false,
  });
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const portalTarget = typeof document === "undefined" ? null : document.body;
  const evidenceRows = summary.evidenceRows.slice(0, 5);
  const entityLabel = entityName?.trim() || null;

  function clearCloseTimer() {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openPopover() {
    clearCloseTimer();
    setOpen(true);
  }

  function closePopover() {
    if (pinned) {
      return;
    }

    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 90);
  }

  function togglePopover(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    clearCloseTimer();
    setOpen((current) => {
      const nextOpen = !current || !pinned;
      setPinned(nextOpen);
      return nextOpen;
    });
  }

  function closeOnBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    const root = rootRef.current;
    const panel = panelRef.current;

    if (
      nextTarget instanceof Node &&
      (event.currentTarget.contains(nextTarget) ||
        root?.contains(nextTarget) ||
        panel?.contains(nextTarget))
    ) {
      return;
    }

    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(() => {
      const root = rootRef.current;
      const panel = panelRef.current;
      const activeElement = document.activeElement;

      if (
        activeElement instanceof Node &&
        (root?.contains(activeElement) || panel?.contains(activeElement))
      ) {
        return;
      }

      setPinned(false);
      setOpen(false);
    }, 90);
  }

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function closePanel() {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }

      setPinned(false);
      setOpen(false);
    }

    function closeOnPointerDown(event: PointerEvent) {
      const root = rootRef.current;
      const panel = panelRef.current;

      if (
        event.target instanceof Node &&
        !root?.contains(event.target) &&
        !panel?.contains(event.target)
      ) {
        closePanel();
      }
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        closePanel();
      }
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !portalTarget) {
      return undefined;
    }

    function updatePanelPosition() {
      const anchor = buttonRef.current;
      const panel = panelRef.current;

      if (!anchor || !panel) {
        setPanelPosition((current) => ({ ...current, visible: false }));
        return;
      }

      const anchorRect = anchor.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const panelWidth = panelRect.width;
      const panelHeight = panelRect.height;
      const maxLeft =
        window.innerWidth - panelWidth - LUMI_TRUST_POPOVER_VIEWPORT_MARGIN;
      const maxTop =
        window.innerHeight - panelHeight - LUMI_TRUST_POPOVER_VIEWPORT_MARGIN;
      const preferredLeft =
        align === "right" ? anchorRect.right - panelWidth : anchorRect.left;
      const spaceBelow =
        window.innerHeight -
        anchorRect.bottom -
        LUMI_TRUST_POPOVER_GAP -
        LUMI_TRUST_POPOVER_VIEWPORT_MARGIN;
      const spaceAbove =
        anchorRect.top -
        LUMI_TRUST_POPOVER_GAP -
        LUMI_TRUST_POPOVER_VIEWPORT_MARGIN;
      const openAbove = panelHeight > spaceBelow && spaceAbove > spaceBelow;
      const preferredTop = openAbove
        ? anchorRect.top - panelHeight - LUMI_TRUST_POPOVER_GAP
        : anchorRect.bottom + LUMI_TRUST_POPOVER_GAP;

      setPanelPosition({
        left: Math.round(
          Math.max(
            LUMI_TRUST_POPOVER_VIEWPORT_MARGIN,
            Math.min(preferredLeft, maxLeft),
          ),
        ),
        top: Math.round(
          Math.max(
            LUMI_TRUST_POPOVER_VIEWPORT_MARGIN,
            Math.min(preferredTop, maxTop),
          ),
        ),
        visible: true,
      });
    }

    const animationFrame = window.requestAnimationFrame(updatePanelPosition);
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
      setPanelPosition((current) => ({ ...current, visible: false }));
    };
  }, [align, open, portalTarget]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  const panel =
    open && portalTarget
      ? createPortal(
          <div
            className={joinClasses(
              "fixed z-[90] max-h-[min(75vh,24rem)] w-[min(19rem,calc(100vw-1.5rem))] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-3 text-left text-zinc-700 shadow-[0_18px_54px_rgba(24,24,27,.18)] transition-opacity",
              panelClassName,
            )}
            id={panelId}
            onBlur={closeOnBlur}
            onMouseEnter={openPopover}
            onMouseLeave={closePopover}
            ref={panelRef}
            role="dialog"
            style={{
              left: panelPosition.left,
              opacity: panelPosition.visible ? 1 : 0,
              pointerEvents: panelPosition.visible ? "auto" : "none",
              top: panelPosition.top,
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-orange">
              {title}
            </p>
            {entityLabel ? (
              <p className="mt-1 line-clamp-2 text-sm font-semibold text-zinc-950">
                {entityLabel}
              </p>
            ) : null}
            <p className="mt-2 inline-flex items-center gap-2 text-sm font-semibold text-zinc-950">
              <LumiTrustSpark
                className="text-brand-orange"
                level={summary.level}
                size="sm"
              />
              <span>{summary.mark.label}</span>
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-600">
              {summary.mark.detail}
            </p>
            {evidenceRows.length > 0 ? (
              <div className="mt-3 grid gap-2 text-xs leading-5 text-zinc-700">
                {evidenceRows.map((row) => (
                  <div className="flex items-start gap-2" key={row.kind}>
                    <span
                      aria-hidden
                      className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-orange-soft text-[10px] font-bold text-brand-orange"
                    >
                      +
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-zinc-950">
                        {row.value ? `${row.value} ${row.label}` : row.label}
                      </p>
                      <p className="text-zinc-600">{row.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {actionHref ? (
              <Link
                className="mt-3 inline-flex min-h-8 items-center rounded-full bg-zinc-950 px-3 text-xs font-semibold text-white transition hover:bg-brand-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                href={actionHref}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setPinned(false);
                  setOpen(false);
                }}
              >
                {actionLabel}
              </Link>
            ) : null}
          </div>,
          portalTarget,
        )
      : null;

  return (
    <>
      <div
        className={joinClasses("inline-flex min-w-0", className)}
        onBlur={closeOnBlur}
        onMouseEnter={openPopover}
        onMouseLeave={closePopover}
        ref={rootRef}
      >
        <button
          aria-controls={open ? panelId : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`${summary.mark.ariaLabel}. Show LUMI Trust details.`}
          className={joinClasses(
            presentation === "spark"
              ? "grid min-h-8 min-w-8 place-items-center rounded-full text-brand-orange transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              : "inline-flex min-h-8 min-w-0 items-center gap-1.5 rounded-full text-xs font-semibold text-brand-orange transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
            markClassName,
          )}
          onClick={togglePopover}
          onFocus={openPopover}
          ref={buttonRef}
          type="button"
        >
          <LumiTrustSpark
            interactive
            level={summary.level}
            size={presentation === "spark" ? size : "xs"}
          />
          {presentation === "label" ? (
            <span className="truncate">{summary.mark.label}</span>
          ) : null}
        </button>
      </div>
      {panel}
    </>
  );
}

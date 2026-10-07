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
  "M10 1 C10.7 6 14 9.3 19 10 C14 10.7 10.7 14 10 19 C9.3 14 6 10.7 1 10 C6 9.3 9.3 6 10 1Z";

const LUMI_TRUST_MATERIAL = {
  level_1: { name: "Common", edge: "#f58232", base: "#ffb635", light: "#fff1bd" },
  level_2: { name: "Silver", edge: "#939aaa", base: "#b6bdca", light: "#ffffff" },
  level_3: { name: "Gold", edge: "#f29800", base: "#ffc21a", light: "#fffbc4" },
  full: { name: "Diamond", edge: "#ff9c32", base: "#ffcb43", light: "#ffffff" },
} as const;

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
  const gradientId = `lumi-trust-material-${reactId.replace(/:/g, "")}`;
  const glowId = `${gradientId}-glow`;

  if (level === "empty") return null;

  const material = LUMI_TRUST_MATERIAL[level];
  return (
    <svg
      aria-hidden
      className={joinClasses("shrink-0 overflow-visible", LUMI_TRUST_SPARK_SIZE_CLASS[size], className)}
      data-lumi-trust-interactive={interactive ? "true" : undefined}
      data-lumi-trust-level={level}
      data-lumi-trust-material={material.name}
      fill="none"
      viewBox="0 0 20 20"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={material.edge} />
          <stop offset="0.35" stopColor={material.base} />
          <stop offset="0.5" stopColor={material.light} />
          <stop offset="0.65" stopColor={material.base} />
          <stop offset="1" stopColor={material.edge} />
        </linearGradient>
        <radialGradient id={glowId}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.4" stopColor="#fffdf3" stopOpacity="0.95" />
          <stop offset="0.75" stopColor="#ff9662" stopOpacity="0.65" />
          <stop offset="1" stopColor="#ffd51c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path
        d={LUMI_SPARK_PATH}
        fill={level === "level_1" ? "none" : `url(#${gradientId})`}
        stroke={level === "level_1" ? `url(#${gradientId})` : material.edge}
        strokeWidth={level === "level_1" ? 0.65 : 0.15}
      />
      {level === "full" ? <path d={LUMI_SPARK_PATH} fill={`url(#${glowId})`} /> : null}
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
  if (summary.level === "empty") return null;

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
                  if (actionHref.startsWith("#")) {
                    event.preventDefault();
                    window.location.hash = actionHref;
                  }
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

  if (summary.level === "empty") return null;

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

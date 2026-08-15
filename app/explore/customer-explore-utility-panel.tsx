"use client";

import type {
  ExploreDiscoveryResultKind,
  ExploreDiscoveryPreview,
  ExploreDiscoveryShortcut,
} from "@/types/explore";
import Image from "next/image";
import Link from "next/link";
import { useState, type ReactNode } from "react";

type DiscoveryIconName =
  | "calendar"
  | "compass"
  | "flame"
  | "scissors"
  | "sparkle"
  | "star";

function DiscoveryIcon({ name }: { name: DiscoveryIconName }) {
  const common = {
    "aria-hidden": true,
    className: "h-4 w-4",
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
    viewBox: "0 0 24 24",
  };
  const paths: Record<DiscoveryIconName, ReactNode> = {
    calendar: (
      <>
        <rect height="18" rx="2" width="18" x="3" y="4" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </>
    ),
    compass: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z" />
      </>
    ),
    flame: (
      <path d="M8.5 14.5A4.5 4.5 0 0 0 17 12c0-4-4-6-4-9-2.5 1.8-6 5.2-6 9a5 5 0 0 0 10 0" />
    ),
    scissors: (
      <>
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M20 4 8.1 15.9M8.1 8.1 20 20" />
      </>
    ),
    sparkle: (
      <>
        <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
      </>
    ),
    star: (
      <path d="m12 2 3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
    ),
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function shortcutIcon(shortcut: ExploreDiscoveryShortcut): DiscoveryIconName {
  if (shortcut.id === "upcoming-booking") {
    return "calendar";
  }

  if (shortcut.id === "trending") {
    return "sparkle";
  }

  if (shortcut.id === "top-rated") {
    return "star";
  }

  if (shortcut.action.type === "category") {
    return "scissors";
  }

  if (shortcut.id === "recommended") {
    return "sparkle";
  }

  return "compass";
}

function shortcutActive(
  shortcut: ExploreDiscoveryShortcut,
  activeResultKind: ExploreDiscoveryResultKind | null,
) {
  return (
    shortcut.action.type === "result" &&
    shortcut.action.resultKind === activeResultKind
  );
}

function initialsFor(value: string | null | undefined) {
  return (
    value
      ?.replace(/[^a-z0-9\s]/gi, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "R"
  );
}

function moduleAriaLabel(shortcut: ExploreDiscoveryShortcut) {
  return [
    shortcut.actionLabel,
    shortcut.label,
    shortcut.context,
    shortcut.detail,
  ]
    .filter(Boolean)
    .join(". ");
}

function previewGroupLabel(shortcut: ExploreDiscoveryShortcut) {
  const previewLabels = shortcut.previews
    .map((preview) => preview.label)
    .filter(Boolean)
    .slice(0, 3);

  return previewLabels.length > 0
    ? `${shortcut.label} previews: ${previewLabels.join(", ")}`
    : `${shortcut.label} preview`;
}

function DiscoveryPreviewImage({
  className,
  fallbackLabel,
  preview,
  sizes,
}: {
  className: string;
  fallbackLabel: string;
  preview: ExploreDiscoveryPreview | undefined;
  sizes: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = imageFailed ? null : preview?.imageUrl;

  return (
    <span
      className={[
        "relative block overflow-hidden bg-surface-muted",
        className,
      ].join(" ")}
    >
      {imageUrl ? (
        <Image
          alt=""
          className="object-cover transition duration-300 group-hover:scale-[1.025]"
          fill
          loading="lazy"
          onError={() => setImageFailed(true)}
          sizes={sizes}
          src={imageUrl}
        />
      ) : (
        <span className="grid h-full w-full place-items-center bg-[linear-gradient(135deg,#fff0e8,#e7f7f5)] text-sm font-semibold text-brand-orange">
          {initialsFor(preview?.label ?? fallbackLabel)}
        </span>
      )}
    </span>
  );
}

function FeaturedPreviewMosaic({
  shortcut,
}: {
  shortcut: ExploreDiscoveryShortcut;
}) {
  return (
    <span
      aria-label={previewGroupLabel(shortcut)}
      className="grid h-36 grid-cols-[minmax(0,1fr)_4.2rem] gap-1.5"
      role="img"
    >
      <DiscoveryPreviewImage
        className="h-full rounded-[0.85rem]"
        fallbackLabel={shortcut.label}
        preview={shortcut.previews[0]}
        sizes="220px"
      />
      <span className="grid grid-rows-2 gap-1.5">
        <DiscoveryPreviewImage
          className="h-full rounded-[0.7rem]"
          fallbackLabel={shortcut.label}
          preview={shortcut.previews[1]}
          sizes="80px"
        />
        <DiscoveryPreviewImage
          className="h-full rounded-[0.7rem]"
          fallbackLabel={shortcut.label}
          preview={shortcut.previews[2]}
          sizes="80px"
        />
      </span>
    </span>
  );
}

function CompactPreviewStrip({
  shortcut,
}: {
  shortcut: ExploreDiscoveryShortcut;
}) {
  const previews = shortcut.previews.slice(0, 3);
  const gridClass =
    previews.length >= 3
      ? "grid-cols-3"
      : previews.length === 2
        ? "grid-cols-2"
        : "grid-cols-1";

  return (
    <span
      aria-label={previewGroupLabel(shortcut)}
      className={[
        "grid h-16 gap-1 overflow-hidden rounded-[0.75rem]",
        gridClass,
      ].join(" ")}
      role="img"
    >
      {previews.map((preview) => (
        <DiscoveryPreviewImage
          className="h-16"
          fallbackLabel={shortcut.label}
          key={preview.sourceId}
          preview={preview}
          sizes="72px"
        />
      ))}
    </span>
  );
}

function BookingPreview({
  shortcut,
}: {
  shortcut: ExploreDiscoveryShortcut;
}) {
  return (
    <span
      aria-label={previewGroupLabel(shortcut)}
      className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[0.9rem] bg-surface-muted"
      role="img"
    >
      <DiscoveryPreviewImage
        className="h-full w-full rounded-[0.9rem]"
        fallbackLabel={shortcut.context ?? shortcut.label}
        preview={shortcut.previews[0]}
        sizes="64px"
      />
    </span>
  );
}

function DiscoveryModuleText({
  featured = false,
  shortcut,
}: {
  featured?: boolean;
  shortcut: ExploreDiscoveryShortcut;
}) {
  return (
    <span className={featured ? "grid gap-1.5 px-1" : "min-w-0"}>
      <span
        className={[
          "block font-semibold text-text-primary",
          featured ? "text-base" : "truncate text-sm",
        ].join(" ")}
      >
        {shortcut.label}
      </span>
      {shortcut.context ? (
        <span
          className={[
            "block text-text-secondary",
            featured ? "text-sm leading-5" : "truncate text-xs",
          ].join(" ")}
        >
          {shortcut.context}
        </span>
      ) : null}
      {shortcut.detail ? (
        <span
          className={[
            "block text-text-muted",
            featured ? "line-clamp-2 text-xs leading-5" : "mt-1 line-clamp-2 text-xs leading-4",
          ].join(" ")}
        >
          {shortcut.detail}
        </span>
      ) : null}
      <span
        className={[
          "mt-1 block text-xs font-semibold text-brand-orange",
          featured ? "" : "truncate",
        ].join(" ")}
      >
        {shortcut.actionLabel}
      </span>
    </span>
  );
}

function DiscoveryVisualModule({
  activeResultKind,
  featured,
  onSelect,
  shortcut,
}: {
  activeResultKind: ExploreDiscoveryResultKind | null;
  featured: boolean;
  onSelect: (shortcut: ExploreDiscoveryShortcut) => void;
  shortcut: ExploreDiscoveryShortcut;
}) {
  const active = shortcutActive(shortcut, activeResultKind);
  const interactiveClass = [
    "group block w-full rounded-[1rem] bg-white text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
    active
      ? "shadow-[0_14px_34px_rgba(235,111,54,0.1)] ring-1 ring-brand-orange/35"
      : "shadow-[0_12px_28px_rgba(35,25,22,0.045)] ring-1 ring-divider-subtle/75 hover:-translate-y-0.5 hover:shadow-[0_16px_36px_rgba(35,25,22,0.07)]",
    featured ? "p-2.5" : "p-2",
  ].join(" ");
  const content =
    shortcut.moduleKind === "booking" ? (
      <span className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        <BookingPreview shortcut={shortcut} />
        <DiscoveryModuleText shortcut={shortcut} />
      </span>
    ) : featured ? (
      <span className="grid gap-3">
        <FeaturedPreviewMosaic shortcut={shortcut} />
        <DiscoveryModuleText featured shortcut={shortcut} />
      </span>
    ) : (
      <span className="grid gap-2.5">
        <CompactPreviewStrip shortcut={shortcut} />
        <DiscoveryModuleText shortcut={shortcut} />
      </span>
    );

  if (shortcut.action.type === "href") {
    return (
      <Link
        aria-label={moduleAriaLabel(shortcut)}
        className={interactiveClass}
        href={shortcut.action.href}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      aria-label={moduleAriaLabel(shortcut)}
      aria-pressed={active}
      className={interactiveClass}
      onClick={() => onSelect(shortcut)}
      type="button"
    >
      {content}
    </button>
  );
}

export function MobileDiscoveryShortcuts({
  activeResultKind,
  onSelect,
  shortcuts,
}: {
  activeResultKind: ExploreDiscoveryResultKind | null;
  onSelect: (shortcut: ExploreDiscoveryShortcut) => void;
  shortcuts: ExploreDiscoveryShortcut[];
}) {
  if (shortcuts.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Explore discovery shortcuts"
      className="no-scrollbar -mx-4 overflow-x-auto px-4 pb-1 xl:hidden"
      data-testid="explore-mobile-discovery-shortcuts"
    >
      <div className="flex w-max gap-2">
        {shortcuts.map((shortcut) => {
          const active = shortcutActive(shortcut, activeResultKind);
          const className = [
            "inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
            active
              ? "bg-brand-orange-soft text-brand-orange ring-1 ring-brand-orange/35"
              : "bg-surface-elevated text-text-secondary ring-1 ring-divider-subtle/85 hover:text-text-primary hover:ring-brand-orange/25",
          ].join(" ");
          const content = (
            <>
              <DiscoveryIcon name={shortcutIcon(shortcut)} />
              <span>{shortcut.label}</span>
            </>
          );

          if (shortcut.action.type === "href") {
            return (
              <Link className={className} href={shortcut.action.href} key={shortcut.id}>
                {content}
              </Link>
            );
          }

          return (
            <button
              aria-pressed={active}
              className={className}
              key={shortcut.id}
              onClick={() => onSelect(shortcut)}
              type="button"
            >
              {content}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function ExploreDiscoveryRail({
  activeResultKind,
  onSelect,
  shortcuts,
}: {
  activeResultKind: ExploreDiscoveryResultKind | null;
  onSelect: (shortcut: ExploreDiscoveryShortcut) => void;
  shortcuts: ExploreDiscoveryShortcut[];
}) {
  if (shortcuts.length === 0) {
    return null;
  }

  return (
    <aside
      aria-label="Explore discovery"
      className="hidden min-h-[calc(100vh-5.25rem)] min-w-0 bg-transparent px-4 py-5 xl:block 2xl:px-5"
      data-testid="explore-desktop-discovery-rail"
    >
      <div className="sticky top-[5.25rem] grid gap-3.5">
        <div className="px-1">
          <h2 className="text-sm font-semibold text-text-primary">
            Discover
          </h2>
        </div>
        <div className="grid gap-3">
          {shortcuts.map((shortcut, index) => (
            <DiscoveryVisualModule
              activeResultKind={activeResultKind}
              featured={index === 0 && shortcut.previews.length >= 3}
              key={shortcut.id}
              onSelect={onSelect}
              shortcut={shortcut}
            />
          ))}
        </div>
      </div>
    </aside>
  );
}

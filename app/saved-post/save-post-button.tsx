"use client";

import {
  getAccountSavedPostStatesAction,
  setAccountSavedPostAction,
} from "@/app/saved-post/actions";
import { AuthIntentPrompt } from "@/components/auth-intent-prompt";
import {
  savedPostKey,
  type AccountSavedPostTarget,
} from "@/types/saved-post";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type MouseEvent,
  type ReactNode,
} from "react";

const SavePostAuthContext = createContext<boolean | undefined>(undefined);

export function SavePostAuthProvider({ isAuthenticated, children }: {
  isAuthenticated: boolean;
  children: ReactNode;
}) {
  return <SavePostAuthContext.Provider value={isAuthenticated}>{children}</SavePostAuthContext.Provider>;
}

const SAVED_POST_STATE_EVENT = "reylumi:saved-post-state-change";
const SAVED_POST_ORANGE = "var(--brand-orange, #f26f3d)";

type SavePermission = "allowed" | "blocked" | "unknown";

type SavePostButtonProps = {
  className?: string;
  initialSaved?: boolean;
  isAuthenticated?: boolean;
  onSavedChange?: (saved: boolean) => void;
  saveCount?: number | null;
  showTooltip?: boolean;
  size?: "compact" | "default" | "toolbar";
  target: AccountSavedPostTarget | null | undefined;
};

type SavePostButtonInnerProps = Omit<SavePostButtonProps, "target"> & {
  stateKey: string;
  stableTarget: AccountSavedPostTarget;
};

function targetSelector() {
  return (
    document.querySelector<HTMLElement>('[data-saved-post-target="true"]') ??
    document.querySelector<HTMLElement>('[data-more-menu-target="true"]')
  );
}

function dispatchSavedPostStateChange(key: string, saved: boolean, saveCount?: number) {
  window.dispatchEvent(
    new CustomEvent(SAVED_POST_STATE_EVENT, {
      detail: { key, saved, saveCount },
    }),
  );
}

function heartSvg() {
  return `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>`;
}

function animateSavedHeart(button: HTMLButtonElement | null) {
  if (
    !button ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  const target = targetSelector();
  const originRect = button.getBoundingClientRect();
  const targetRect = target?.getBoundingClientRect();
  const startX = originRect.left + originRect.width / 2;
  const startY = originRect.top + originRect.height / 2;
  const endX = targetRect
    ? targetRect.left + targetRect.width / 2
    : startX - 36;
  const endY = targetRect
    ? targetRect.top + targetRect.height / 2
    : startY - 46;
  const flyer = document.createElement("span");

  flyer.innerHTML = heartSvg();
  flyer.style.left = `${startX}px`;
  flyer.style.top = `${startY}px`;
  flyer.style.position = "fixed";
  flyer.style.zIndex = "9999";
  flyer.style.width = "28px";
  flyer.style.height = "28px";
  flyer.style.color = SAVED_POST_ORANGE;
  flyer.style.fill = "currentColor";
  flyer.style.filter = "drop-shadow(0 10px 18px rgba(242,111,61,.3))";
  flyer.style.pointerEvents = "none";
  flyer.style.transform = "translate(-50%, -50%) scale(1)";
  document.body.append(flyer);

  const animation = flyer.animate(
    [
      {
        opacity: 1,
        transform: "translate(-50%, -50%) scale(1)",
      },
      {
        opacity: 0.95,
        transform: `translate(calc(-50% + ${(endX - startX) * 0.58}px), calc(-50% + ${(endY - startY) * 0.22 - 38}px)) scale(1.18)`,
      },
      {
        opacity: 0,
        transform: `translate(calc(-50% + ${endX - startX}px), calc(-50% + ${endY - startY}px)) scale(.38)`,
      },
    ],
    {
      duration: 720,
      easing: "cubic-bezier(.2,.8,.2,1)",
    },
  );

  animation.onfinish = () => flyer.remove();
  animation.oncancel = () => flyer.remove();
}

function normalizedSaveCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}

function SavePostButtonInner({
  className = "",
  initialSaved,
  isAuthenticated,
  onSavedChange,
  saveCount,
  showTooltip = false,
  size = "default",
  stableTarget,
  stateKey,
}: SavePostButtonInnerProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const tooltipId = useId();
  const [isPending, startTransition] = useTransition();
  const stateCheckVersionRef = useRef(0);
  const mutationPendingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savePermission, setSavePermission] = useState<SavePermission>(
    isAuthenticated === false ? "blocked" : initialSaved !== undefined ? "allowed" : "unknown",
  );
  const [saved, setSaved] = useState(initialSaved ?? false);
  const [displaySaveCount, setDisplaySaveCount] = useState(() =>
    normalizedSaveCount(saveCount),
  );
  const [message, setMessage] = useState("");
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const stableSalonId = stableTarget.salonId;
  const stableSourceId = stableTarget.sourceId;
  const stableSourceType = stableTarget.sourceType;
  const isToolbar = size === "toolbar";

  useEffect(() => {
    if (initialSaved !== undefined) {
      return;
    }

    let active = true;
    const checkVersion = stateCheckVersionRef.current;
    const targetForRequest = {
      salonId: stableSalonId,
      sourceId: stableSourceId,
      sourceType: stableSourceType,
    };

    startTransition(async () => {
      try {
        const result = await getAccountSavedPostStatesAction([targetForRequest]);

        if (!active || result.error || checkVersion !== stateCheckVersionRef.current) {
          return;
        }

        const serverSaved = result.savedKeys.includes(stateKey);
        const serverSaveCount = result.saveCountsByKey[stateKey];

        setSavePermission(result.canSave ? "allowed" : "blocked");
        setSaved(serverSaved);
        if (typeof serverSaveCount === "number") {
          setDisplaySaveCount(normalizedSaveCount(serverSaveCount));
        }
        dispatchSavedPostStateChange(stateKey, serverSaved, serverSaveCount);
      } catch {
        if (active) setMessage("Saved post status could not be loaded.");
      }
    });

    return () => {
      active = false;
    };
  }, [
    initialSaved,
    stableSalonId,
    stableSourceId,
    stableSourceType,
    stateKey,
  ]);

  useEffect(() => {
    function onStateChange(event: Event) {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const detail = event.detail as
        | { key?: unknown; saved?: unknown; saveCount?: unknown }
        | null
        | undefined;

      if (detail?.key === stateKey && typeof detail.saved === "boolean") {
        stateCheckVersionRef.current += 1;
        setSaved(detail.saved);
        if (typeof detail.saveCount === "number" && Number.isFinite(detail.saveCount)) {
          setDisplaySaveCount(normalizedSaveCount(detail.saveCount));
        }
      }
    }

    window.addEventListener(SAVED_POST_STATE_EVENT, onStateChange);

    return () => {
      window.removeEventListener(SAVED_POST_STATE_EVENT, onStateChange);
    };
  }, [stateKey]);

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (mutationPendingRef.current) {
      return;
    }

    if (savePermission === "blocked") {
      setMessage("Sign in to save posts.");
      setAuthPromptOpen(true);
      return;
    }

    const previousSaved = saved;
    const nextSaved = !previousSaved;
    const previousSaveCount = displaySaveCount;
    const canOptimisticallyUpdate = savePermission === "allowed";

    mutationPendingRef.current = true;
    stateCheckVersionRef.current += 1;
    setMessage("");
    setIsSaving(true);

    if (canOptimisticallyUpdate) {
      setSaved(nextSaved);
      setDisplaySaveCount((current) =>
        Math.max(0, current + (nextSaved ? 1 : -1)),
      );
      onSavedChange?.(nextSaved);
      dispatchSavedPostStateChange(stateKey, nextSaved, Math.max(0, previousSaveCount + (nextSaved ? 1 : -1)));

      if (nextSaved) {
        animateSavedHeart(buttonRef.current);
      }
    } else {
      setMessage("Saving...");
    }

    startTransition(async () => {
      try {
        const result = await setAccountSavedPostAction(stableTarget, nextSaved);

        if (result.error) {
          if (canOptimisticallyUpdate) {
            setSaved(previousSaved);
            setDisplaySaveCount(previousSaveCount);
            onSavedChange?.(previousSaved);
            dispatchSavedPostStateChange(stateKey, previousSaved, previousSaveCount);
          }
          if (result.authRequired) {
            setSavePermission("blocked");
            setAuthPromptOpen(true);
          }
          setMessage(result.error);
          return;
        }

        setSavePermission("allowed");
        setSaved(result.active);
        if (typeof result.saveCount === "number") {
          setDisplaySaveCount(normalizedSaveCount(result.saveCount));
        } else if (!canOptimisticallyUpdate) {
          setDisplaySaveCount((current) =>
            Math.max(0, current + (result.active ? 1 : -1)),
          );
        }
        onSavedChange?.(result.active);
        dispatchSavedPostStateChange(stateKey, result.active,
          typeof result.saveCount === "number" ? result.saveCount :
            Math.max(0, previousSaveCount + (result.active === previousSaved ? 0 : result.active ? 1 : -1)));
        if (!canOptimisticallyUpdate && result.active) {
          animateSavedHeart(buttonRef.current);
        }
        setMessage(result.active ? "Post saved." : "Post removed.");
      } catch {
        if (canOptimisticallyUpdate) {
          setSaved(previousSaved);
          setDisplaySaveCount(previousSaveCount);
          onSavedChange?.(previousSaved);
          dispatchSavedPostStateChange(stateKey, previousSaved, previousSaveCount);
        }
        setMessage("Connection interrupted. Refresh to check whether the post was saved.");
      } finally {
        mutationPendingRef.current = false;
        setIsSaving(false);
      }
    });
  }

  const saveTooltip =
    savePermission === "blocked"
      ? "Sign in to save post"
      : saved
        ? "Saved"
        : "Save post";
  const saveAriaLabel =
    savePermission === "blocked"
      ? "Sign in to save post"
      : saved
        ? "Remove from Saved Post"
        : "Save post";

  return (
    <span
      className={[
        "z-20",
        isToolbar ? "inline-flex min-w-0" : "inline-grid",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={[
          "group/save relative",
          isToolbar ? "inline-flex min-w-0" : "inline-grid",
        ].join(" ")}
      >
        <button
          aria-describedby={showTooltip ? tooltipId : undefined}
          aria-label={saveAriaLabel}
          aria-pressed={saved}
          className={[
            isToolbar
              ? "inline-flex min-h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-none bg-transparent px-1.5 py-2 text-xs font-semibold text-zinc-600 transition hover:bg-zinc-50 hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-orange"
              : "grid place-items-center rounded-full bg-white/92 text-zinc-700 shadow-[0_10px_24px_rgba(24,24,27,.18)] ring-1 ring-white/80 backdrop-blur transition hover:scale-105 hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange",
            !isToolbar && size === "compact" ? "h-8 w-8" : "",
            !isToolbar && size !== "compact" ? "h-10 w-10" : "",
            saved
              ? isToolbar
                ? "text-brand-orange"
                : "text-brand-orange ring-brand-orange/30"
              : "",
            isSaving || isPending ? "cursor-wait" : "",
          ].join(" ")}
          data-saving={isSaving || isPending ? "true" : undefined}
          onClick={toggle}
          ref={buttonRef}
          type="button"
        >
          <svg
            aria-hidden="true"
            className={[
              size === "compact" || isToolbar ? "h-4 w-4" : "h-5 w-5",
              isToolbar ? "shrink-0" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            fill={saved ? "currentColor" : "none"}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" />
          </svg>
          {isToolbar ? (
            <span className="min-w-0 truncate">{saved ? "Loved" : "Love"}</span>
          ) : null}
          {isToolbar && displaySaveCount > 0 ? (
            <span className="shrink-0 text-[11px] font-bold tabular-nums text-zinc-500">
              {displaySaveCount}
            </span>
          ) : null}
        </button>
        {!isToolbar && displaySaveCount > 0 ? (
          <span className="pointer-events-none absolute -right-1.5 -top-1.5 z-10 min-w-5 rounded-full bg-brand-orange px-1.5 py-0.5 text-center text-[10px] font-extrabold leading-none text-white shadow-[0_8px_18px_rgba(242,111,61,.28)] ring-2 ring-white">
            +{displaySaveCount}
          </span>
        ) : null}
        {showTooltip ? (
          <span
            className="pointer-events-none absolute bottom-full right-0 z-20 mb-2 hidden whitespace-nowrap rounded-lg bg-zinc-950 px-2.5 py-1.5 text-[11px] font-semibold text-white shadow-lg group-hover/save:block group-focus-within/save:block"
            id={tooltipId}
            role="tooltip"
          >
            {saveTooltip}
          </span>
        ) : null}
      </span>
      <span aria-live="polite" className="sr-only">
        {message}
      </span>
      {authPromptOpen ? (
        <AuthIntentPrompt
          kicker="Save intent"
          onClose={() => setAuthPromptOpen(false)}
          title="Save this look?"
        >
          Create a free ReyLUMI account to keep your inspiration, follow the
          artist or shop, and come back when you are ready to book.
        </AuthIntentPrompt>
      ) : null}
    </span>
  );
}

export function SavePostButton({
  className = "",
  initialSaved,
  isAuthenticated,
  onSavedChange,
  saveCount,
  showTooltip,
  size = "default",
  target,
}: SavePostButtonProps) {
  const inheritedAuth = useContext(SavePostAuthContext);
  const authenticated = isAuthenticated ?? inheritedAuth;
  const sourceId = target?.sourceId.trim();

  if (!target || !sourceId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sourceId)) {
    return null;
  }

  const stableTarget = {
    salonId: target.salonId?.trim() || null,
    sourceId,
    sourceType: target.sourceType,
  };
  const stateKey = savedPostKey(stableTarget);

  return (
    <SavePostButtonInner
      className={className}
      initialSaved={initialSaved}
      isAuthenticated={authenticated}
      key={`${stateKey}:${authenticated ?? "unknown"}`}
      onSavedChange={onSavedChange}
      saveCount={saveCount}
      showTooltip={showTooltip}
      size={size}
      stableTarget={stableTarget}
      stateKey={stateKey}
    />
  );
}

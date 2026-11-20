"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTransientOverlay } from "./overlay-dismissal";
import { FilterIcon, toolbarStyles as styles } from "./workspace-toolbar";

const subscribeCapabilities = () => () => {};
const popoverCapability = () => "popover" in HTMLElement.prototype
  && typeof HTMLElement.prototype.showPopover === "function"
  && typeof HTMLElement.prototype.hidePopover === "function";
const serverPopoverCapability = () => null;

/** Both top-layer variants keep controls in their original form while closed. */
export function CompactFilters({ children, label = "Filters", active = false, icon }: {
  children: ReactNode; label?: string; active?: boolean; icon?: ReactNode;
}) {
  const __vt = useWorkspaceTranslation();

  const [open, setOpen] = useState(false);
  const nativePopover = useSyncExternalStore(subscribeCapabilities, popoverCapability, serverPopoverCapability);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const lastPanel = useRef<HTMLDivElement | HTMLDialogElement | null>(null);
  const id = useId();
  const path = usePathname();
  const search = useSearchParams();
  const route = `${path}?${search}`;
  useLayoutEffect(() => { lastPanel.current = panel.current ?? dialog.current; });
  const close = useCallback((restoreFocus = false) => {
    const element = panel.current ?? dialog.current ?? lastPanel.current;
    if (element) {
      if (element instanceof HTMLDialogElement) {
        if (element.open) element.close();
        element.hidden = true;
      } else if (element.isConnected && typeof element.hidePopover === "function") element.hidePopover();
    }
    if (restoreFocus && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true });
  }, []);
  useEffect(() => { close(); }, [route, close]);
  useEffect(() => {
    const reset = () => close();
    const events = ["reylumi:app-local-reset", "reylumi:experience-reset", "reylumi:app-local-access-changed", "reylumi:experience-access-changed"];
    for (const event of events) window.addEventListener(event, reset);
    return () => { for (const event of events) window.removeEventListener(event, reset); };
  }, [close]);
  // Activity disconnects effects without discarding the controls or their draft.
  useTransientOverlay(close, true, true);
  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    const element = panel.current ?? dialog.current;
    if (!rect || !element) return;
    const width = Math.min(360, window.innerWidth - 24);
    const top = Math.min(rect.bottom + 6, Math.max(12, window.innerHeight - 240));
    Object.assign(element.style, { top: `${top}px`, left: `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`, width: `${width}px`, maxHeight: `${window.innerHeight - top - 12}px` });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, place]);
  const finishSubmit = useCallback(() => {
    // Accepted JS navigation also prevents default, even for the same query.
    // Only submissions that bubble past their own guards reach this closer.
    queueMicrotask(() => close());
  }, [close]);
  useEffect(() => {
    if (!open) return;
    const element = panel.current ?? dialog.current;
    const owner = trigger.current?.closest("form");
    if (!element || !owner) return;
    const submitted = (event: SubmitEvent) => {
      if (event.target !== owner) return;
      if (event.submitter && element.contains(event.submitter)
        || document.activeElement && element.contains(document.activeElement)) finishSubmit();
    };
    // React's pending/dirty stopPropagation guards run before document bubble.
    owner.ownerDocument.addEventListener("submit", submitted);
    return () => owner.ownerDocument.removeEventListener("submit", submitted);
  }, [open, finishSubmit]);
  const fallback = nativePopover === false;
  const contents = <>
    <div className={styles.panelTitle}><span><WorkspaceText text={label} /></span><button type="button" aria-label={__vt(`Close ${label}`)}
      popoverTarget={fallback ? undefined : id} popoverTargetAction={fallback ? undefined : "hide"}
      onClick={fallback ? () => close(true) : undefined}>×</button></div>
    {children}
  </>;
  return <>
    <button ref={trigger} type="button" className={styles.icon} aria-label={__vt(active ? `${label}: filters applied` : label)}
      title={__vt(label)} aria-expanded={open} aria-controls={id} popoverTarget={fallback ? undefined : id}
      onClick={fallback ? () => {
        const element = dialog.current;
        if (!element) return;
        if (element.open) { close(true); return; }
        element.hidden = false;
        place();
        element.showModal();
        setOpen(true);
      } : undefined}>
      {icon ?? <FilterIcon />}{active && <span aria-hidden="true" className="ml-1 h-1.5 w-1.5 rounded-full bg-teal-600" />}
    </button>
    {fallback ? <dialog ref={dialog} id={id} aria-label={__vt(label)} className={styles.panel} data-compact-dialog=""
      hidden={!open} onClose={() => {
        // A prior close event can be queued after a synchronous reopen.
        if (dialog.current?.open) return;
        setOpen(false);
        if (dialog.current) dialog.current.hidden = true;
      }}
      onCancel={event => { event.preventDefault(); close(true); }} onSubmit={finishSubmit}
      onPointerDown={event => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(true);
      }}>{contents}</dialog> : <div ref={panel} id={id} popover="auto" role="group" aria-label={__vt(label)} className={styles.panel}
      hidden={nativePopover === null ? true : undefined}
      onToggle={event => setOpen(event.newState === "open")}
      onSubmit={finishSubmit}>{contents}</div>}
  </>;
}

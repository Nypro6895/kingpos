"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { FilterIcon, toolbarStyles as styles } from "./workspace-toolbar";

/** Native popovers retain values and form ownership while closed. */
export function CompactFilters({ children, label = "Filters", active = false }: {
  children: ReactNode; label?: string; active?: boolean;
}) {
  const __vt = useWorkspaceTranslation();

  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const path = usePathname();
  const search = useSearchParams();
  const route = `${path}?${search}`;
  useEffect(() => { panel.current?.hidePopover(); }, [route]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      const element = panel.current;
      if (!rect || !element) return;
      const width = Math.min(360, window.innerWidth - 24);
      const top = Math.min(rect.bottom + 6, Math.max(12, window.innerHeight - 240));
      Object.assign(element.style, { top: `${top}px`, left: `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`, width: `${width}px`, maxHeight: `${window.innerHeight - top - 12}px` });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className={styles.icon} aria-label={__vt(active ? `${label}: filters applied` : label)}
      title={__vt(label)} aria-expanded={open} aria-controls={id} popoverTarget={id}>
      <FilterIcon />{active && <span aria-hidden="true" className="ml-1 h-1.5 w-1.5 rounded-full bg-teal-600" />}
    </button>
    <div ref={panel} id={id} popover="auto" role="group" aria-label={__vt(label)} className={styles.panel}
      onToggle={event => setOpen(event.newState === "open")}
      onSubmit={() => panel.current?.hidePopover()}>
      <div className={styles.panelTitle}><span><WorkspaceText text={label} /></span><button type="button" aria-label={__vt(`Close ${label}`)} popoverTarget={id} popoverTargetAction="hide">×</button></div>
      {children}
    </div>
  </>;
}

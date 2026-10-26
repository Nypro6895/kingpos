"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExploreSearchInput } from "@/app/explore/explore-search-input";
import { EXPLORE_HEADER_SLOT_EVENT } from "@/app/explore/explore-header-search-slot";
import { ReylumiIcon } from "@/components/reylumi-icons";
import type { ExploreSearchSuggestion } from "@/lib/explore-search-suggestions";
import type { ExploreLocationSource } from "@/types/explore";

type Scope = "fixed" | "expandable";
type Props = {
  initialDraftValue?: string;
  restoreInitialFocus?: boolean;
  query: string;
  category: string;
  location: string;
  locationSource: ExploreLocationSource;
  scopePolicy: Scope;
  locating: boolean;
  pending: boolean;
  message: string | null;
  areaOpen: boolean;
  onAreaOpenChange: (open: boolean) => void;
  onSearch: (query: string) => void;
  onDraftChange: () => void;
  onSuggestionSelect: (suggestion: ExploreSearchSuggestion) => void;
  onAreaApply: (location: string, scope: Scope) => void;
  onCurrentLocation: () => void;
};

export function ExploreSearchToolbar(props: Props) {
  const areaButton = useRef<HTMLButtonElement>(null);
  const toolbarRoot = useRef<HTMLDivElement>(null);
  const currentHeaderTarget = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<{ input: HTMLInputElement; start: number | null; end: number | null } | null>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState({ committed: props.query, value: props.initialDraftValue ?? props.query });
  useEffect(() => {
    if (!props.restoreInitialFocus) return;
    const input = toolbarRoot.current?.querySelector<HTMLInputElement>('input[name="q"]');
    if (input && (document.activeElement === document.body || document.activeElement === input)) { input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); }
  }, [props.restoreInitialFocus]);
  useLayoutEffect(() => {
    const handoff = pendingFocus.current;
    pendingFocus.current = null;
    if (!handoff || document.activeElement !== document.body && document.activeElement !== handoff.input) return;
    const input = toolbarRoot.current?.querySelector<HTMLInputElement>('input[name="q"]');
    if (!input) return;
    input.focus({ preventScroll: true });
    input.setSelectionRange(handoff.start, handoff.end);
  }, [headerTarget]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const update = () => {
      const target = media.matches ? document.querySelector<HTMLElement>("[data-explore-header-search]") : null;
      if (currentHeaderTarget.current === target) return;
      const input = toolbarRoot.current?.querySelector<HTMLInputElement>('input[name="q"]');
      // Snapshot only when moving the toolbar. Updating parent state in input
      // capture can restore the old controlled value before onChange reads it.
      if (input) setDraft({ committed: props.query, value: input.value });
      pendingFocus.current = input && document.activeElement === input ? { input, start: input.selectionStart, end: input.selectionEnd } : null;
      currentHeaderTarget.current = target;
      setHeaderTarget(target);
    };
    const frame = window.requestAnimationFrame(update);
    media.addEventListener("change", update);
    window.addEventListener(EXPLORE_HEADER_SLOT_EVENT, update);
    return () => {
      window.cancelAnimationFrame(frame);
      media.removeEventListener("change", update);
      window.removeEventListener(EXPLORE_HEADER_SLOT_EVENT, update);
    };
  }, [props.query]);
  const restoreAreaFocus = useCallback(() => areaButton.current?.focus({ preventScroll: true }), []);
  const areaLabel = props.locating ? "Locating…" : props.location || "Anywhere";
  const toolbar = (
    <div ref={toolbarRoot} data-testid="explore-search-toolbar" className="min-w-0">
      <form action="/explore" method="get" role="search" aria-label="Search Explore"
        className="relative flex min-w-0 items-center gap-1 rounded-xl bg-surface-muted px-1 ring-1 ring-divider-subtle/60 focus-within:ring-brand-orange/40"
        onSubmit={event => {
          event.preventDefault();
          props.onSearch(String(new FormData(event.currentTarget).get("q") ?? "").trim());
        }}>
        <label htmlFor="explore-search-query" className="sr-only">Search salons, services, cities, states, ZIP or ideas</label>
        <div className="min-w-0 flex-1">
          <ExploreSearchInput id="explore-search-query" name="q" defaultValue={props.query}
            initialDraftValue={draft.committed === props.query ? draft.value : props.query}
            className="h-12 w-full min-w-0 rounded-xl bg-transparent pl-3 pr-1 text-[16px] text-text-primary outline-none placeholder:text-text-muted"
            placeholder="Salons, services or ideas" category={props.category} location={props.location}
            onLiveSearch={props.onSearch} onDraftChange={props.onDraftChange} livePaused={props.areaOpen}
            scopePolicy={props.scopePolicy} target="auto" onSuggestionSelect={props.onSuggestionSelect} />
        </div>
        <button ref={areaButton} id="explore-search-area" type="button"
          aria-label={`Search area: ${areaLabel}`} aria-haspopup="dialog" aria-expanded={props.areaOpen}
          title={`Search area: ${areaLabel}`} onClick={() => props.onAreaOpenChange(true)}
          className="flex min-h-11 max-w-[42%] shrink-0 items-center gap-1.5 border-l border-divider-subtle px-2 text-xs font-medium text-brand-teal transition hover:bg-brand-teal-soft focus-visible:outline-2 focus-visible:outline-brand-teal sm:max-w-56 sm:px-3">
          <ReylumiIcon name="map-pin" className="size-4 shrink-0" />
          <span className="truncate">{areaLabel}</span><span aria-hidden="true">⌄</span>
        </button>
        <input type="hidden" name="location" value={props.location} />
        <input type="hidden" name="locationSource" value={props.locationSource} />
        <input type="hidden" name="category" value={props.category} />
        <input type="hidden" name="scope" value={props.scopePolicy} />
        <input type="hidden" name="type" value="auto" />
        <button type="submit" aria-label="Search" aria-busy={props.pending}
          className="grid size-11 shrink-0 place-items-center rounded-lg text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-brand-orange disabled:opacity-60">
          <ReylumiIcon name="search" className="size-5" />
        </button>
      </form>
      {props.message ? <p role="status" className="px-2 pt-1 text-xs text-text-secondary">{props.message}</p> : null}
      {props.areaOpen ? <ExploreAreaDialog location={props.location} scopePolicy={props.scopePolicy}
        locating={props.locating} onApply={props.onAreaApply}
        onCurrentLocation={() => { props.onAreaOpenChange(false); props.onCurrentLocation(); }}
        onClose={() => props.onAreaOpenChange(false)} onRestoreFocus={restoreAreaFocus} /> : null}
    </div>
  );
  return headerTarget ? createPortal(toolbar, headerTarget) : toolbar;
}

function ExploreAreaDialog({ location, scopePolicy, locating, onApply, onCurrentLocation, onClose, onRestoreFocus }: {
  location: string; scopePolicy: Scope; locating: boolean;
  onApply: (location: string, scope: Scope) => void;
  onCurrentLocation: () => void; onClose: () => void; onRestoreFocus: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draftLocation, setDraftLocation] = useState(location);
  const [expand, setExpand] = useState(scopePolicy === "expandable");
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); document.body.style.overflow = overflow; onRestoreFocus(); };
  }, [onRestoreFocus]);
  return createPortal(
    <dialog ref={dialog} aria-labelledby="explore-area-title" data-testid="explore-area-dialog"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-sm overflow-visible rounded-3xl bg-white p-5 text-text-primary shadow-xl backdrop:bg-black/35">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="explore-area-title" className="text-lg font-semibold">Search area</h2>
        <button type="button" onClick={onClose} aria-label="Close search area" className="grid size-11 place-items-center rounded-full text-xl hover:bg-surface-muted">×</button>
      </div>
      <button type="button" onClick={onCurrentLocation} disabled={locating}
        className="mb-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-brand-teal-soft px-4 text-sm font-semibold text-brand-teal disabled:opacity-60">
        <ReylumiIcon name="map-pin" className="size-4" />{locating ? "Locating…" : "Use current location"}
      </button>
      <form onSubmit={event => { event.preventDefault(); onApply(draftLocation.trim(), expand ? "expandable" : "fixed"); onClose(); }}>
        <label htmlFor="explore-area-input" className="sr-only">City, state or ZIP</label>
        <input id="explore-area-input" name="area" type="text" maxLength={160} value={draftLocation}
          onChange={event => setDraftLocation(event.target.value)} placeholder="City, state or ZIP"
          className="h-12 w-full rounded-xl border border-divider-subtle px-3 text-[16px] outline-none focus:border-brand-orange" />
        <label className="my-2 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={expand} onChange={event => setExpand(event.target.checked)} />Include nearby areas
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => { onApply("", "expandable"); onClose(); }} className="min-h-11 flex-1 rounded-full bg-surface-muted px-4 text-sm font-semibold">Anywhere</button>
          <button type="submit" className="min-h-11 flex-1 rounded-full bg-brand-orange px-4 text-sm font-semibold text-white">Apply</button>
        </div>
      </form>
    </dialog>, document.body,
  );
}

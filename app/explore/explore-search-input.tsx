"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createExploreLiveSearchScheduler } from "@/lib/explore-live-search";
import { WorkspaceText } from "@/components/workspace-language";
import type { ExploreSearchSuggestion } from "@/lib/explore-search-suggestions";

type Props = {
  id: string; name?: "q"; defaultValue: string; className: string; placeholder: string;
  // Restores an unsubmitted draft when the same toolbar moves into the desktop header.
  initialDraftValue?: string;
  category?: string; location?: string; scopePolicy?: "fixed" | "expandable";
  target?: "auto" | "salons" | "posts";
  onLiveSearch?: (query: string) => void;
  onDraftChange?: () => void;
  livePaused?: boolean;
  onSuggestionSelect?: (suggestion: ExploreSearchSuggestion) => void;
};

function suggestions(value: unknown): ExploreSearchSuggestion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).filter((item): item is ExploreSearchSuggestion => {
    if (!item || typeof item !== "object") return false;
    const row = item as Partial<ExploreSearchSuggestion>;
    return typeof row.id === "string" && row.id.length <= 180 && typeof row.label === "string" && row.label.length <= 160
      && typeof row.query === "string" && row.query.length <= 160 && typeof row.detail === "string"
      && ["salon", "area", "service", "idea"].includes(row.kind ?? "") && ["salons", "posts", "auto"].includes(row.target ?? "")
      && (row.location === undefined || typeof row.location === "string" && row.location.length <= 160)
      && (row.category === undefined || typeof row.category === "string" && row.category.length <= 80);
  });
}

/** Suggestions and optional live results share one stable, focused input. */
export function ExploreSearchInput(props: Props) {
  return <SearchInputSession key={props.onLiveSearch ? "live" : props.defaultValue} {...props} />;
}

function SearchInputSession(props: Props) {
  const [value, setValue] = useState(props.initialDraftValue ?? props.defaultValue);
  const [committedValue, setCommittedValue] = useState(props.defaultValue);
  if (committedValue !== props.defaultValue) {
    setCommittedValue(props.defaultValue);
    // A live search normalizes its query; the draft still owns its spaces and
    // caret. Only a different committed query should replace the visible text.
    if (value.trim() !== props.defaultValue) setValue(props.defaultValue);
  }
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [suggestionState, setSuggestions] = useState<{ key: string; rows: ExploreSearchSuggestion[] }>({ key: "", rows: [] });
  const [active, setActive] = useState(-1);
  const [liveSearch] = useState(createExploreLiveSearchScheduler);
  const composingRef = useRef(false);
  useEffect(() => () => liveSearch.cancel(), [liveSearch]);
  // Cancel the old draft during the commit, before a new input event can
  // schedule its next search. A delayed effect could cancel that newer draft.
  useLayoutEffect(() => { liveSearch.cancel(); }, [props.defaultValue, liveSearch]);
  useEffect(() => { if (props.livePaused) liveSearch.cancel(); }, [props.livePaused, liveSearch]);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const metadataRequest = useRef<AbortController | null>(null);
  const metadataDelay = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();
  const requestKey = JSON.stringify([value, props.category ?? "", props.location ?? ""]);
  const options = suggestionState.key === requestKey ? suggestionState.rows : [];
  const shown = focused && !composing && options.length > 0;

  const cancelMetadata = useCallback(() => {
    ++requestSequence.current;
    if (metadataDelay.current) clearTimeout(metadataDelay.current);
    if (metadataDeadline.current) clearTimeout(metadataDeadline.current);
    metadataDelay.current = null;
    metadataDeadline.current = null;
    metadataRequest.current?.abort();
    metadataRequest.current = null;
  }, []);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    // Native GET navigation may leave this document before effect cleanup runs.
    const onSubmit = (event: Event) => {
      if (composingRef.current) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      liveSearch.cancel(); cancelMetadata();
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, [cancelMetadata, liveSearch]);

  useEffect(() => {
    cancelMetadata();
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    metadataRequest.current = controller;
    if (!focused || composing || value.trim().length < 2) return cancelMetadata;
    metadataDelay.current = setTimeout(async () => {
      metadataDelay.current = null;
      // Leave network time for the API's bounded 3.5s fallback response.
      metadataDeadline.current = setTimeout(() => controller.abort(), 4500);
      try {
        const params = new URLSearchParams({ q: value.trim().slice(0, 80) });
        if (props.category) params.set("category", props.category);
        if (props.location) params.set("location", props.location);
        const response = await fetch(`/api/explore/suggestions?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { suggestions?: unknown };
        if (!controller.signal.aborted && requestSequence.current === sequence) {
          setSuggestions({ key: requestKey, rows: suggestions(body.suggestions) });
          setActive(-1);
        }
      } catch { /* An optional suggestion failure does not interrupt the submitted search. */ }
      finally {
        if (metadataRequest.current === controller) {
          if (metadataDeadline.current) clearTimeout(metadataDeadline.current);
          metadataDeadline.current = null;
          metadataRequest.current = null;
        }
      }
    }, 280);
    return cancelMetadata;
  }, [value, focused, composing, props.category, props.location, requestKey, cancelMetadata]);

  function choose(option: ExploreSearchSuggestion) {
    liveSearch.cancel();
    props.onDraftChange?.();
    cancelMetadata();
    setValue(option.query); setSuggestions({ key: "", rows: [] }); setActive(-1); setFocused(false);
    inputRef.current?.blur();
    props.onSuggestionSelect?.(option);
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (composingRef.current || composing || event.nativeEvent.isComposing || event.keyCode === 229) {
      if (event.key === "Enter") event.preventDefault();
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); cancelMetadata(); setSuggestions({ key: "", rows: [] }); setActive(-1); return; }
    if (event.key === "Enter") {
      if (shown && active >= 0 && options[active]) {
        event.preventDefault(); choose(options[active]);
      } else {
        cancelMetadata(); setSuggestions({ key: "", rows: [] }); setActive(-1); setFocused(false);
      }
      return;
    }
    if (!shown) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(index => event.key === "ArrowDown" ? (index + 1) % options.length : (index <= 0 ? options.length - 1 : index - 1));
    }
  }
  return <div className="relative min-w-0">
    <input ref={inputRef} id={props.id} name={props.name} value={value} type="search" enterKeyHint="search" autoComplete="off" maxLength={160}
      role="combobox" aria-autocomplete="list" aria-expanded={shown} aria-controls={listId}
      aria-activedescendant={shown && active >= 0 && options[active] ? `${listId}-${active}` : undefined}
      className={props.className} placeholder={props.placeholder}
      onChange={event => {
        const next = event.target.value;
        setValue(next); setActive(-1); setFocused(true);
        props.onDraftChange?.();
        if (!composingRef.current && !props.livePaused && props.onLiveSearch) liveSearch.schedule(next, props.onLiveSearch);
      }} onFocus={() => setFocused(true)}
      onBlur={() => { cancelMetadata(); setFocused(false); setSuggestions({ key: "", rows: [] }); setActive(-1); }} onKeyDown={keyDown}
      onCompositionStart={() => { composingRef.current = true; liveSearch.cancel(); props.onDraftChange?.(); setComposing(true); setActive(-1); }}
      onCompositionEnd={event => {
        composingRef.current = false; setComposing(false);
        if (!props.livePaused && props.onLiveSearch) liveSearch.schedule(event.currentTarget.value, props.onLiveSearch);
      }} />
    {shown ? <div id={listId} role="listbox" aria-label="Search suggestions"
      className="absolute left-0 right-0 top-full z-[70] mt-2 max-h-80 overflow-y-auto rounded-2xl border border-border-subtle bg-white p-1 shadow-xl">
      {options.map((option, index) => <button key={option.id} id={`${listId}-${index}`} type="button" role="option"
        aria-selected={active === index} onPointerDown={event => event.preventDefault()} onClick={() => choose(option)}
        className={`flex w-full flex-col rounded-xl px-3 py-2 text-left text-sm transition hover:bg-orange-50 ${active === index ? "bg-orange-50" : ""}`}>
        <span className="font-semibold text-text-primary">{option.label}</span>
        {option.detail ? <span className="text-xs text-text-secondary"><WorkspaceText text={option.detail} /></span> : null}
      </button>)}
    </div> : null}
  </div>;
}

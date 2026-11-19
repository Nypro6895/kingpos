"use client";

import { APP_LOCAL_SEARCH_NAVIGATION_EVENT, type AppLocalSearchNavigationDetail } from "./app-local-search-navigation";

let searchNavigationSequence = 0;
let supportsFormDataSubmitter: boolean | undefined;

export type AppLocalLinkNavigation = {
  navigate(path: string): void | Promise<void>;
  isLocalRoute(path: string): boolean;
  openOnline(path: string): void | Promise<void>;
  /** Optional existing native HTTPS/Safari handler; ordinary links keep their default without it. */
  openExternal?(url: string): void | Promise<void>;
  onError?(error: unknown): void;
  getScope?(): string | undefined;
  /** Exact paths from the signed package, never arbitrary user/private uploads. */
  helpImagePaths?: readonly string[];
};

function primary(event: MouseEvent) { return !event.defaultPrevented && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey; }
function anchorFor(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
  const anchor = target?.closest<HTMLAnchorElement>("a[href]");
  return anchor && !anchor.hasAttribute("download") && !anchor.hasAttribute("target") && !anchor.closest("[contenteditable=true]") ? anchor : null;
}
function safeUrl(anchor: HTMLAnchorElement) {
  const href = anchor.getAttribute("href") ?? "";
  if (!href || href.length > 8192 || /[\\\u0000-\u001f]/.test(href)) return null;
  try { const url = new URL(href, location.href); return url.username || url.password ? null : url; } catch { return null; }
}
function isDocumentAuthority(url: URL) {
  return url.protocol === location.protocol && url.hostname === location.hostname && url.port === location.port;
}
function isSiteAuthority(url: URL) { return url.protocol === "https:" && url.hostname === "reylumi.com" && !url.port; }

function searchFormData(form: HTMLFormElement, submitter: HTMLButtonElement | HTMLInputElement | null) {
  if (!submitter) return new FormData(form);
  if (supportsFormDataSubmitter === undefined) {
    const probe = document.createElement("form"), button = document.createElement("button");
    button.name = "submitter"; button.value = "supported"; probe.append(button);
    try { supportsFormDataSubmitter = new FormData(probe, button).get(button.name) === button.value; }
    catch { supportsFormDataSubmitter = false; }
  }
  if (supportsFormDataSubmitter) return new FormData(form, submitter);
  // Safari 16.0–16.3 ignores the second argument. Let the browser still collect
  // successful controls/order/fieldset rules; only proxy the admitted submitter.
  if (submitter.form !== form) throw new Error("Invalid search submitter");
  if (!submitter.name || submitter.matches(":disabled")) return new FormData(form);
  const proxy = document.createElement("input");
  proxy.type = "hidden"; proxy.name = submitter.name; proxy.value = submitter.value;
  proxy.dataset.appLocalSearchSubmitter = "true";
  const association = submitter.getAttribute("form");
  if (association !== null) proxy.setAttribute("form", association);
  submitter.before(proxy);
  try { return new FormData(form); }
  finally { proxy.remove(); }
}

function globalSearchDestination(form: HTMLFormElement, submitter: HTMLElement | null) {
  if (form.getAttribute("role") !== "search") return null;
  const control = submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : null;
  // Real global headers use buttons. Keep image coordinates and an unvalued
  // input's browser-localized default submit label in their document boundary.
  if (control instanceof HTMLInputElement && (control.type === "image" || control.type === "submit" && !control.hasAttribute("value"))) return null;
  const action = control?.getAttribute("formaction") ?? form.getAttribute("action") ?? "";
  const method = control?.getAttribute("formmethod") ?? form.getAttribute("method") ?? "get";
  const encoding = control?.getAttribute("formenctype") ?? form.enctype;
  const target = control?.getAttribute("formtarget") ?? form.target;
  const name = control?.getAttribute("name") ?? "";
  if (method.toLowerCase() !== "get" || encoding !== "application/x-www-form-urlencoded" || target && target !== "_self"
    || name.startsWith("$ACTION_ID_") || name.startsWith("$ACTION_REF_") || /[\\\u0000-\u001f]/.test(action)) return null;
  let url: URL, declared: URL;
  try { url = new URL(action, location.href); declared = new URL(form.getAttribute("action") ?? "", location.href); } catch { return null; }
  if (declared.username || declared.password || declared.pathname !== "/explore" || !(isDocumentAuthority(declared) || isSiteAuthority(declared))) return null;
  if (url.username || url.password || url.pathname !== "/explore" || !(isDocumentAuthority(url) || isSiteAuthority(url))) return null;
  const data = searchFormData(form, control);
  // HTML GET replaces the action's query; successful controls include submitter.
  url.search = "";
  for (const [key, value] of data) url.searchParams.append(key, typeof value === "string" ? value : value.name);
  const path = url.pathname + url.search + url.hash;
  return path.length <= 4096 ? path : null;
}

function readFilterDestination(form: HTMLFormElement, submitter: HTMLElement | null) {
  const marker = form.getAttribute("data-app-local-read-filter");
  const route = marker === "payroll-tax-period" ? "/payroll/tax-company" : marker === "portable-report-date" ? "/pos/portable/report" : null;
  if (!route || location.pathname !== route) return null;
  const control = submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : null;
  if (control instanceof HTMLInputElement && (control.type === "image" || control.type === "submit" && !control.hasAttribute("value"))) return null;
  const declaredAction = form.getAttribute("action") ?? "";
  const action = control?.getAttribute("formaction") ?? declaredAction;
  const method = control?.getAttribute("formmethod") ?? form.getAttribute("method") ?? "get";
  const encoding = control?.getAttribute("formenctype") ?? form.enctype;
  const target = control?.getAttribute("formtarget") ?? form.target;
  const name = control?.getAttribute("name") ?? "";
  if (method.toLowerCase() !== "get" || encoding !== "application/x-www-form-urlencoded" || target && target !== "_self"
    || name.startsWith("$ACTION_ID_") || name.startsWith("$ACTION_REF_") || /[\\\u0000-\u001f]/.test(action + declaredAction)) return null;
  let url: URL, declared: URL;
  try { url = new URL(action, location.href); declared = new URL(declaredAction, location.href); } catch { return null; }
  if ([url, declared].some(value => value.username || value.password || value.hash || value.pathname !== route || !(isDocumentAuthority(value) || isSiteAuthority(value)))) return null;
  const data = searchFormData(form, control);
  const allowed = marker === "payroll-tax-period" ? ["report", "preset", "month", "segment", "payPeriodStart", "start", "end"] : ["date"];
  url.search = "";
  for (const [key, value] of data) {
    if (!allowed.includes(key) || typeof value !== "string" || value.length > 100 || url.searchParams.has(key)) return null;
    url.searchParams.append(key, value);
  }
  const path = url.pathname + url.search;
  return path.length <= 4096 ? path : null;
}

/** Original guards own cancellation; only approved search/read GETs are local. */
export function installAppLocalLinkNavigation(options: AppLocalLinkNavigation): () => void {
  if (typeof document === "undefined") return () => {};
  let alive = true, closeViewer = () => {};
  const searches = new Map<HTMLFormElement, { attempt: string; destination: string }>();
  const searchEvent = (form: HTMLFormElement, detail: AppLocalSearchNavigationDetail) => form.dispatchEvent(new CustomEvent(APP_LOCAL_SEARCH_NAVIGATION_EVENT, { detail }));
  const finishSearch = (form: HTMLFormElement, attempt: { attempt: string; destination: string }, accepted: boolean) => {
    if (searches.get(form) !== attempt) return;
    searches.delete(form);
    searchEvent(form, { ...attempt, phase: "complete", accepted });
  };
  const submitSearch = (event: SubmitEvent) => {
    if (event.defaultPrevented || !(event.target instanceof HTMLFormElement)) return;
    const form = event.target;
    const privateFilter = form.hasAttribute("data-app-local-read-filter");
    const startedRoute = location.pathname + location.search + location.hash;
    const startedScope = options.getScope?.();
    let destination: string | null;
    try { destination = privateFilter ? readFilterDestination(form, event.submitter) : globalSearchDestination(form, event.submitter); }
    catch (error) { options.onError?.(error); return; }
    if (!destination) return;
    if (privateFilter && (!options.getScope || !options.isLocalRoute(destination))) return;
    event.preventDefault();
    if (searches.has(form)) return;
    const attempt = { attempt: `search-${++searchNavigationSequence}`, destination };
    searches.set(form, attempt);
    searchEvent(form, { ...attempt, phase: "start" });
    // Original React submit/dirty/IME guards have already run. Keep their exact
    // form pending until its route is accepted (or its own attempt fails).
    void Promise.resolve().then(async () => {
      if (!alive || searches.get(form) !== attempt) return;
      // CompactFilters may already have hidden its popover. Route and admission,
      // rather than DOM visibility, own this retained private read filter.
      if (privateFilter && (!form.isConnected || startedRoute !== location.pathname + location.search + location.hash || startedScope !== options.getScope?.())) {
        finishSearch(form, attempt, false); return;
      }
      try {
        if (options.isLocalRoute(destination)) {
          await options.navigate(destination);
          if (location.pathname + location.search + location.hash !== destination) throw new Error("Search could not open. Please try again.");
        } else await options.openOnline(destination);
        if (alive) finishSearch(form, attempt, true);
      } catch (error) {
        if (alive) { finishSearch(form, attempt, false); options.onError?.(error); }
      }
    });
  };
  const resetSearches = () => { for (const [form, attempt] of searches) finishSearch(form, attempt, false); };
  const images = new Set((options.helpImagePaths ?? []).filter(path => /^\/(?:support\/guides\/images\/|help\/\d{4}-\d{2}-\d{2}\/(?:en|vi)\/)[\w./-]+\.(?:png|jpe?g|webp|avif|svg)$/i.test(path) && !path.split("/").includes("..")));
  const run = (operation: () => void | Promise<void>) => { try { void Promise.resolve(operation()).catch(error => options.onError?.(error)); } catch (error) { options.onError?.(error); } };
  const close = () => closeViewer();
  function showImage(path: string, anchor: HTMLAnchorElement) {
    closeViewer();
    const restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : anchor;
    const startedPath = location.pathname + location.search, startedScope = options.getScope?.();
    const dialog = document.createElement("dialog"), closeButton = document.createElement("button"), image = document.createElement("img"), status = document.createElement("p");
    dialog.setAttribute("data-app-local-help-image", ""); dialog.setAttribute("aria-label", anchor.textContent?.trim() || "Guide illustration");
    Object.assign(dialog.style, { position: "fixed", inset: "0", width: "100vw", height: "100dvh", maxWidth: "none", maxHeight: "none", margin: "0", padding: "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))", border: "0", background: "#fff", color: "#18181b", overflow: "auto" });
    closeButton.type = "button"; closeButton.textContent = "Close image"; closeButton.setAttribute("aria-label", "Close image"); Object.assign(closeButton.style, { position: "sticky", top: "0", zIndex: "1", minHeight: "44px", padding: "8px 16px", border: "1px solid #d4d4d8", borderRadius: "12px", background: "#fff", cursor: "pointer" });
    image.src = path; image.alt = anchor.querySelector("img")?.alt || anchor.textContent?.trim() || "Guide illustration"; Object.assign(image.style, { display: "block", maxWidth: "100%", height: "auto", margin: "16px auto" });
    status.hidden = true; status.setAttribute("role", "alert"); status.textContent = "This image could not be opened."; image.addEventListener("error", () => { status.hidden = false; });
    dialog.append(closeButton, image, status); document.body.append(dialog);
    const observer = new MutationObserver(() => check());
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "style"] });
    const check = () => { if (location.pathname + location.search !== startedPath || options.getScope?.() !== startedScope || !anchor.isConnected || !anchor.getClientRects().length || anchor.closest("[hidden]")) closeViewer(); };
    window.addEventListener("reylumi:screen-ready", check);
    closeViewer = () => {
      closeViewer = () => {}; observer.disconnect(); window.removeEventListener("reylumi:screen-ready", check); dialog.remove();
      if (alive && restoreFocus.isConnected && !restoreFocus.closest("[hidden]") && options.getScope?.() === startedScope) restoreFocus.focus({ preventScroll: true });
    };
    closeButton.addEventListener("click", close); dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("click", event => { if (event.target === dialog) close(); });
    if (typeof dialog.showModal === "function") dialog.showModal(); else { dialog.setAttribute("open", ""); dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true"); dialog.style.zIndex = "2147483647"; }
    closeButton.focus({ preventScroll: true });
  }
  // AppLocalHelp deliberately cancels its own links. Capture only its exact
  // signed public image paths before that handler can route an image as a page.
  const imageClick = (event: MouseEvent) => {
    if (!primary(event)) return; const anchor = anchorFor(event); if (!anchor) return; const url = safeUrl(anchor);
    if (!url || !(isDocumentAuthority(url) || isSiteAuthority(url)) || !images.has(url.pathname) || url.hash) return;
    if ([...url.searchParams].some(([key, value]) => !["lang", "view"].includes(key) || !["en", "vi", "full"].includes(value))) return;
    event.preventDefault(); event.stopPropagation(); showImage(url.pathname, anchor);
  };
  const click = (event: MouseEvent) => {
    if (!primary(event)) return; const anchor = anchorFor(event); if (!anchor) return; const url = safeUrl(anchor); if (!url) return;
    if (!(isDocumentAuthority(url) || isSiteAuthority(url))) {
      if (url.protocol === "https:" && options.openExternal) { event.preventDefault(); close(); run(() => options.openExternal!(url.href)); }
      return;
    }
    const path = url.pathname + url.search;
    if (url.hash && path === location.pathname + location.search) {
      let id: string; try { id = decodeURIComponent(url.hash.slice(1)); } catch { return; }
      const target = document.getElementById(id);
      // Tab-specific anchors can be hidden until the hash listener selects the
      // tab. pushState alone emits no hashchange and used to leave Trust closed.
      event.preventDefault(); close();
      const oldURL = location.href;
      history.pushState(null, "", path + url.hash);
      window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: location.href }));
      if (target && !target.closest("[hidden]")) target.scrollIntoView({ block: "start" });
      return;
    }
    // The registry admits only explicitly supported public fragments. Unknown
    // or capability-bearing links retain their original hosted boundary.
    const destination = path + url.hash;
    const local = options.isLocalRoute(destination);
    event.preventDefault(); close(); if (local) run(() => options.navigate(destination)); else run(() => options.openOnline(destination));
  };
  const resetEvents = ["popstate", "reylumi:app-local-reset", "reylumi:experience-reset", "reylumi:offline-clear", "reylumi:app-local-access-changed", "reylumi:experience-access-changed"];
  document.addEventListener("click", imageClick, true); document.addEventListener("click", click); document.addEventListener("submit", submitSearch);
  window.addEventListener("pageshow", resetSearches);
  for (const event of resetEvents) window.addEventListener(event, close);
  return () => { alive = false; close(); document.removeEventListener("click", imageClick, true); document.removeEventListener("click", click); document.removeEventListener("submit", submitSearch); window.removeEventListener("pageshow", resetSearches); resetSearches(); for (const event of resetEvents) window.removeEventListener(event, close); };
}

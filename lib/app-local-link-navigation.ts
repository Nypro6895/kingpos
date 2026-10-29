"use client";

export type AppLocalLinkNavigation = {
  navigate(path: string): void;
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

/** No form/fetch interception. Original handlers that cancel a link keep ownership. */
export function installAppLocalLinkNavigation(options: AppLocalLinkNavigation): () => void {
  if (typeof document === "undefined") return () => {};
  let alive = true, closeViewer = () => {};
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
  document.addEventListener("click", imageClick, true); document.addEventListener("click", click);
  for (const event of resetEvents) window.addEventListener(event, close);
  return () => { alive = false; close(); document.removeEventListener("click", imageClick, true); document.removeEventListener("click", click); for (const event of resetEvents) window.removeEventListener(event, close); };
}

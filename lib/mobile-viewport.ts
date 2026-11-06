/** Track both Safari's visual viewport and a WKWebView resized by keyboardLayoutGuide. */
export function installMobileViewport(root: Document = document) {
  const win = root.defaultView!;
  const viewport = win.visualViewport;
  let fullHeight = win.innerHeight;
  let width = win.innerWidth;
  let frame = 0;
  let keyboardWasOpen = false;
  const editable = () => root.activeElement?.matches('input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=true]') ?? false;
  const update = () => {
    if (width !== win.innerWidth) { width = win.innerWidth; fullHeight = win.innerHeight; }
    const height = Math.min(win.innerHeight, viewport?.height ?? win.innerHeight);
    if (!editable()) fullHeight = Math.max(fullHeight, win.innerHeight);
    // A hardware keyboard (including iPhone Mirroring) can expose only the
    // roughly 44px input accessory bar. It still competes with bottom actions.
    const keyboard = (editable() || keyboardWasOpen) && fullHeight - height > 24;
    keyboardWasOpen = keyboard;
    root.documentElement.dataset.keyboardOpen = String(keyboard);
    root.documentElement.style.setProperty('--visible-viewport-height', `${height}px`);
    root.documentElement.style.setProperty('--visible-viewport-top', `${viewport?.offsetTop ?? 0}px`);
    root.documentElement.dataset.modalOpen = String(Array.from(root.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]')).some(element => element.getClientRects().length > 0));
  };
  const schedule = () => { win.cancelAnimationFrame(frame); frame = win.requestAnimationFrame(update); };
  root.addEventListener('focusin', schedule);
  root.addEventListener('focusout', schedule);
  win.addEventListener('resize', schedule);
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(root.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'hidden', 'aria-modal', 'style']});
  update();
  return () => {
    win.cancelAnimationFrame(frame);
    observer.disconnect();
    root.removeEventListener('focusin', schedule); root.removeEventListener('focusout', schedule);
    win.removeEventListener('resize', schedule);
    viewport?.removeEventListener('resize', schedule); viewport?.removeEventListener('scroll', schedule);
    delete root.documentElement.dataset.keyboardOpen;
    delete root.documentElement.dataset.modalOpen;
    root.documentElement.style.removeProperty('--visible-viewport-height');
    root.documentElement.style.removeProperty('--visible-viewport-top');
  };
}

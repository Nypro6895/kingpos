const selector = "details[data-dismissible-popover][open]";
export function installPopoverDismissal(root: Document) {
  function close(details: HTMLDetailsElement, focus = false) {
    details.open = false;
    if (focus) details.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  }
  function outside(event: Event) {
    const target = event.target;
    if (!(target instanceof Node)) return;
    root.querySelectorAll<HTMLDetailsElement>(selector).forEach((details) => {
      if (!details.contains(target)) close(details);
    });
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    const open = Array.from(root.querySelectorAll<HTMLDetailsElement>(selector));
    const target = event.target;
    const active = open.findLast((details) => target instanceof Node && details.contains(target)) ?? open.at(-1);
    if (active) { event.preventDefault(); close(active, true); }
  }
  function selection(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("a[href], [data-dismiss-popover]")) target.closest<HTMLDetailsElement>(selector)?.removeAttribute("open");
  }
  root.addEventListener("pointerdown", outside, true);
  root.addEventListener("focusin", outside, true);
  root.addEventListener("keydown", escape);
  root.addEventListener("click", selection);
  return () => {
    root.removeEventListener("pointerdown", outside, true);
    root.removeEventListener("focusin", outside, true);
    root.removeEventListener("keydown", escape);
    root.removeEventListener("click", selection);
  };
}
export function closePopovers(root: Document) {
  root.querySelectorAll<HTMLDetailsElement>(selector).forEach((details) => { details.open = false; });
}

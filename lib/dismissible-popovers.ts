const selector = "details[data-dismissible-popover][open]";
const portalRegions = new WeakMap<HTMLDetailsElement, Set<HTMLElement>>();

export function registerPopoverPortal(details: HTMLDetailsElement, region: HTMLElement) {
  const regions = portalRegions.get(details) ?? new Set<HTMLElement>();
  portalRegions.set(details, regions);
  regions.add(region);
  return () => { regions.delete(region); };
}

export function popoverContains(details: HTMLDetailsElement, target: Node) {
  return details.contains(target) || [...(portalRegions.get(details) ?? [])].some(region => region.contains(target));
}

export function installPopoverDismissal(root: Document) {
  function close(details: HTMLDetailsElement, focus = false) {
    details.open = false;
    if (focus) details.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
  }
  function outside(event: Event) {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (event.type === "focusin" && (!(target instanceof Element) || !target.matches(":focus-visible"))) return;
    root.querySelectorAll<HTMLDetailsElement>(selector).forEach((details) => {
      if (!popoverContains(details, target)) close(details);
    });
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    const open = Array.from(root.querySelectorAll<HTMLDetailsElement>(selector));
    const target = event.target;
    const active = open.findLast((details) => target instanceof Node && popoverContains(details, target)) ?? open.at(-1);
    if (active) { event.preventDefault(); close(active, true); }
  }
  function selection(event: Event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest("a[href], [data-dismiss-popover]")) {
      root.querySelectorAll<HTMLDetailsElement>(selector).forEach(details => {
        if (popoverContains(details, target)) close(details);
      });
    }
  }
  root.addEventListener("click", outside);
  root.addEventListener("focusin", outside, true);
  root.addEventListener("keydown", escape);
  root.addEventListener("click", selection);
  return () => {
    root.removeEventListener("click", outside);
    root.removeEventListener("focusin", outside, true);
    root.removeEventListener("keydown", escape);
    root.removeEventListener("click", selection);
  };
}
export function closePopovers(root: Document) {
  root.querySelectorAll<HTMLDetailsElement>(selector).forEach((details) => { details.open = false; });
}

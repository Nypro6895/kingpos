/** Scroll only the overflowing ancestors, then the page, by the missing distance. */
export function revealCommentComposer(textarea: HTMLTextAreaElement) {
  const viewport = window.visualViewport;
  const top = (viewport?.offsetTop ?? 0) + 12;
  let bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 12;
  for (const nav of document.querySelectorAll<HTMLElement>(".workspace-mobile-nav")) {
    const rect = nav.getBoundingClientRect();
    if (nav.getClientRects().length && rect.top > top && rect.top < bottom) bottom = rect.top - 12;
  }
  const delta = () => {
    const rect = textarea.getBoundingClientRect();
    // A tall draft keeps its bottom/caret region visible without oscillating.
    if (rect.bottom > bottom) return rect.bottom - bottom;
    if (rect.top < top && rect.height <= bottom - top) return rect.top - top;
    return 0;
  };
  for (let parent = textarea.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (!delta()) return;
    if (parent.scrollHeight > parent.clientHeight && /auto|scroll/.test(window.getComputedStyle(parent).overflowY)) {
      parent.scrollTop += delta();
    }
  }
  const remaining = delta();
  if (remaining) window.scrollBy({ top: remaining, behavior: "instant" });
}

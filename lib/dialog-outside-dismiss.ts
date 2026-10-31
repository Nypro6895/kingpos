import type { MouseEvent, PointerEvent } from "react";
const outsideStarts = new WeakSet<HTMLDialogElement>();
function outside(element: HTMLDialogElement, x: number, y: number) {
  const box = element.getBoundingClientRect();
  return x < box.left || x > box.right || y < box.top || y > box.bottom;
}
export function dialogOutsidePointerDown(event: PointerEvent<HTMLDialogElement>) {
  outsideStarts.delete(event.currentTarget);
  if (event.target === event.currentTarget && outside(event.currentTarget, event.clientX, event.clientY)) outsideStarts.add(event.currentTarget);
}
export function dialogOutsideClick(event: MouseEvent<HTMLDialogElement>) {
  const dialog = event.currentTarget;
  if (outsideStarts.has(dialog) && event.target === dialog && outside(dialog, event.clientX, event.clientY)) dialog.close();
  outsideStarts.delete(dialog);
}

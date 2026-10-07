"use client";

export function openQuickBooking(href: string) {
  window.dispatchEvent(new CustomEvent("reylumi:quick-book", { detail: { href } }));
}

export function preloadQuickBooking(href: string) {
  window.dispatchEvent(new CustomEvent("reylumi:preload-book", { detail: { href } }));
}

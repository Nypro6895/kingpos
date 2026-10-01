"use client";

export function dismissPortableKeyboard() {
  window.dispatchEvent(new Event("kingpos:hide-touch-keyboard"));
}

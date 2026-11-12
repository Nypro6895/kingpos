"use client";

import { useEffect } from "react";
import { normalizeNumericInput, rememberNumericZero, replaceInitialNumericZero } from "@/lib/numeric-input-editing";

/** Capture before React reads the edit; also covers portals and new dialogs. */
export default function NumericInputEditing() {
  useEffect(() => {
    document.addEventListener("focusin", rememberNumericZero, true);
    document.addEventListener("beforeinput", replaceInitialNumericZero, true);
    document.addEventListener("input", normalizeNumericInput, true);
    // An inline editor may have autofocus before this effect mounts.
    rememberNumericZero({ target: document.activeElement });
    return () => {
      document.removeEventListener("focusin", rememberNumericZero, true);
      document.removeEventListener("beforeinput", replaceInitialNumericZero, true);
      document.removeEventListener("input", normalizeNumericInput, true);
    };
  }, []);
  return null;
}

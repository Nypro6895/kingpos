"use client";

import { useEffect } from "react";
import { installNumericInputEditing } from "@/lib/numeric-input-editing";

export function NumericInputBehavior() {
  useEffect(() => installNumericInputEditing(document), []);
  return null;
}

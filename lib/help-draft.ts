import "server-only";
import { HELP_VERSION } from "@/lib/help-guides";

/** Availability belongs to the reviewed content revision, not a runtime preview flag. */
export function isHelpAvailable() {
  return HELP_VERSION.publicationStatus === "ready";
}

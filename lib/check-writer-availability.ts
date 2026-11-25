// This release does not offer check creation or printing. Configuration and
// existing paid/trial access cannot reopen it; history and safety actions remain.
export const CHECK_WRITER_PRINTING_AVAILABLE = false;
export const CHECK_WRITER_UNAVAILABLE_MESSAGE = "Print Check is not available.";

const SAFETY_ACTIONS = new Set([
  "lock",
  "unlock",
  "void",
  "recover_creation",
  "cancel_creation",
  "print_confirmed",
  "print_failed",
]);

export function assertCheckWriterPrintingAvailable() {
  if (!CHECK_WRITER_PRINTING_AVAILABLE) {
    throw new Error(CHECK_WRITER_UNAVAILABLE_MESSAGE);
  }
}

export function checkWriterActionAvailable(action: unknown): boolean {
  return CHECK_WRITER_PRINTING_AVAILABLE ||
    (typeof action === "string" && SAFETY_ACTIONS.has(action));
}

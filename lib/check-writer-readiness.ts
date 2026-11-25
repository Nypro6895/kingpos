import "server-only";
import { checkWriterCryptoReady } from "./check-writer-crypto";
import { CHECK_WRITER_PRINTING_AVAILABLE } from "./check-writer-availability";

// Separate release authorization from encryption configuration. Existing paid
// history/safety controls are unaffected; new checkout stays closed by default.
export function checkWriterSalesReady() {
  return (
    CHECK_WRITER_PRINTING_AVAILABLE &&
    process.env.CHECK_WRITER_SALES_ENABLED === "true" &&
    checkWriterCryptoReady()
  );
}

// Trial activation has its own explicit readiness gate and never opens sales.
export function checkWriterTrialReady() {
  return CHECK_WRITER_PRINTING_AVAILABLE &&
    process.env.CHECK_WRITER_TRIAL_ENABLED === "true" && checkWriterCryptoReady();
}

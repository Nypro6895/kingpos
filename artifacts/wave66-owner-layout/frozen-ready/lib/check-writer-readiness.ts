import "server-only";
import { checkWriterCryptoReady } from "./check-writer-crypto";

// Separate release authorization from encryption configuration. Existing paid
// history/safety controls are unaffected; new checkout stays closed by default.
export function checkWriterSalesReady() {
  return (
    process.env.CHECK_WRITER_SALES_ENABLED === "true" &&
    checkWriterCryptoReady()
  );
}

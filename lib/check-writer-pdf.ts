import type { CheckRecord } from "@/types/check-writer";
import { CHECK_WRITER_UNAVAILABLE_MESSAGE } from "./check-writer-availability";

// Keep callers typed while this release does not offer check output. A future
// licensed implementation must be restored explicitly; no bank or font is read.
export async function checkPdf(
  _records: CheckRecord[],
  _salon: string,
  _preview: boolean,
  _offsets = { x: 0, y: 0 },
): Promise<Uint8Array> {
  void _offsets;
  throw new Error(CHECK_WRITER_UNAVAILABLE_MESSAGE);
}

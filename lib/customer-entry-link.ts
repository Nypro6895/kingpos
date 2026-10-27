import { REYLUMI_PUBLIC_APP_URL } from "./public-app-url";
import { personalSalonEntry } from "./personal-qr";

// Use the exact trusted format accepted by the customer's in-app QR scanner.
// The paired display's control token is never part of this link.
export function customerEntryLink(entry: unknown): string | null {
  if (typeof entry !== "string") return null;
  const url = `${REYLUMI_PUBLIC_APP_URL}/check-in/${entry}`;
  return personalSalonEntry(url) ? url : null;
}

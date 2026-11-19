/** A Gift capability may travel only in a browser fragment. Never put it in
 * a form body, auth query/state, cookie or storage. */
export function splitGiftAuthReturn(path: string): { serverPath: string; fragment: string } {
  try {
    const url = new URL(path, "https://auth-return.invalid");
    if (url.origin === "https://auth-return.invalid" && url.pathname === "/gift-cards" && /^#card=[a-f0-9]{64}$/.test(url.hash)) {
      return { serverPath: `${url.pathname}${url.search}`, fragment: url.hash };
    }
  } catch { /* Existing path sanitizer handles other invalid paths. */ }
  return { serverPath: path, fragment: "" };
}

export function restoreGiftAuthFragment(destination: string, fragment: string): string {
  if (!/^#card=[a-f0-9]{64}$/.test(fragment) || !destination.startsWith("/") || destination.startsWith("//") || destination.includes("\\")) return destination;
  try {
    const url = new URL(destination, "https://auth-return.invalid");
    return url.origin === "https://auth-return.invalid" && url.pathname === "/gift-cards" && !url.hash ? `${url.pathname}${url.search}${fragment}` : destination;
  } catch { return destination; }
}

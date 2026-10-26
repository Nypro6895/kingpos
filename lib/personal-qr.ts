const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export function personalQrToken(code: string): string | null {
  return new RegExp(`^reylumi:personal:(${UUID})$`, "i").exec(code.trim())?.[1] ?? null;
}
export function personalSalonEntry(code: string): string | null {
  try {
    const url = new URL(code.trim());
    if (url.protocol !== "https:" || !["reylumi.com", "www.reylumi.com"].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash) return null;
    return new RegExp(`^/check-in/(${UUID})/?$`, "i").exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}
export function personalVisitLabel(status: string, ready: boolean) {
  if (status === "paid") return "Paid";
  if (status === "cancelled") return "Cancelled";
  if (status === "checkout" || status === "completed") return "Ready to pay";
  if (status === "in_service") return "In service";
  return ready ? "Ready" : "Waiting";
}

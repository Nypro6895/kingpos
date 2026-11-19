export type PublicAppInviteConfig = {
  enabled: boolean;
  iosStoreUrl: string | null;
  androidStoreUrl: string | null;
  giftHandoffEnabled: boolean;
};
export type PublicAppInviteTarget = {
  kind: "check-in" | "gift" | "booking" | "salon" | "beauty" | "look" | "campaign";
  appUrl: string | null;
};
export const PUBLIC_APP_INVITE_DISMISS_KEY = "reylumi.public-app-invite.dismissed.v1";
export const PUBLIC_APP_INVITE_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const giftFragment = /^#card=([a-f0-9]{64})$/;

/** Public entry points only. Never treat a payment or private QR as an invitation. */
export function publicAppInviteTarget(href: string): PublicAppInviteTarget | null {
  let url: URL;
  try { url = new URL(href, "https://reylumi.com"); } catch { return null; }
  if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) return null;
  if (url.origin !== "https://reylumi.com" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
  const path = url.pathname;
  if (path === "/qr") {
    const entry = url.searchParams.get("entry");
    if (!entry || !uuid.test(entry) || url.hash || [...url.searchParams.keys()].some(key => key !== "entry") || url.searchParams.getAll("entry").length !== 1) return null;
    return { kind: "check-in", appUrl: `reylumi://check-in/${entry}` };
  }
  if (url.search) return null;
  const entry = path.match(/^\/check-in\/([^/]+)$/)?.[1];
  if (entry && uuid.test(entry) && !url.hash) return { kind: "check-in", appUrl: `reylumi://check-in/${entry}` };
  if (path === "/gift-cards") {
    const token = url.hash.match(giftFragment)?.[1];
    return token ? { kind: "gift", appUrl: `reylumi://gift-cards#card=${token}` } : null;
  }
  // Explicit public detail routes, never favorites, history, invites or manage links.
  const detail = path.match(/^\/(book|explore\/salons|explore\/beauty|explore\/looks|explore\/inspiration|explore\/campaigns)\/([a-zA-Z0-9_-]+)(?:\/posts\/([a-zA-Z0-9_-]+))?$/);
  if (!detail || (detail[3] && detail[1] !== "explore/beauty")) return null;
  if (url.hash && (detail[1] !== "explore/salons" || !/^#(?:post|transformation|look)-[a-zA-Z0-9_-]+$/.test(url.hash))) return null;
  const kinds: Record<string, PublicAppInviteTarget["kind"]> = { book: "booking", "explore/salons": "salon", "explore/beauty": "beauty", "explore/looks": "look", "explore/inspiration": "look", "explore/campaigns": "campaign" };
  const kind = kinds[detail[1]];
  return { kind, appUrl: null };
}

export function publicAppInvitePlatform(device: { userAgent: string; maxTouchPoints?: number; native?: boolean; standalone?: boolean }): "ios" | "android" | null {
  if (device.native || device.standalone || /Reylumi(?:IOS|Android)\//i.test(device.userAgent)) return null;
  if (/iPhone|iPad|iPod/i.test(device.userAgent) || (/Macintosh/i.test(device.userAgent) && (device.maxTouchPoints ?? 0) > 1)) return "ios";
  return /Android/i.test(device.userAgent) ? "android" : null;
}

export function publicAppInviteDismissed(value: string | null, now = Date.now()): boolean {
  if (!value?.trim()) return false;
  const dismissedAt = Number(value);
  return Number.isFinite(dismissedAt) && dismissedAt > 0 && dismissedAt <= now && now - dismissedAt < PUBLIC_APP_INVITE_DISMISS_MS;
}

export function publicAppInviteAction(config: PublicAppInviteConfig, platform: "ios" | "android" | null, target: PublicAppInviteTarget | null) {
  if (!config.enabled || !platform || !target) return null;
  const storeUrl = platform === "ios" ? config.iosStoreUrl : config.androidStoreUrl;
  if (!storeUrl) return null;
  // Android currently has no equivalent receiver. Older iOS builds only handle check-in.
  const appUrl = platform === "ios" && (target.kind === "check-in" || (target.kind === "gift" && config.giftHandoffEnabled)) ? target.appUrl : null;
  return { storeUrl, appUrl };
}

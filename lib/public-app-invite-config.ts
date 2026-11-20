import type { PublicAppInviteConfig } from "./public-app-invite";

export const REYLUMI_IOS_APP_ID = "6821394475";
export const REYLUMI_ANDROID_APP_ID = "com.reylumi.android";

/** Values are release configuration, not installation or store-availability detection. */
export function publicAppInviteConfig(env: Record<string, string | undefined> = process.env): PublicAppInviteConfig {
  const enabled = env.REYLUMI_PUBLIC_APP_INVITE_ENABLED === "true";
  function storeUrl(raw: string | undefined, platform: "ios" | "android"): string | null {
    try {
      const url = new URL(raw ?? "");
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
      if (platform === "ios" && url.hostname === "apps.apple.com" && /^\/(?:[a-z]{2}\/)?app\/(?:[^/]+\/)?id6821394475\/?$/.test(url.pathname)) {
        // Never forward a shared capability or arbitrary tracking parameters to a store.
        return `https://apps.apple.com${url.pathname}`;
      }
      if (platform === "android" && url.hostname === "play.google.com" && url.pathname === "/store/apps/details" && url.searchParams.getAll("id").length === 1 && url.searchParams.get("id") === REYLUMI_ANDROID_APP_ID) {
        return `https://play.google.com/store/apps/details?id=${REYLUMI_ANDROID_APP_ID}`;
      }
    } catch { /* No public store channel configured. TestFlight is not a public store. */ }
    return null;
  }
  return {
    enabled,
    iosStoreUrl: enabled ? storeUrl(env.REYLUMI_CUSTOMER_IOS_INSTALL_URL, "ios") : null,
    androidStoreUrl: enabled ? storeUrl(env.REYLUMI_CUSTOMER_ANDROID_INSTALL_URL, "android") : null,
    giftHandoffEnabled: enabled && env.REYLUMI_PUBLIC_GIFT_APP_HANDOFF_ENABLED === "true",
  };
}

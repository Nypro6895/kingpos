import { browserPublicOrigin } from "./browser-public-origin";

type ShareResult = { status: "shared" | "copied" | "cancelled" | "manual"; url: string };

export async function sharePostLink(href: string, title: string): Promise<ShareResult> {
  const url = new URL(href, browserPublicOrigin());
  if (!/^https?:$/.test(url.protocol)) throw new Error("Invalid share link");
  const result = (status: ShareResult["status"]): ShareResult => ({ status, url: url.href });
  // Use the existing app bridge even when WebKit exposes an unusable Web Share API.
  const native = (window as Window & {
    webkit?: { messageHandlers?: { reylumi?: { postMessage: (body: { action: string; text: string }) => void } } };
  }).webkit?.messageHandlers?.reylumi;
  if (native) {
    try {
      native.postMessage({ action: "share", text: [title, url.href].filter(Boolean).join("\n") });
      return result("shared");
    } catch { /* Continue with browser sharing and copy fallback. */ }
  }
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ title, url: url.href });
      return result("shared");
    } catch (error) {
      if (error && typeof error === "object" && "name" in error && error.name === "AbortError") return result("cancelled");
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url.href);
      return result("copied");
    }
  } catch { /* A selectable URL remains usable when clipboard access is denied. */ }
  return result("manual");
}

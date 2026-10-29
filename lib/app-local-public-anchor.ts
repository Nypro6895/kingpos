const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
/** Presentation fragments only. Query/identity checks stay in the route resolver. */
export function hasAppLocalPublicAnchor(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]|%2f|%5c|%00/i.test(path) || path.length > 4096) return false;
  const url = new URL(path, "https://reylumi.com");
  if (url.origin !== "https://reylumi.com") return false;
  if (new RegExp(`^/explore/salons/${uuid}$`, "i").test(url.pathname)) {
    return ["#reviews", "#customer-experiences", "#feedback-good", "#feedback-issue", "#lumi-trust", "#lumi-trust-details"].includes(url.hash);
  }
  return new RegExp(`^/explore/beauty/${uuid}/posts/${uuid}$`, "i").test(url.pathname) && url.hash === "#comments";
}

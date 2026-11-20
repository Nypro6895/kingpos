/** Native bundle origins cannot be scanned by another customer's device. */
export function giftPublicLink(kind: "card" | "mobile", token: string, page?: { protocol: string; origin: string }) {
  const origin = page && (page.protocol === "https:" || page.protocol === "http:") ? page.origin : "https://reylumi.com";
  return `${origin}/gift-cards#${kind}=${encodeURIComponent(token)}`;
}

/** Salon is navigation intent only; the server verifies ownership on every request. */
export function marketTargetHref(href: string, salonId?: string) {
 if (!salonId) return href;
 const url = new URL(href, "https://reylumi.invalid");
 if (url.origin !== "https://reylumi.invalid") throw new Error("Expected a local link.");
 url.searchParams.set("salon", salonId);
 return url.pathname + url.search + url.hash;
}

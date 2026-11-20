// Add future language packages here and in the entitlement RPC adapter.
export const LANGUAGE_CATALOG = [{ code: "en", name: "English" }, { code: "vi", name: "Tiếng Việt" }] as const;
export type LanguageOffer = { code: string; activation: string; expiresAt: string };
export type LanguageNotice = { code: string; activation: string; seen: boolean; accepted: boolean };
export type SalonLanguageState = {
  salonId: string | null; salonName: string; selected: string; selectedActivation: string | null; effective: string;
  offers: LanguageOffer[]; notices: LanguageNotice[]; unavailable: boolean;
  loadError?: string;
  choiceRevision?: string;
};
export const PERSONAL_LANGUAGE: SalonLanguageState = { salonId: null, salonName: "", selected: "en", selectedActivation: null, effective: "en", offers: [], notices: [], unavailable: false };
export const LANGUAGE_INFO = "Additional languages are available through language packages subscribed to by the salon where you work. These packages are not offered for personal accounts. Contact your salon owner for access.";
export function acceptLanguageSnapshot(current: SalonLanguageState, incoming: SalonLanguageState) {
  return current.salonId === incoming.salonId && BigInt(incoming.choiceRevision ?? "0") >= BigInt(current.choiceRevision ?? "0");
}
export function languageInvitationsAllowed(pathname: string) {
  return !["/pos/portable", "/admin", "/explore", "/beauty", "/book/", "/my-bookings", "/activity"].some(p => pathname.startsWith(p));
}
export function offerAvailable(state: SalonLanguageState, notice: LanguageNotice, now = Date.now()) {
  return state.offers.some(o => o.code === notice.code && o.activation === notice.activation && Date.parse(o.expiresAt) > now);
}
export function effectiveLanguage(selected: string, offers: LanguageOffer[], now = Date.now(), activation: string | null = null) {
  return selected !== "en" && offers.some(o => o.code === selected && o.activation === activation && Date.parse(o.expiresAt) > now) ? selected : "en";
}
export function invitationCopy(code: string, salon: string) {
  const name = LANGUAGE_CATALOG.find(l => l.code === code)?.name ?? code;
  if (code === "vi") return {
    title: `${salon} đã kích hoạt gói ngôn ngữ ${name}`,
    question: `Bạn có muốn chuyển sang sử dụng ${name}?`,
    switch: `Chuyển sang ${name}`, later: "Để sau",
    hint: "Bạn có thể thay đổi ngôn ngữ bất cứ lúc nào trong Settings → Language.",
    explanation: `Your salon now offers ${name}. Would you like to switch?`,
  };
  return { title: `${salon} now offers ${name}`, question: `Would you like to switch to ${name}?`, switch: `Switch to ${name}`, later: "Later", hint: "You can change your language anytime in Settings → Language.", explanation: "" };
}

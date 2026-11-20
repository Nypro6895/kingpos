export type SalonSocialState = { loved: boolean; saved: boolean; hidden: boolean; following: boolean };
export type SalonSocialField = keyof SalonSocialState;
export const EMPTY_SALON_SOCIAL: SalonSocialState = { loved: false, saved: false, hidden: false, following: false };
export const isSalonId = (id: unknown): id is string => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export type ExploreSocialSalon = { id: string; name: string; href?: string | null; address?: string | null; city?: string | null; state?: string | null; bookingHref?: string | null; phone?: string | null };

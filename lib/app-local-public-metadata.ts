export const APP_LOCAL_PUBLIC_PATHS = ["/explore/salons/:salonId", "/explore/beauty/:profileId", "/explore/beauty/:profileId/posts/:postId", "/explore/inspiration/:lookId", "/book/:salonId"] as const;
export const APP_LOCAL_PUBLIC_READS = [
  { name: "public.salon", argumentKeys: ["salonId"], retain: true },
  { name: "public.beauty", argumentKeys: ["profileId", "customerId"], retain: true },
  { name: "public.beauty-post", argumentKeys: ["profileId", "postId"], retain: true },
  { name: "public.inspiration", argumentKeys: ["lookId", "location"], retain: true },
  { name: "public.booking", argumentKeys: ["salonId", "query"], retain: true },
  { name: "http.public-booking.availability", path: "/api/public-booking/availability", method: "POST", argumentKeys: ["input"], retain: false },
] as const;
export const APP_LOCAL_PUBLIC_COMMANDS = [
  { name: "http.public-booking.confirm", path: "/api/public-booking/confirm", method: "POST", argumentKeys: ["input"], replay: "never" },
] as const;
export const APP_LOCAL_BOOKING_QUERY_KEYS = ["startAt", "date", "inspiration", "lookId", "serviceId", "source", "staffId"] as const;

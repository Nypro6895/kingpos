const PUBLIC_BOOKING_ROUTE_PATTERN =
  /^\/(?:book|booking)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?([?#].*)?$/i;

export function normalizePublicBookingHref(
  value: string | null | undefined,
) {
  const href = value?.trim();

  if (!href) {
    return null;
  }

  const match = href.match(PUBLIC_BOOKING_ROUTE_PATTERN);

  if (!match) {
    return null;
  }

  return `/book/${match[1]}${match[2] ?? ""}`;
}

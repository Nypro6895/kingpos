const PUBLIC_BOOKING_ROUTE_PATTERN =
  /^\/(?:book|booking)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?([?#].*)?$/i;

/** A post's recipe can be unavailable while its tagged salon still accepts bookings. */
export function resolveExploreBookingHref(href: string | null | undefined, salonProfileHref: string | null | undefined) {
  const explicit = normalizePublicBookingHref(href);
  if (explicit) return explicit;
  const salon = salonProfileHref?.trim().match(/^\/explore\/salons\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?(?:[?#].*)?$/i);
  // The context endpoint remains authoritative for enabled/readiness checks.
  return salon ? `/book/${salon[1]}` : null;
}

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

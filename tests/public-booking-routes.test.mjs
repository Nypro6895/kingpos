import assert from "node:assert/strict";
import test from "node:test";

import { normalizePublicBookingHref } from "../lib/public-booking-routes.ts";

const salonId = "1650370b-f86d-461e-8d97-6210052eeed7";

test("normalizes legacy public booking hrefs to the current route", () => {
  assert.equal(
    normalizePublicBookingHref(`/booking/${salonId}`),
    `/book/${salonId}`,
  );
  assert.equal(
    normalizePublicBookingHref(`/booking/${salonId}?source=explore`),
    `/book/${salonId}?source=explore`,
  );
  assert.equal(
    normalizePublicBookingHref(`/book/${salonId}`),
    `/book/${salonId}`,
  );
});

test("rejects non-public booking routes", () => {
  assert.equal(normalizePublicBookingHref(`/booking/manage/${salonId}`), null);
  assert.equal(normalizePublicBookingHref("https://example.com/book/abc"), null);
  assert.equal(normalizePublicBookingHref("/book/not-a-salon-id"), null);
});

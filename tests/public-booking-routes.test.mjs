import assert from "node:assert/strict";
import test from "node:test";

import { normalizePublicBookingHref, resolveExploreBookingHref } from "../lib/public-booking-routes.ts";

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

test("tagged posts without an eligible recipe still open the salon booking context", () => {
  for (const missing of [null, undefined, ""]) {
    assert.equal(resolveExploreBookingHref(missing, `/explore/salons/${salonId}`), `/book/${salonId}`);
  }
  assert.equal(resolveExploreBookingHref(null, `/explore/salons/${salonId}#looks`), `/book/${salonId}`);
  const recipe = `/book/${salonId}?inspiration=post&source=explore`;
  assert.equal(resolveExploreBookingHref(recipe, `/explore/salons/${salonId}`), recipe);
  assert.equal(resolveExploreBookingHref(`/booking/${salonId}?source=explore`, null), `/book/${salonId}?source=explore`);
});

test("unknown, showcase and external salon targets retain the contact fallback", () => {
  for (const target of [null, "/explore", "/explore/salons/showcase-1", `https://example.com/explore/salons/${salonId}`, `//example.com/explore/salons/${salonId}`]) {
    assert.equal(resolveExploreBookingHref(null, target), null);
  }
});

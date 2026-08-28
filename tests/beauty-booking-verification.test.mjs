import assert from "node:assert/strict";
import test from "node:test";

import {
  BEAUTY_POST_BOOKING_SOURCE_TYPE,
  beautyBookingHrefForPost,
  beautyBookingHrefForSalon,
  beautyPostBookingPresentation,
  isBeautyBookVerifiedBooking,
} from "../lib/beauty-booking-verification.ts";

const salonId = "1650370b-f86d-461e-8d97-6210052eeed7";
const postId = "7dd17a06-ff46-4d9c-a471-16bcd610da8d";

test("beauty book verification only counts confirmed live bookings", () => {
  for (const status of ["confirmed", "checked_in", "in_service", "completed"]) {
    assert.equal(
      isBeautyBookVerifiedBooking({
        confirmationStatus: "confirmed",
        status,
      }),
      true,
      `${status} should count after confirmation`,
    );
  }

  for (const status of ["pending", "cancelled", "no_show"]) {
    assert.equal(
      isBeautyBookVerifiedBooking({
        confirmationStatus: "confirmed",
        status,
      }),
      false,
      `${status} should not count`,
    );
  }

  assert.equal(
    isBeautyBookVerifiedBooking({
      confirmationStatus: "requested",
      status: "confirmed",
    }),
    false,
  );
});

test("beauty book CTA points to the public booking route", () => {
  assert.equal(beautyBookingHrefForSalon(salonId), `/book/${salonId}`);
  assert.equal(
    beautyBookingHrefForPost({
      postId,
      salonId,
      source: "explore",
    }),
    `/book/${salonId}?inspiration=${postId}&source=explore`,
  );
  assert.equal(
    beautyBookingHrefForPost({
      postId,
      salonId,
      source: "public_profile",
    }),
    `/book/${salonId}?inspiration=${postId}&source=public_profile`,
  );
  assert.equal(BEAUTY_POST_BOOKING_SOURCE_TYPE, "beauty_post");
});

test("beauty post booking presentation keeps zero booked eligible", () => {
  assert.deepEqual(
    beautyPostBookingPresentation({
      bookedCount: 0,
      bookingEnabled: true,
      postId,
      salonId,
      salonName: "King Nails",
      source: "explore",
      verificationState: "verified",
    }),
    {
      bookedCount: 0,
      eligible: true,
      href: `/book/${salonId}?inspiration=${postId}&source=explore`,
      label: "Book at King Nails",
      salonId,
      salonName: "King Nails",
    },
  );
});

test("beauty post booking presentation does not let missing counts block Book", () => {
  const presentation = beautyPostBookingPresentation({
    bookedCount: null,
    bookingEnabled: true,
    labelStyle: "short",
    postId,
    salonId,
    salonName: "King Nails",
    source: "public_profile",
    verificationState: "verified",
  });

  assert.equal(presentation.eligible, true);
  assert.equal(presentation.bookedCount, 0);
  assert.equal(presentation.label, "Book");
  assert.equal(
    presentation.href,
    `/book/${salonId}?inspiration=${postId}&source=public_profile`,
  );
});

test("beauty post booking presentation requires linked public booking eligibility", () => {
  assert.equal(
    beautyPostBookingPresentation({
      bookedCount: 0,
      bookingEnabled: true,
      postId,
      salonId,
      source: "explore",
      verificationState: "pending",
    }).eligible,
    true,
  );
  assert.equal(
    beautyPostBookingPresentation({
      bookedCount: 0,
      bookingEnabled: true,
      postId,
      salonId: null,
      source: "explore",
      verificationState: "verified",
    }).eligible,
    false,
  );
  assert.equal(
    beautyPostBookingPresentation({
      bookedCount: 0,
      bookingEnabled: false,
      postId,
      salonId,
      source: "explore",
      verificationState: "verified",
    }).eligible,
    false,
  );
});

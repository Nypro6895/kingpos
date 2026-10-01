import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  formatSalonProfileTeamCount,
  formatSalonProfileTeamOverflowLabel,
  getPublicSalonProfileTeamMembers,
  getSalonProfileTeamPreview,
  isPublicSalonProfileTeamEligible,
} from "../lib/salon-profile-team.ts";

const names = [
  "David",
  "Lucy",
  "Macy",
  "Tracy",
  "Ana",
  "Bella",
  "Cindy",
  "Diana",
  "Ella",
  "Fiona",
];

function makeStaff(count) {
  return Array.from({ length: count }, (_, index) => ({
    displayName: names[index] ?? `Staff ${index + 1}`,
    id: `staff-${index + 1}`,
    isActive: true,
    onlineBookingEnabled: true,
    salonProfileContentPostingEnabled: false,
  }));
}

test("team preview handles 0, 1, 3, 4, and 10 staff without dropping total context", () => {
  const cases = [
    { count: 0, hidden: 0, visible: 0 },
    { count: 1, hidden: 0, visible: 1 },
    { count: 3, hidden: 0, visible: 3 },
    { count: 4, hidden: 1, visible: 3 },
    { count: 10, hidden: 7, visible: 3 },
  ];

  for (const expected of cases) {
    const preview = getSalonProfileTeamPreview(makeStaff(expected.count));

    assert.equal(preview.totalCount, expected.count);
    assert.equal(preview.previewMembers.length, expected.visible);
    assert.equal(preview.hiddenCount, expected.hidden);
    assert.equal(preview.hasOverflow, expected.hidden > 0);
    assert.equal(
      formatSalonProfileTeamCount(preview.totalCount),
      `${expected.count} team member${expected.count === 1 ? "" : "s"}`,
    );
  }
});

test("team preview names overflow staff so the fourth member is represented", () => {
  const fourStaffPreview = getSalonProfileTeamPreview(makeStaff(4));
  const tenStaffPreview = getSalonProfileTeamPreview(makeStaff(10));

  assert.deepEqual(
    fourStaffPreview.previewMembers.map((member) => member.displayName),
    ["David", "Lucy", "Macy"],
  );
  assert.equal(
    formatSalonProfileTeamOverflowLabel(fourStaffPreview.hiddenMembers),
    "Tracy",
  );
  assert.equal(
    formatSalonProfileTeamOverflowLabel(tenStaffPreview.hiddenMembers),
    "Tracy, Ana +5 more",
  );
});

test("public team eligibility follows disable and re-enable state", () => {
  const tracyDisabled = {
    displayName: "Tracy",
    id: "staff-tracy",
    isActive: false,
    onlineBookingEnabled: true,
    salonProfileContentPostingEnabled: false,
  };
  const tracyReEnabled = { ...tracyDisabled, isActive: true };
  const onlineBookingOff = {
    displayName: "Booking off",
    id: "staff-booking-off",
    isActive: true,
    onlineBookingEnabled: false,
    salonProfileContentPostingEnabled: false,
  };
  const postingOnly = {
    displayName: "Posting only",
    id: "staff-posting-only",
    isActive: true,
    onlineBookingEnabled: false,
    salonProfileContentPostingEnabled: true,
  };

  assert.equal(isPublicSalonProfileTeamEligible(tracyDisabled), false);
  assert.equal(isPublicSalonProfileTeamEligible(tracyReEnabled), true);
  assert.equal(isPublicSalonProfileTeamEligible(onlineBookingOff), false);
  assert.equal(isPublicSalonProfileTeamEligible(postingOnly), true);
  assert.deepEqual(
    getPublicSalonProfileTeamMembers([
      tracyDisabled,
      tracyReEnabled,
      onlineBookingOff,
      postingOnly,
    ]).map((member) => member.id),
    ["staff-tracy", "staff-posting-only"],
  );
});

test("managed salon profile merges preview staff when the public RPC is stale", () => {
  const source = readFileSync(
    join(process.cwd(), "app/salon-profile/page.tsx"),
    "utf8",
  );

  assert.match(source, /function withManagedPreviewStaff/);
  assert.match(source, /previewData\.staff\.filter/);
  assert.match(source, /staff: \[\.\.\.data\.staff, \.\.\.missingPreviewStaff\]/);
  assert.match(source, /withManagedPreviewStaff\(/);
});

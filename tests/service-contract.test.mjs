import assert from "node:assert/strict";
import test from "node:test";

import {
  getServiceBookingReadiness,
  validateServiceConfig,
  wouldCreateServiceAddOnCycle,
} from "../lib/service-contract.ts";

const readyStaff = {
  id: "staff-a",
  is_active: true,
  online_booking_enabled: true,
};

const selectedAssignment = {
  is_active: true,
  online_bookable: true,
  service_id: "service-a",
  staff_id: readyStaff.id,
};

test("readiness requires the service online flag and a booking-enabled selected staff member", () => {
  const offline = getServiceBookingReadiness({
    assignments: [selectedAssignment],
    service: {
      id: "service-a",
      is_active: true,
      online_booking_enabled: false,
    },
    staff: [readyStaff],
  });

  assert.equal(offline.ready, false);
  assert.equal(offline.needsSetup, false);
  assert.equal(offline.reasons[0]?.code, "online_booking_disabled");

  const ready = getServiceBookingReadiness({
    assignments: [selectedAssignment],
    service: {
      id: "service-a",
      is_active: true,
      online_booking_enabled: true,
    },
    staff: [readyStaff],
  });

  assert.equal(ready.ready, true);
  assert.equal(ready.bookingStaffCount, 1);
  assert.equal(ready.eligibleBookingStaffCount, 1);
});

test("readiness depends on staff active state and online booking only", () => {
  const result = getServiceBookingReadiness({
    assignments: [selectedAssignment],
    service: {
      id: "service-a",
      is_active: true,
      online_booking_enabled: true,
    },
    staff: [
      {
        ...readyStaff,
      },
    ],
  });

  assert.equal(result.ready, true);
  assert.equal(result.eligibleBookingStaffCount, 1);
});

test("readiness reports selected inactive staff without considering the service ready", () => {
  const result = getServiceBookingReadiness({
    assignments: [selectedAssignment],
    service: {
      id: "service-a",
      is_active: true,
      online_booking_enabled: true,
    },
    staff: [{ ...readyStaff, is_active: false }],
  });

  assert.equal(result.ready, false);
  assert.equal(result.needsSetup, true);
  assert.equal(result.bookingStaffCount, 1);
  assert.equal(result.reasons[0]?.code, "no_ready_booking_staff");
});

test("service validation rejects inactive online services and duplicate relationships", () => {
  const result = validateServiceConfig({
    addOnServiceIds: ["service-b", "service-b"],
    basePrice: 10,
    bookingStaffIds: ["staff-a", "staff-a"],
    category: "Nails",
    description: null,
    durationMinutes: 30,
    isActive: false,
    name: "Manicure",
    onlineBookingEnabled: true,
    serviceId: "service-a",
  });

  assert.equal(result.valid, false);
  assert.match(result.fieldErrors.onlineBookingEnabled ?? "", /Activate/);
  assert.match(result.fieldErrors.bookingStaffIds ?? "", /unique/);
  assert.match(result.fieldErrors.addOnServiceIds ?? "", /unique/);
});

test("cycle detection rejects long cycles while allowing an unrelated link", () => {
  const graph = new Map([
    ["service-b", ["service-c"]],
    ["service-c", ["service-d"]],
    ["service-d", ["service-a"]],
  ]);

  assert.equal(
    wouldCreateServiceAddOnCycle({
      addOnIdsByServiceId: graph,
      addOnServiceId: "service-b",
      parentServiceId: "service-a",
    }),
    true,
  );
  assert.equal(
    wouldCreateServiceAddOnCycle({
      addOnIdsByServiceId: graph,
      addOnServiceId: "service-b",
      parentServiceId: "service-z",
    }),
    false,
  );
});

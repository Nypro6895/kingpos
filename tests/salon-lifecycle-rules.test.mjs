import assert from "node:assert/strict";
import test from "node:test";

import {
  canPerformSalonOperation,
  getSalonOperationForPermissionCode,
  isActiveSalonLifecycle,
  isHistoricalSalonLifecycle,
  normalizeSalonLifecycleStatus,
} from "../lib/salon-lifecycle-rules.ts";

test("salon lifecycle normalizes legacy inactive to disabled", () => {
  assert.equal(normalizeSalonLifecycleStatus("active"), "active");
  assert.equal(normalizeSalonLifecycleStatus("disabled"), "disabled");
  assert.equal(normalizeSalonLifecycleStatus("inactive"), "disabled");
  assert.equal(
    normalizeSalonLifecycleStatus("permanently_closed"),
    "permanently_closed",
  );
  assert.equal(normalizeSalonLifecycleStatus("unexpected"), "disabled");
});

test("active salons allow existing operational mutations", () => {
  assert.equal(
    canPerformSalonOperation({
      operation: "CREATE_BOOKING",
      status: "active",
    }),
    true,
  );
  assert.equal(
    canPerformSalonOperation({
      operation: "CREATE_POS_TICKET",
      status: "active",
    }),
    true,
  );
});

test("disabled salons preserve history while blocking new business activity", () => {
  assert.equal(isActiveSalonLifecycle("disabled"), false);
  assert.equal(isHistoricalSalonLifecycle("disabled"), true);
  assert.equal(
    canPerformSalonOperation({
      operation: "VIEW_HISTORY",
      status: "disabled",
    }),
    true,
  );
  assert.equal(
    canPerformSalonOperation({
      operation: "CREATE_BOOKING",
      status: "disabled",
    }),
    false,
  );
  assert.equal(
    canPerformSalonOperation({
      operation: "CREATE_POS_TICKET",
      status: "inactive",
    }),
    false,
  );
});

test("permanently closed salons are read-only history surfaces", () => {
  assert.equal(
    canPerformSalonOperation({
      operation: "VIEW_HISTORY",
      status: "permanently_closed",
    }),
    true,
  );
  assert.equal(
    canPerformSalonOperation({
      operation: "MANAGE_SETTINGS",
      status: "permanently_closed",
    }),
    false,
  );
  assert.equal(
    canPerformSalonOperation({
      operation: "MANAGE_STAFF",
      status: "permanently_closed",
    }),
    false,
  );
});

test("write-like permission codes map to lifecycle operations", () => {
  assert.equal(
    getSalonOperationForPermissionCode("booking.manage"),
    "CREATE_BOOKING",
  );
  assert.equal(
    getSalonOperationForPermissionCode("tickets.manage"),
    "CREATE_POS_TICKET",
  );
  assert.equal(
    getSalonOperationForPermissionCode("staff.manage"),
    "MANAGE_STAFF",
  );
  assert.equal(getSalonOperationForPermissionCode("booking.view"), null);
});

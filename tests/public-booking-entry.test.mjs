import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const salonId = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const staffId = "33333333-3333-4333-8333-333333333333";
const now = "2026-10-12T20:00:00.000Z";
class BookingDate extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return Date.parse(now); }
}

function compile(source, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => dependencies[name] ?? {}, Date: BookingDate, Intl, console });
  return exports;
}

// Keep real timezone conversion and slot generation; only external data is mocked.
const dates = ts.createSourceFile("bookings.ts", readFileSync("lib/bookings.ts", "utf8"), ts.ScriptTarget.Latest, true);
const dateNames = ["isIsoDate", "pad", "timeZoneParts", "timeZoneOffsetMs", "zonedDateTimeToUtcIso", "formatDateInTimeZone"];
const dateSource = dates.statements.filter(node => ts.isFunctionDeclaration(node) && dateNames.includes(node.name?.text)).map(node => node.getText(dates)).join("\n");
const dateFunctions = compile(dateSource);

function fixture() {
  return {
    state: "ready",
    profile: { salon_id: salonId, name: "Test salon", public_discovery_enabled: true },
    settings: { booking_enabled: true, online_booking_visible: true, guest_booking_enabled: true,
      any_professional_enabled: false, timezone_iana: "America/Chicago", maximum_advance_window_days: 14,
      minimum_lead_time_minutes: 120, same_day_booking_enabled: false, slot_interval_minutes: 15 },
    services: [{ id: serviceId, name: "Full Set", duration_minutes: 45, base_price: 40 }],
    staff: [{ id: staffId, display_name: "Professional" }],
    assignments: [{ service_id: serviceId, staff_id: staffId, custom_duration_minutes: null, custom_price: null }],
    availability_rules: [1, 2, 3, 4, 5, 6].map(day => ({ staff_id: staffId, day_of_week: day, rule_type: "working", starts_at_local: "09:00:00", ends_at_local: "17:00:00" })),
    add_on_links: [], looks: [], busy_lines: [], time_blocks: [],
  };
}

function loader(context) {
  return compile(readFileSync("lib/public-booking.ts", "utf8"), {
    "@/lib/bookings": dateFunctions,
    "@/lib/supabase/server": {
      createSupabaseServerClient: () => ({ rpc: async name => ({ data: name === "get_public_booking_context" ? context : null, error: null }) }),
      createAuthenticatedSupabaseServerClient: async () => null,
    },
    "@/lib/content-booking": { loadPublicContentBookingOptions: async () => [] },
    "@/lib/booking-deposit": { publicBookingDeposit: async () => null },
    "@/lib/salon-profile": { getSalonProfileMediaUrl: () => null },
    "@/lib/staff-profile": { getStaffProfileAvatarUrl: () => null },
  });
}

test("the direct booking link stays open before a required professional is selected", async () => {
  const api = loader(fixture());
  const page = await api.getPublicBookingPageData(salonId, {});
  assert.equal(page.state, "ready");
  assert.equal(page.initialSelection.initialStep, 0);
  assert.equal(page.initialSelection.staffMode, "specific");
  assert.equal(page.initialSelection.staffId, null);
  assert.equal(page.slots.length, 0, "no professional has been selected yet");
  assert.ok(page.readiness.every(item => item.complete));

  const slots = await api.loadPublicBookingSlots({ salonId, selection: { serviceId, staffId, staffMode: "specific", findEarliest: true } });
  assert.ok(slots.length > 0, "selecting the professional reveals real working hours");
  assert.equal(slots[0].startAt, "2026-10-13T14:00:00.000Z");
});

test("fully booked time ranges keep services, professionals, and dates editable", async () => {
  const context = fixture();
  context.settings.any_professional_enabled = true;
  context.time_blocks = [{ staff_id: staffId, starts_at: "2026-10-12T00:00:00Z", ends_at: "2026-11-30T00:00:00Z" }];
  const api = loader(context);
  for (const params of [{}, { serviceId }, { serviceId, staffId, date: "2026-10-13" }]) {
    const page = await api.getPublicBookingPageData(salonId, params);
    assert.equal(page.state, "ready");
    assert.equal(page.slots.length, 0);
    assert.equal(page.services.length, 1);
    assert.equal(page.staff.length, 1);
  }
});

test("disabled booking and incomplete setup still block the public wizard", async () => {
  for (const state of ["booking_disabled", "not_found", "not_public"]) {
    const context = fixture(); context.state = state;
    assert.equal((await loader(context).getPublicBookingPageData(salonId, {})).state, state);
  }
  for (const field of ["services", "assignments", "availability_rules"]) {
    const context = fixture(); context[field] = [];
    assert.equal((await loader(context).getPublicBookingPageData(salonId, {})).state, "incomplete", field);
  }
});

test("direct and embedded entries preserve exact-time links and recover from unavailable times", async () => {
  const api = loader(fixture());
  for (const options of [undefined, { deferAvailability: true, resolveKnownAvailability: true }]) {
    const page = await api.getPublicBookingPageData(salonId, { serviceId, staffId, startAt: "2026-10-13T14:00:00Z" }, options);
    assert.equal(page.state, "ready");
    assert.equal(page.initialSelection.initialStep, 3);
    assert.equal(page.initialSelection.startAt, "2026-10-13T14:00:00.000Z");
    const unavailable = await api.getPublicBookingPageData(salonId, { serviceId, staffId, startAt: "2026-10-13T03:00:00Z" }, options);
    assert.equal(unavailable.state, "ready");
    assert.equal(unavailable.initialSelection.requestedTimeUnavailable, true);
    assert.equal(unavailable.initialSelection.initialStep, 2);
  }
});

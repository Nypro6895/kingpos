import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("owner appointment rows expose customer, edit, ticket, and settings actions", () => {
  const client = read("app/bookings/booking-workspace-client.tsx");
  const actions = read("app/bookings/actions.ts");
  const bookingLoader = read("lib/bookings.ts");
  const migration = read(
    "supabase/migrations/202608140002_booking_change_notifications.sql",
  );
  const notifications = read("lib/notification-feed-items.ts");

  assert.match(client, /function AppointmentTableRow/);
  assert.match(client, /customerProfileHref = booking\.customer\?\.id/);
  assert.match(client, /href=\{customerProfileHref\}/);
  assert.match(client, /function AppointmentRowInlinePopover/);
  assert.match(client, /setPopover\(popover === "status"/);
  assert.match(client, /setPopover\(popover === "time"/);
  assert.match(client, /setPopover\(popover === "services"/);
  assert.match(client, /setPopover\(popover === "professional"/);
  assert.match(client, /Confirm changes/);
  assert.match(client, /createBookingPosTicketAction/);
  assert.match(client, /<SettingsIcon \/>/);
  assert.ok(!client.includes("aria-hidden=\"true\">\n                  ..."));
  assert.match(client, /Next 7 days/);
  assert.match(client, />\s*All\s*<\/button>/);
  assert.match(client, /range: range === "day" \? null : range/);
  assert.match(client, /showDate=\{filters\.dateRange !== "day"\}/);

  assert.match(actions, /export async function replaceOwnerBookingServicesAction/);
  assert.match(actions, /staffIds\?: \(string \| null\)\[\]/);
  assert.match(actions, /requestedStaffIds/);
  assert.match(actions, /rpc\(\s*"replace_booking_services"/);
  assert.match(actions, /notifyBookingChange/);
  assert.match(actions, /rpc\("notify_booking_change"/);
  assert.match(actions, /revalidatePath\("\/staff\/appointments"\)/);
  assert.match(actions, /revalidatePath\("\/notifications"\)/);

  assert.match(bookingLoader, /range\?: string \| string\[\]/);
  assert.match(bookingLoader, /BookingWorkspaceDateRange = "all" \| "day" \| "next7"/);
  assert.match(bookingLoader, /const dateRange = normalizeDateRange/);
  assert.match(bookingLoader, /dateRange,/);
  assert.match(bookingLoader, /view: dateRange === "day" \? view : "list"/);
  assert.match(bookingLoader, /filters\.dateRange === "all" \? 500/);

  assert.match(migration, /create or replace function public\.notify_booking_change/);
  assert.match(migration, /recipient_kind,[\s\S]*'customer'/);
  assert.match(migration, /recipient_kind,[\s\S]*'staff'/);
  assert.match(migration, /\/my-bookings\//);
  assert.match(migration, /\/staff\/appointments\?date=/);
  assert.match(migration, /create or replace function public\.replace_booking_services/);
  assert.match(migration, /'services_adjusted'/);

  assert.match(notifications, /href\.startsWith\("\/staff\/appointments"\)/);
});

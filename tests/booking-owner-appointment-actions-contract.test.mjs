import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function assertAppearsInOrder(source, labels) {
  let cursor = -1;

  for (const label of labels) {
    const index = source.indexOf(label, cursor + 1);
    assert.notEqual(index, -1, `Expected to find ${label}`);
    assert.ok(index > cursor, `Expected ${label} after previous marker`);
    cursor = index;
  }
}

test("owner appointment rows expose customer, edit, ticket, and settings actions", () => {
  const client = read("app/bookings/booking-workspace-client.tsx");
  const actions = read("app/bookings/actions.ts");
  const domain = read("lib/booking-domain/mutations.ts");
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
  assert.match(client, /<SchedulePicker/);
  assert.match(read("components/booking-ui/schedule-picker.tsx"), /range: "next7"/);
  assert.match(read("components/booking-ui/schedule-picker.tsx"), /7 days from selected date/);
  assert.match(client, /range:value\.range === "day" \? null : value\.range/);
  assert.match(client, /showDate=\{filters\.dateRange !== "day"\}/);

  assert.match(actions, /export async function replaceOwnerBookingServicesAction/);
  assert.match(actions, /staffIds\?: \(string \| null\)\[\]/);
  assert.match(actions, /changes\.lines=schedule\.lines\.map/);
  assert.match(actions, /rpc\('save_pos_workspace_booking'/);
  assert.match(actions, /notifyBookingChange/);
  assert.match(actions, /rpc\("notify_booking_change"/);
  assert.match(actions, /rpc\(\s*"resolve_public_booking_request_notifications"/);
  assert.match(actions, /Date\.parse\(booking\.updated_at\)!==Date\.parse\(input\.expectedUpdatedAt\)/);
  assert.match(actions, /p_expected:input\.expectedUpdatedAt/);
  assert.match(actions, /if\(error\)return failure[\s\S]*await notifyBookingChange/);
  assert.match(
    actions,
    /if\(input\.command==='confirm'\)await resolveBookingRequestNotifications/,
    "Owner confirm should resolve the original pending booking request notifications.",
  );
  assert.match(actions, /revalidatePath\("\/bookings"\)/);
  assert.match(actions, /revalidatePath\("\/staff\/appointments"\)/);
  assert.match(actions, /revalidatePath\("\/notifications"\)/);

  assert.match(domain, /changed\?: boolean/);
  assert.match(domain, /\.select\("status, confirmation_status"\)/);
  assert.match(domain, /\.eq\("status", currentBooking\.status\)/);
  assert.match(domain, /bookingOk\(\{ bookingId: input\.bookingId, changed: false \}\)/);
  assert.match(domain, /Booking status changed\. Refresh and try again\./);

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

test("booking list columns follow the requested owner workflow order", () => {
  const client = read("app/bookings/booking-workspace-client.tsx");
  const css = read("app/bookings/booking-workspace.css");
  const headerStart = client.indexOf("<div className={styles.tableHeader}>");
  const headerEnd = client.indexOf("{visibleBookings.map", headerStart);
  const rowStart = client.indexOf("<div className={styles.tableRow}>");
  const rowEnd = client.indexOf("{result ?", rowStart);

  assert.notEqual(headerStart, -1);
  assert.notEqual(headerEnd, -1);
  assert.notEqual(rowStart, -1);
  assert.notEqual(rowEnd, -1);

  assertAppearsInOrder(client.slice(headerStart, headerEnd), [
    "<div>Time</div>",
    "<div>Professional</div>",
    "<div>Services</div>",
    "<div>Customer</div>",
    "<div>Total</div>",
    "<div>Status</div>",
    "<div>Create ticket</div>",
    "<div>Edit</div>",
  ]);

  assertAppearsInOrder(client.slice(rowStart, rowEnd), [
    'aria-label="Adjust appointment time"',
    'aria-label="Adjust appointment professional"',
    'aria-label="Adjust appointment services"',
    "booking.customer?.name",
    "{formatMoney(booking.subtotal)}",
    'aria-label="Adjust appointment status"',
    "createTicket",
    'aria-label="Open appointment settings"',
  ]);

  assert.match(
    css,
    /grid-template-columns: 112px minmax\(190px, 1fr\) minmax\(240px, 1\.35fr\) minmax\(210px, 1\.1fr\) 104px 126px 126px 54px;/,
  );
});

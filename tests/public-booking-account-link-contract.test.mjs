import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("public booking confirmation links authenticated customers and notifies salon managers", () => {
  const migration = read(
    "supabase/migrations/202608140001_public_booking_account_notifications.sql",
  );
  const publicBooking = read("lib/public-booking.ts");
  const bookActions = read("app/book/actions.ts");
  const notifications = read("lib/notification-feed-items.ts");
  const bookingMutations = read("lib/booking-domain/mutations.ts");

  assert.match(
    migration,
    /actor_user_id uuid := public\.current_public_user_id\(\)/,
    "Public booking RPC must know the signed-in ReyLUMI user.",
  );
  assert.match(
    migration,
    /insert into public\.customers \([\s\S]*customer_user_id[\s\S]*created_by_user_id/,
    "Public booking customer rows should be linked to the actor when available.",
  );
  assert.match(
    migration,
    /insert into public\.bookings \([\s\S]*customer_user_id[\s\S]*created_by_user_id/,
    "Public booking rows should be readable by the personal My bookings query.",
  );
  assert.match(
    migration,
    /perform public\.notify_public_booking_created\(new_booking_id\)/,
    "Public booking creation should notify salon managers.",
  );
  assert.match(migration, /notification_type[\s\S]*'public_booking_created'/);
  assert.match(migration, /href[\s\S]*'\/bookings\?date='/);
  assert.match(migration, /roles\.code = 'OWNER'/);
  assert.match(migration, /permissions\.code = 'booking\.manage'/);
  assert.match(
    migration,
    /create policy "customer_read_own_booking_lines"[\s\S]*bookings\.customer_user_id = public\.current_public_user_id\(\)/,
    "Customers need read access to the service lines for their own linked bookings.",
  );

  assert.match(
    publicBooking,
    /claim_guest_booking_by_manage_token/,
    "App layer should idempotently link the new booking before returning a personal manage link.",
  );
  assert.match(bookActions, /revalidatePath\("\/my-bookings"\)/);
  assert.match(bookActions, /revalidatePath\("\/bookings"\)/);
  assert.match(bookActions, /revalidatePath\("\/notifications"\)/);

  assert.match(notifications, /PUBLIC_BOOKING_CREATED_TYPE = "public_booking_created"/);
  assert.match(
    notifications,
    /notification\.notification_type === PUBLIC_BOOKING_CREATED_TYPE[\s\S]*matchesPath\(href, PUBLIC_BOOKING_HREF\)/,
    "Owner booking notifications should switch to the salon manage workspace.",
  );

  assert.match(
    bookingMutations,
    /confirmationStatusForTransition[\s\S]*return "confirmed"/,
    "Owner confirm must clear requested confirmation status.",
  );
  assert.match(
    bookingMutations,
    /confirmation_status: "cancelled"/,
    "Terminal manager actions should not leave request confirmation pending.",
  );
});

test("unavailable public booking does not expose owner setup readiness", () => {
  const publicBookingClient = read(
    "app/book/[salonId]/public-booking-client.tsx",
  );
  const publicBooking = read("lib/public-booking.ts");
  const directBookingMigration = read(
    "supabase/migrations/202608180003_public_booking_direct_link_visibility.sql",
  );
  const unavailableState = publicBookingClient.slice(
    publicBookingClient.indexOf("function UnavailableState"),
    publicBookingClient.indexOf("function slotHour"),
  );

  assert.doesNotMatch(
    unavailableState,
    /data\.readiness|Needs setup|readiness\.map/,
    "Customer unavailable state must not show owner setup checklist items.",
  );
  assert.match(
    unavailableState,
    /salon\?\.publicProfileEnabled/,
    "Unpublished salons must not link customers to a public profile route that 404s.",
  );
  assert.match(
    publicBooking,
    /publicProfileEnabled: boolean/,
    "Public booking should carry profile publication separately from booking availability.",
  );
  assert.doesNotMatch(
    directBookingMigration,
    /when settings\.public_discovery_enabled is not true then 'not_public'/,
    "Direct public booking links should not require Explore publication.",
  );
  assert.match(
    directBookingMigration,
    /'public_discovery_enabled', coalesce\(settings\.public_discovery_enabled, false\)/,
    "The public booking payload should still say whether the Explore profile is published.",
  );
  assert.match(
    publicBooking,
    /const unavailableBase = \{[\s\S]*readiness: \[\] as PublicBookingReadinessItem\[\]/,
    "Unavailable public booking payloads should not carry setup readiness to the client.",
  );
  assert.match(
    publicBooking,
    /This booking page is not available yet\. Please contact the salon directly/,
    "Incomplete booking copy should stay customer-facing.",
  );
});

test("public booking uses staff-specific availability before salon fallback", () => {
  const publicBooking = read("lib/public-booking.ts");

  assert.match(
    publicBooking,
    /function availabilityRulesForStaff/,
    "Public slots should resolve effective rules through one helper.",
  );
  assert.match(
    publicBooking,
    /const staffRules = rules\.filter\(\(rule\) => rule\.staffId === staffId\)/,
    "Staff-specific rules should be detected before fallback rules.",
  );
  assert.match(
    publicBooking,
    /staffRules\.length > 0[\s\S]*rules\.filter\(\(rule\) => !rule\.staffId\)/,
    "Salon-level hours should only be a fallback when staff has no custom rules.",
  );
  assert.match(
    publicBooking,
    /availabilityRulesForStaff\(\s*input\.context,\s*input\.staffId,\s*"working"[\s\S]*\.some/,
    "lineAvailable should use effective working rules.",
  );
  assert.match(
    publicBooking,
    /availabilityRulesForStaff\(\s*input\.context,\s*input\.staffId,\s*"break"[\s\S]*\.some/,
    "Break rules should follow the same effective-rule model.",
  );
  assert.match(
    publicBooking,
    /for \(const staffId of firstLineStaffIds\)[\s\S]*availabilityRulesForStaff\(context, staffId, "working"\)/,
    "Candidate slot starts should be generated from each candidate staff member's effective hours.",
  );
});

test("staff and public booking share salon online booking gates", () => {
  const bookingStatus = read("lib/booking-status.ts");
  const directBookingMigration = read(
    "supabase/migrations/202608180003_public_booking_direct_link_visibility.sql",
  );

  assert.match(
    directBookingMigration,
    /booking_settings\.booking_enabled is not true[\s\S]*booking_settings\.online_booking_visible is not true[\s\S]*booking_settings\.guest_booking_enabled is not true/,
    "Public booking readiness is gated by booking_settings booking, visibility, and guest-booking fields.",
  );
  assert.match(
    bookingStatus,
    /bookingEnabled && onlineBookingVisible && guestBookingEnabled/,
    "Staff-facing salon booking status should use the same public booking gates.",
  );
  assert.doesNotMatch(
    bookingStatus,
    /public_discovery_enabled|owner_public_enabled|public_profile_visible|staff_public_consent_status/,
    "Public/Profile visibility must not determine salon online booking state.",
  );
});

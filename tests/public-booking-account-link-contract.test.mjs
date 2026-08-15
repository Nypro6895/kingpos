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

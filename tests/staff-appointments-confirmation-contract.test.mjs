import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("staff schedule keeps salon-facing UX and staff booking controls", () => {
  const page = read("app/staff/appointments/page.tsx");
  const css = read("app/staff/appointments/staff-appointments.css");
  const actions = read("app/staff/appointments/actions.ts");
  const loader = read("lib/staff-appointments.ts");
  const setupLoader = read("lib/booking-setup.ts");
  const settingsClient = read(
    "app/staff/appointments/staff-booking-settings-client.tsx",
  );
  const setupActions = read("app/booking-setup/actions.ts");
  const bookingStatus = read("lib/booking-status.ts");
  const unifiedStaffProfileMigration = read(
    "supabase/migrations/202608180009_unified_staff_profile_public_presentation.sql",
  );

  assert.match(
    page,
    /const salonName =[\s\S]*currentStaffSalon\?\.name[\s\S]*data\.context\.salonName/,
    "Staff schedule title should show the staff salon name.",
  );
  assert.match(
    page,
    /staff-appointments-titlebar[\s\S]*<h1>\{salonName\}<\/h1>/,
    "The salon name should be the primary heading, not a small label.",
  );
  assert.doesNotMatch(
    page,
    /currentAccount\?\.name|accountName\} \/|Account \/ /,
    "Staff schedule should not show the personal account name in the page title.",
  );
  assert.match(page, /staff-appointments-toolbar[\s\S]*staff-appointments-toolbar-actions/);
  assert.match(page, /staff-appointments-toolbar-actions[\s\S]*staff-appointments-toolbar-tabs/);
  assert.match(page, /variant="toolbar"/);
  assert.doesNotMatch(
    page,
    /<section className="staff-appointments-frame staff-appointments-body py-4">[\s\S]*<StaffBookingSettings/,
    "Booking settings explainer should not sit in the schedule body.",
  );
  assert.match(page, /<WeekView data=\{data\} params=\{params\} \/>/);
  assert.match(page, /<DayCanvas data=\{data\} params=\{params\} \/>/);
  assert.match(page, /staff-appointments-day-card-list/);
  assert.match(page, /function QuickAppointmentPopover/);
  assert.match(page, /quickId: appointment\.bookingId/);
  assert.match(page, /href=\{buildHref\(params, \{ bookingId: appointment\.bookingId \}\)\}/);
  assert.match(page, /appointmentDisplayStatus\(appointment\)/);
  assert.match(page, /appointmentRequiresConfirmation\(appointment\)/);
  assert.match(
    page,
    /workingStarts\.length > 0 \? workingStarts : appointmentStarts/,
    "Week timeline should prefer configured working booking hours over 24-hour padding.",
  );
  assert.doesNotMatch(
    page,
    /Math\.min\(\.\.\.starts, 9 \* 60\) - 60|Math\.max\(\.\.\.ends, 18 \* 60\) \+ 60/,
    "Week timeline should not add old one-hour padding outside booking hours.",
  );
  assert.match(page, /staff-appointments-timeline-card-status/);
  assert.match(page, /data-status=\{displayStatus\}/);
  assert.doesNotMatch(page, /data-status=\{appointment\.status\}/);
  assert.match(page, /staff-appointments-detail-overlay/);
  assert.doesNotMatch(page, /<SetupSummary/);
  assert.match(page, /Confirm/);
  assert.match(page, /confirmationStatus/);
  assert.match(page, /<StaffBookingSettings/);
  assert.match(page, /salonBookingStatus=\{data\.salonBookingStatus\}/);
  assert.match(page, /staff-appointments-detail-head/);
  assert.match(page, /staff-appointments-detail-body/);
  assert.match(page, /staff-appointments-detail-actions/);
  assert.doesNotMatch(
    page,
    /<dt>\s*Service note\s*<\/dt>/,
    "Appointment detail should not show a duplicate read-only service note above the editor.",
  );

  assert.match(css, /--staff-booking-plum: var\(--brand-orange/);
  assert.match(css, /--staff-booking-teal/);
  assert.match(css, /staff-appointments-titlebar/);
  assert.match(css, /staff-appointments-toolbar-actions/);
  assert.match(css, /staff-booking-settings-trigger/);
  assert.match(css, /staff-appointments-day-card-list/);
  assert.match(css, /staff-appointments-appointment-row/);
  assert.match(css, /staff-appointments-quick-popover/);
  assert.match(css, /staff-appointments-week-timeline/);
  assert.match(css, /grid-template-columns: 72px repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(css, /staff-appointments-timeline-card-status/);
  assert.doesNotMatch(css, /background: #9a5b13/);
  assert.match(css, /staff-appointments-detail-sheet/);
  assert.match(css, /max-width: min\(420px, 100vw\)/);
  assert.match(css, /staff-appointments-detail-actions/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /staff-booking-settings-sheet/);
  assert.doesNotMatch(css, /min-width: 1120px/);
  assert.doesNotMatch(
    css,
    /@media \(min-width: 1180px\)[\s\S]*staff-appointments-body[\s\S]*grid-template-columns/,
  );

  assert.match(actions, /export async function confirmStaffBookingAction/);
  assert.match(actions, /rpc\("confirm_assigned_booking"/);
  assert.doesNotMatch(actions, /updateStaffOnlineBookingAction/);
  assert.doesNotMatch(actions, /set_own_staff_online_booking/);
  assert.match(actions, /revalidatePath\("\/", "layout"\)/);
  assert.match(actions, /revalidatePath\("\/notifications"\)/);

  assert.match(settingsClient, /Booking settings/);
  assert.match(settingsClient, /variant = "summary"/);
  assert.match(settingsClient, /variant\?: "summary" \| "toolbar"/);
  assert.match(settingsClient, /staff-booking-settings-trigger/);
  assert.match(settingsClient, /const trigger =\s*variant === "toolbar"/);
  assert.match(settingsClient, /salonBookingStatus: SalonOnlineBookingStatus/);
  assert.match(settingsClient, /salonBookingStatus\.onlineBookingOpen/);
  assert.match(settingsClient, /label: isBookingOff \? "Salon off" : "Salon paused"/);
  assert.match(settingsClient, /label: "Off for you"/);
  assert.match(settingsClient, /label: "Booking hours needed"/);
  assert.match(settingsClient, /label: "Online booking active"/);
  assert.match(
    settingsClient,
    /The salon is accepting online bookings, but you're currently unavailable online\./,
    "Staff-off copy must not say the salon is off.",
  );
  assert.doesNotMatch(settingsClient, /Your settings are saved here/);
  assert.match(settingsClient, /saveStaffWeeklyAvailabilityAction/);
  assert.match(settingsClient, /createStaffTimeBlockAction/);
  assert.doesNotMatch(settingsClient, /updateStaffOnlineBookingAction/);
  assert.match(settingsClient, /Bookable services/);
  assert.match(settingsClient, /Read-only/);
  assert.match(settingsClient, /Booking notifications/);
  assert.match(
    unifiedStaffProfileMigration,
    /drop function if exists public\.set_own_staff_online_booking\(uuid, boolean\)/,
    "Staff online booking is now owner-managed, not a staff self-service RPC.",
  );

  assert.match(setupActions, /isSalonStaffContext/);
  assert.match(setupActions, /resolveStaffAccountForSalon/);
  assert.match(
    setupActions,
    /requestedStaffId !== actionContext\.ownStaffId/,
    "Staff availability/time-off actions must be self-scoped.",
  );

  assert.match(loader, /confirmationStatus: BookingConfirmationStatus/);
  assert.match(
    loader,
    /select\("timezone_iana, booking_enabled, online_booking_visible, guest_booking_enabled"\)/,
    "Staff schedule must read all public booking gates from booking_settings.",
  );
  assert.match(loader, /getSalonOnlineBookingStatus\(settings\)/);
  assert.match(loader, /loadSalonBookingSettings/);
  assert.match(loader, /rpc\("get_public_booking_context"/);
  assert.match(loader, /parseBookingSettingsRow\(asRecord\(fallback\.data\)\.settings\)/);
  assert.match(loader, /bookingEnabled: salonBookingStatus\.onlineBookingOpen/);
  assert.match(loader, /salonBookingStatus,/);
  assert.match(loader, /onlineBookingEnabled: staff\.online_booking_enabled/);
  assert.match(loader, /selectedBookingId[\s\S]*appointments\.find/);
  assert.doesNotMatch(loader, /appointments\[0\] \?\?/);

  assert.match(setupLoader, /getSalonOnlineBookingStatus/);
  assert.match(
    setupLoader,
    /BOOKING_SETTINGS_TIMEZONE_SELECT =[\s\S]*guest_booking_enabled/,
    "Owner booking setup readiness should use the same booking_settings gates.",
  );
  assert.match(
    setupLoader,
    /bookingEnabled: salonBookingStatus\.onlineBookingOpen/,
    "Owner booking setup should not treat booking_enabled alone as live online booking.",
  );

  assert.match(bookingStatus, /export function getSalonOnlineBookingStatus/);
  assert.match(bookingStatus, /settings\?\.booking_enabled === true/);
  assert.match(bookingStatus, /settings\?\.online_booking_visible === true/);
  assert.match(bookingStatus, /settings\?\.guest_booking_enabled === true/);
  assert.match(
    bookingStatus,
    /bookingEnabled && onlineBookingVisible && guestBookingEnabled/,
    "Salon online booking must match the public booking live gates.",
  );
  assert.doesNotMatch(
    bookingStatus,
    /owner_public_enabled|public_profile_visible|staff_public_consent_status|Beauty|beauty|profile publishing/,
    "Booking status resolver must not depend on public profile or Beauty visibility.",
  );
});

test("staff booking confirmation is guarded and assigned staff are notified", () => {
  const migration = read(
    "supabase/migrations/202608180002_staff_booking_confirm_controls.sql",
  );
  const resolutionMigration = read(
    "supabase/migrations/202608180005_staff_booking_confirmation_notification_resolution.sql",
  );
  const rlsFixMigration = read(
    "supabase/migrations/202608180007_booking_rls_recursion_fix.sql",
  );
  const backfillMigration = read(
    "supabase/migrations/202608180008_backfill_staff_public_booking_notifications.sql",
  );
  const lineMigration = read(
    "supabase/migrations/202608180004_staff_booking_line_transitions.sql",
  );
  const types = read("types/supabase.ts");

  assert.match(
    migration,
    /create or replace function public\.confirm_assigned_booking/,
    "Staff confirm should be implemented as a security-definer RPC.",
  );
  assert.match(migration, /public\.current_user_staff_id_for_salon/);
  assert.match(
    migration,
    /booking_lines\.assigned_staff_id = actor_staff_id/,
    "Staff can only confirm bookings assigned to their own staff record.",
  );
  assert.match(migration, /actor_staff_id/);
  assert.match(migration, /actor_source[\s\S]*'staff'/);
  assert.match(migration, /confirmation_status = 'confirmed'/);
  assert.match(migration, /perform public\.notify_booking_change/);

  assert.match(
    migration,
    /create policy "salon_member_read_booking_setup"[\s\S]*current_user_staff_id_for_salon/,
    "Linked staff should be able to read booking settings needed by the staff workspace.",
  );
  assert.match(
    migration,
    /create policy "salon_member_read_booking_lines"[\s\S]*assigned_staff_id = public\.current_user_staff_id_for_salon/,
    "Linked staff should be able to read their own assigned booking lines.",
  );
  assert.match(
    rlsFixMigration,
    /create or replace function public\.current_user_has_booking_assignment[\s\S]*security definer[\s\S]*from public\.booking_lines assigned_lines/,
    "Booking policies should use a security-definer helper for assigned-staff checks instead of recursively querying booking_lines inside RLS.",
  );
  assert.match(
    rlsFixMigration,
    /create or replace function public\.current_user_can_read_booking\([\s\S]*public\.current_user_has_booking_assignment/,
    "Booking row visibility should keep owner/customer/assigned-staff access in one helper.",
  );
  assert.match(
    rlsFixMigration,
    /drop policy if exists "customer_read_own_booking_lines" on public\.booking_lines/,
    "The old customer booking_lines policy queried bookings and must be replaced to avoid RLS recursion.",
  );
  assert.match(
    rlsFixMigration,
    /create policy "booking_participant_read_booking_lines"[\s\S]*public\.current_user_can_read_booking_line/,
    "Booking line visibility should use a non-recursive participant helper.",
  );
  assert.match(migration, /'staff'[\s\S]*'public_booking_created'/);
  assert.match(migration, /staff_href := '\/staff\/appointments\?date='/);
  assert.match(migration, /public_booking_created_staff:/);
  assert.match(
    migration,
    /select distinct[\s\S]*from public\.booking_lines booking_lines[\s\S]*join public\.staff staff on staff\.id = booking_lines\.assigned_staff_id/,
    "Staff booking requests should be fanned out from actual assigned booking lines.",
  );
  assert.match(
    migration,
    /staff\.is_active = true/,
    "Inactive staff records should not receive booking request notifications.",
  );
  assert.match(
    backfillMigration,
    /owner_notifications\.notification_type = 'public_booking_created'[\s\S]*owner_notifications\.recipient_kind = 'owner_manager'/,
    "Existing owner public-booking notifications should be mirrored to assigned staff.",
  );
  assert.match(
    backfillMigration,
    /from public\.booking_lines booking_lines[\s\S]*join public\.staff staff[\s\S]*booking_lines\.booking_id = booking_notice\.id[\s\S]*staff\.is_active = true/,
    "Backfill should notify only active staff assigned through booking lines.",
  );
  assert.match(
    backfillMigration,
    /'public_booking_created_staff:' \|\| booking_notice\.id::text \|\| ':' \|\| staff_recipients\.recipient_user_id::text/,
    "Backfilled staff notifications should use the same idempotency key as future notifications.",
  );
  assert.match(
    backfillMigration,
    /on conflict \(recipient_user_id, event_key\) where event_key is not null do nothing/,
    "Backfill must not reset existing staff notifications or unread state.",
  );

  assert.match(
    resolutionMigration,
    /create or replace function public\.resolve_public_booking_request_notifications/,
    "Confirming a booking should resolve stale public-booking request notifications.",
  );
  assert.match(resolutionMigration, /public\.user_can_manage_salon\(booking_row\.salon_id\)/);
  assert.match(
    resolutionMigration,
    /public\.current_user_staff_id_for_salon\(booking_row\.salon_id\)[\s\S]*booking_lines\.assigned_staff_id = actor_staff_id/,
    "Notification resolution should be authorized for owners/managers or assigned active staff only.",
  );
  assert.match(
    resolutionMigration,
    /booking_row\.status <> 'confirmed'[\s\S]*booking_row\.confirmation_status <> 'confirmed'/,
    "Request notifications should only be resolved after the single booking state is confirmed.",
  );
  assert.match(
    resolutionMigration,
    /update public\.app_notifications[\s\S]*set title = 'New booking confirmed'[\s\S]*notification_type = 'public_booking_created'[\s\S]*title = 'New booking request'/,
    "Stale request notifications should be updated instead of leaving a confirm request visible.",
  );
  assert.match(
    resolutionMigration,
    /public_booking_created:[\s\S]*public_booking_created_staff:/,
    "Both owner and staff public booking request notifications should resolve.",
  );
  assert.match(
    resolutionMigration,
    /if already_confirmed then[\s\S]*perform public\.resolve_public_booking_request_notifications/,
    "Staff confirm should be idempotent and still clear stale requests.",
  );
  assert.match(
    resolutionMigration,
    /update public\.bookings[\s\S]*confirmation_status = 'confirmed'[\s\S]*perform public\.resolve_public_booking_request_notifications[\s\S]*perform public\.notify_booking_change/,
    "Staff confirm should update the shared booking state before firing existing booking-change notifications.",
  );

  assert.match(lineMigration, /create or replace function public\.start_assigned_booking_line/);
  assert.match(lineMigration, /target_line\.assigned_staff_id is distinct from actor_staff_id/);
  assert.match(lineMigration, /line_status = 'in_service'/);
  assert.match(lineMigration, /create or replace function public\.complete_assigned_booking_line/);
  assert.match(lineMigration, /line_status = 'completed'/);
  assert.match(lineMigration, /Confirm the booking before starting service/);

  assert.match(types, /confirm_assigned_booking/);
  assert.match(types, /resolve_public_booking_request_notifications/);
});

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const bookingActions = read("app/bookings/actions.ts");
const staffActions = read("app/staff/actions.ts");
const staffProfileService = read("lib/staff-profile.ts");
const portableActions = read("app/pos/portable/actions.ts");
const staffService = read("lib/staff.ts");
const servicesService = read("lib/services.ts");
const bookingSetupService = read("lib/booking-setup.ts");
const publicBookingService = read("lib/public-booking.ts");
const payrollService = read("lib/payroll.ts");
const payrollTypes = read("types/payroll.ts");
const staffProfileEditor = read("app/staff/staff-public-profile-editor.tsx");
const staffMyWorkDrawer = read("app/staff/my-work/staff-profile-settings-drawer.tsx");
const staffSlideOver = read("app/staff/staff-slide-over.tsx");
const publicTeamSettingsAction = read("app/salon-settings/actions.ts");
const publicTeamSettingsEditor = read(
  "app/salon-settings/public-team-settings-editor.tsx",
);
const migration = read(
  "supabase/migrations/202608180009_unified_staff_profile_public_presentation.sql",
);
const allMigrationSql = readdirSync(join(root, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => read(`supabase/migrations/${name}`))
  .join("\n\n");

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function latestMigrationFunctionBlock(name) {
  const start = allMigrationSql.lastIndexOf(
    `create or replace function public.${name}`,
  );

  assert.ok(start >= 0, `${name} latest function is present`);

  const end = allMigrationSql.indexOf("\n$$;", start);

  assert.ok(end > start, `${name} latest function has a readable boundary`);

  return allMigrationSql.slice(start, end + "\n$$;".length);
}

test("staff row remains the salon-scoped Staff Profile data model", () => {
  const staffTableStart = allMigrationSql.indexOf("create table public.staff (");
  const staffTableEnd = allMigrationSql.indexOf("\n);", staffTableStart);

  assert.ok(staffTableStart >= 0 && staffTableEnd > staffTableStart);

  const staffTable = allMigrationSql.slice(staffTableStart, staffTableEnd);

  assert.match(staffTable, /salon_id uuid not null references public\.locations/);
  assert.match(staffTable, /account_user_id uuid references public\.users/);
  assert.match(staffTable, /display_name text not null/);
  assert.match(staffTable, /public_profile_photo_path text/);
  assert.match(staffTable, /public_bio text/);
  assert.match(staffTable, /specialties text\[\] not null default/);
  assert.doesNotMatch(
    allMigrationSql,
    /create\s+table\s+public\.staff_profiles?\s*\(/i,
  );
});

test("central Staff Profile resolver owns presentation fallback and defaults", () => {
  assert.match(staffProfileService, /import "server-only"/);
  assert.match(staffProfileService, /function getStaffProfileAvatarUrl/);
  assert.match(staffProfileService, /getStaffProfilePhotoUrl\(input\.staffProfilePhotoPath\)/);
  assert.match(staffProfileService, /beautyByAccountUserId/);
  assert.match(staffProfileService, /\.from\("beauty_profiles"\)/);
  assert.match(staffProfileService, /\.eq\("visibility", "public"\)/);
  assert.match(staffProfileService, /safeAccountAvatarUrl\(input\.beautyAvatarUrl\)/);
  assert.match(staffProfileService, /safeAccountAvatarUrl\(input\.accountAvatarUrl\)/);
  assert.match(staffProfileService, /function getStaffProfileDisplayName/);
  assert.match(staffProfileService, /function identitySeedDisplayName/);
  assert.match(
    staffProfileService,
    /beautyDefaultDisplayName\(input\.beautyIdentity\)[\s\S]*userDefaultDisplayName\(input\.connectedUser\)/,
  );
  assert.match(staffProfileService, /function resolveStaffPresentation/);
  assert.match(staffProfileService, /initializeStaffProfileDefaultsForStaffId/);
  assert.match(staffProfileService, /shouldSeedDisplayName/);
  assert.match(staffProfileService, /normalized === "staff"/);
  assert.doesNotMatch(
    staffProfileService,
    /update\([\s\S]*public_bio/,
    "Beauty/personal bio must not be silently copied into Staff Profile defaults.",
  );
});

test("manual staff creation shares the Staff Profile initializer", () => {
  assert.match(staffActions, /createStaffRecord/);
  assert.match(bookingActions, /createStaffRecord/);
  assert.match(staffService, /initializeStaffProfileDefaultsForStaffId/);
  assert.match(
    staffService,
    /await initializeStaffProfileDefaultsForStaffId\(\{[\s\S]*salonId: salon\.id,[\s\S]*staffId: data\.id,[\s\S]*supabase,[\s\S]*\}\);/,
  );
});

test("public staff resolvers expose only public presentation fields", () => {
  const publicStaff = latestMigrationFunctionBlock("get_public_salon_profile_staff");

  assert.match(publicStaff, /account_avatar_url text/);
  assert.match(publicStaff, /left join public\.users account_users/);
  assert.match(publicStaff, /staff\.is_active = true/);
  assert.match(
    publicStaff,
    /staff\.online_booking_enabled = true[\s\S]*or staff\.salon_profile_content_posting_enabled = true/,
  );
  assert.doesNotMatch(
    publicStaff,
    /and staff\.public_profile_visible = true/,
    "Public staff visibility must be derived from booking/posting source fields, not a stale denormalized flag.",
  );
  assert.match(publicStaff, /public\.salon_profile_public_salon_exists/);
  assert.doesNotMatch(publicStaff, /email|phone|legal_name|staff_payroll_settings/i);
  assert.doesNotMatch(publicStaff, /auth_user_id/i);

  assert.match(staffProfileService, /normalizeSalonProfileMediaPath/);
  assert.match(staffProfileService, /SALON_PROFILE_MEDIA_BUCKET/);
  assert.match(staffProfileService, /safeAccountAvatarUrl/);
});

test("public booking keeps service assignment and availability as authority", () => {
  const publicBookingContext = latestMigrationFunctionBlock("get_public_booking_context");

  assert.match(publicBookingContext, /from public\.staff_service_assignments/);
  assert.match(publicBookingContext, /staff_service_assignments\.is_active = true/);
  assert.match(publicBookingContext, /staff_service_assignments\.online_bookable = true/);
  assert.match(publicBookingContext, /from public\.staff_availability_rules/);
  assert.match(publicBookingContext, /from public\.booking_lines/);
  assert.match(publicBookingContext, /'staff_id', booking_lines\.assigned_staff_id/);
  assert.match(publicBookingContext, /staff\.is_active = true/);
  assert.match(publicBookingContext, /staff\.online_booking_enabled = true/);
  assert.match(publicBookingContext, /'account_avatar_url', account_users\.avatar_url/);
  assert.doesNotMatch(publicBookingContext, /when staff\.public_profile_visible/);
  assert.match(publicBookingService, /getStaffProfileAvatarUrl/);
  assert.match(publicBookingService, /staff\.account_avatar_url/);
});

test("Portable POS desk staff shares unified staff avatar presentation", () => {
  const portableDeskData = latestMigrationFunctionBlock("get_pos_portable_desk_data");

  assert.match(portableDeskData, /'accountAvatarUrl', coalesce\(account_users\.avatar_url, legacy_users\.avatar_url\)/);
  assert.match(portableDeskData, /'beautyAvatarUrl'[\s\S]*account_beauty_profiles\.user_id[\s\S]*legacy_beauty_profiles\.user_id/);
  assert.match(portableDeskData, /'staffProfilePhotoPath', staff\.public_profile_photo_path/);
  assert.match(portableDeskData, /left join public\.users account_users/);
  assert.match(portableDeskData, /left join public\.beauty_profiles account_beauty_profiles/);
  assert.match(portableActions, /function normalizePortableDeskStaffRow/);
  assert.match(portableActions, /avatar_url: normalizePortableDeskStaffAvatarUrl\(payload\)/);
  assert.match(portableActions, /staff: normalizePortableDeskStaffRows\(payload\.staff\)/);
});

test("settings surfaces project existing service and availability domains", () => {
  assert.match(servicesService, /from\("staff_service_assignments"\)/);
  assert.match(servicesService, /getStaffPresentationsByStaffId/);
  assert.match(bookingSetupService, /from\("staff_availability_rules"\)/);
  assert.match(bookingSetupService, /from\("staff_service_assignments"\)/);
  assert.match(
    bookingSetupService,
    /const staffRules = rules\.filter\(\(rule\) => rule\.staff_id === input\.staffId\)/,
  );
  assert.match(
    bookingSetupService,
    /staffRules\.length > 0[\s\S]*rules\.filter\(\(rule\) => !rule\.staff_id\)/,
  );
  assert.match(bookingSetupService, /staff_profile_avatar_url/);
  assert.match(bookingSetupService, /staff_profile_display_name/);
});

test("Staff Profile mutations remain server-authorized and salon-scoped", () => {
  assert.match(staffService, /hasPermission\(STAFF_PERMISSIONS\.manage, context\)/);
  assert.match(staffService, /resolveStaffAccountForSalon\(\{ context, supabase \}\)/);
  assert.match(staffService, /canEditSelf/);
  assert.match(staffService, /\.eq\("salon_id", context\.currentSalon\.id\)/);
  assert.match(staffService, /verifyStaffAvatarPath/);
  assert.match(staffService, /isSalonProfileMediaPathForSalon/);
  assert.match(staffService, /SALON_PROFILE_MEDIA_BUCKET/);
  assert.match(staffActions, /revalidatePath\("\/staff"\)/);
  assert.match(staffActions, /revalidatePath\("\/staff\/my-work"\)/);
  assert.match(staffActions, /revalidatePath\("\/salon-settings"\)/);
  assert.match(staffActions, /revalidatePath\("\/salon-profile"\)/);
  assert.match(staffActions, /revalidatePath\("\/services"\)/);
  assert.match(staffActions, /revalidatePath\("\/booking-setup"\)/);
  assert.match(staffActions, /revalidatePath\("\/bookings"\)/);
  assert.match(staffActions, /revalidatePath\("\/staff\/appointments"\)/);
  assert.match(staffActions, /revalidatePath\("\/pos"\)/);
  assert.match(staffActions, /revalidatePath\("\/pos\/portable"\)/);
  assert.match(staffActions, /revalidatePath\("\/pos\/portable\/check-in"\)/);
  assert.match(staffActions, /revalidatePath\("\/payroll"\)/);
  assert.match(staffActions, /revalidatePath\(`\/book\/\$\{context\.currentSalon\.id\}`\)/);
  assert.match(staffActions, /revalidatePath\(getSalonProfileHref\(context\.currentSalon\.id\)\)/);
  assert.match(staffProfileEditor, /useRouter/);
  assert.match(staffProfileEditor, /router\.refresh\(\)/);

  const publicProfileMutation = staffService.slice(
    staffService.indexOf("export async function updateStaffPublicProfile"),
  );

  assert.match(publicProfileMutation, /job_title: canManageStaff/);
  assert.doesNotMatch(publicProfileMutation, /public_profile_visible:/);
  assert.doesNotMatch(publicProfileMutation, /staff_public_consent_status:/);
  assert.doesNotMatch(publicProfileMutation, /online_booking_enabled:/);
  assert.doesNotMatch(publicProfileMutation, /owner_public_enabled:/);
  assert.doesNotMatch(publicProfileMutation, /staff_service_assignments/);
  assert.doesNotMatch(staffProfileEditor, /appear_publicly|Appear in booking/);
  assert.doesNotMatch(
    staffProfileEditor,
    /ownerPublicEnabled|publicProfileVisible|staffPublicConsentStatus/,
  );
});

test("owner settings expose only the simple online booking and posting controls", () => {
  assert.match(publicTeamSettingsEditor, /Online booking/);
  assert.match(publicTeamSettingsEditor, /Allow Salon Profile posting/);
  assert.match(publicTeamSettingsEditor, /Turn online booking on for all active/);
  assert.match(publicTeamSettingsEditor, /onlineBookingEnabled: true/);
  assert.doesNotMatch(publicTeamSettingsEditor, /Show on Salon Profile/);
  assert.doesNotMatch(publicTeamSettingsEditor, /Direct booking/);
  assert.doesNotMatch(
    publicTeamSettingsEditor,
    /ownerPublicEnabled|staffPublicConsentStatus/,
  );
  assert.doesNotMatch(publicTeamSettingsAction, /owner_public_enabled/);
  assert.doesNotMatch(publicTeamSettingsAction, /staff_public_consent_status/);
});

test("Staff Profile drawers close immediately on the client before URL refresh", () => {
  for (const source of [staffMyWorkDrawer, staffSlideOver]) {
    assert.match(source, /"use client"/);
    assert.match(source, /setOpen\(false\)/);
    assert.match(source, /router\.replace\(closeHref, \{ scroll: false \}\)/);
    assert.match(source, /<button[\s\S]*className="absolute inset-0/);
    assert.doesNotMatch(source, /<Link[\s\S]*className="absolute inset-0/);
  }
});

test("public profile visibility is derived from online booking or posting", () => {
  const publicTeamRpc = latestMigrationFunctionBlock("update_staff_public_team_batch");

  assert.match(staffService, /function shouldShowStaffProfileOnline/);
  assert.match(
    staffService,
    /input\.onlineBookingEnabled \|\| input\.salonProfileContentPostingEnabled/,
  );
  assert.match(publicTeamRpc, /owner_public_enabled =/);
  assert.match(publicTeamRpc, /public_profile_visible =/);
  assert.match(publicTeamRpc, /staff_public_consent_status =/);
  assert.match(
    publicTeamRpc,
    /next_values\.online_booking_enabled[\s\S]*or next_values\.salon_profile_content_posting_enabled/,
  );
  assert.match(migration, /update public\.staff[\s\S]*public_profile_visible/);
});

test("payroll legal identity stays private while using Staff Profile recognition", () => {
  assert.match(payrollService, /STAFF_PAYROLL_SETTING_SELECT =[\s\S]*legal_name/);
  assert.match(payrollService, /staff_legal_name_snapshot: getLegalName/);
  assert.match(payrollService, /getStaffPresentationsByStaffId/);
  assert.match(payrollTypes, /staffProfileAvatarUrl: string \| null/);
  assert.match(payrollTypes, /staffProfileDisplayName: string/);
  assert.doesNotMatch(migration, /legal_name|commission|tax|staff_payroll_settings/i);
});

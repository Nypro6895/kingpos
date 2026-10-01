import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("beauty customer relationship resolver enforces salon-customer authorization", () => {
  const migration = read(
    "supabase/migrations/202608140004_beauty_customer_profile_state.sql",
  );
  const service = read("lib/beauty-relationship.ts");

  assert.match(
    migration,
    /create or replace function public\.resolve_beauty_profile_for_salon_customer\(\s*p_salon_id uuid,\s*p_customer_id uuid\s*\)/,
  );
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = public/);
  assert.match(
    migration,
    /public\.user_has_salon_permission\(p_salon_id, array\['customers\.view'\]::text\[\]\)/,
  );
  assert.match(
    migration,
    /where id = p_customer_id\s+and location_id = p_salon_id/,
  );
  assert.match(
    migration,
    /where profiles\.user_id = customer_row\.customer_user_id/,
  );
  assert.match(migration, /'state', 'unlinked'/);
  assert.match(migration, /'state', 'profile_not_created'/);
  assert.match(migration, /profile_state := case/);
  assert.match(
    migration,
    /case when profile_state = 'public' then profile_record\.bio else null end/,
  );
  assert.match(
    migration,
    /if profile_row\.visibility <> 'public' then\s+return jsonb_build_object\('ok', false, 'code', 'private_profile', 'state', 'private'/,
  );
  assert.match(
    migration,
    /grant execute on function public\.resolve_beauty_profile_for_salon_customer\(uuid, uuid\) to authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /create policy[\s\S]*salon owners can select all beauty_profiles/i,
  );
  assert.doesNotMatch(migration, /p_user_id uuid/);

  assert.match(service, /resolveBeautyProfileForSalonCustomer/);
  assert.match(service, /BeautyProfileRelationshipState/);
  assert.match(service, /normalizeRelationshipState/);
  assert.match(service, /profile_not_created/);
  assert.match(service, /state === "private"/);
  assert.match(service, /hasPermission\("customers\.view", context\)/);
  assert.match(service, /"resolve_beauty_profile_for_salon_customer"/);
  assert.match(service, /p_customer_id: customerId/);
  assert.match(service, /p_salon_id: context\.currentSalon\.id/);
  assert.match(service, /relationshipResult\.profile\.id === profileId/);
  assert.match(service, /relationshipResolverUnavailable/);
  assert.doesNotMatch(
    service,
    /console\.error\("Supabase resolve salon customer Beauty profile failed"/,
  );
});

test("customer detail and booking workspace separate CRM customer from Beauty profile", () => {
  const customerDetail = read("app/customers/[customerId]/page.tsx");
  const bookings = read("lib/bookings.ts");
  const bookingClient = read("app/bookings/booking-workspace-client.tsx");

  assert.match(customerDetail, /Section title="ReyLUMI Profile"/);
  assert.match(customerDetail, /View Beauty Profile/);
  assert.match(customerDetail, /No ReyLUMI profile linked/);
  assert.match(customerDetail, /Beauty profile is not available yet/);
  assert.match(customerDetail, /Beauty profile is private/);
  assert.match(customerDetail, /Beauty profile could not be checked/);
  assert.match(customerDetail, /resolveBeautyProfileForSalonCustomer/);

  assert.match(bookings, /beautyProfile: ResolvedBeautyProfile \| null/);
  assert.match(bookings, /resolveBeautyProfilesForSalonCustomers/);
  assert.match(bookingClient, /Customer details/);
  assert.match(bookingClient, /href=\{beautyProfileHref\}/);
  assert.doesNotMatch(bookingClient, />\s*Beauty profile\s*<\/a>/);
  assert.match(bookingClient, /public_profile: "Salon profile booking"/);
  assert.doesNotMatch(
    bookingClient,
    /<a className="booking-profile-link" href=\{customerProfileHref\}>\s*\{sourceLabel\(booking\.source\)\}\s*<\/a>/,
  );
});

test("relationship state model covers privacy, missing profiles, and tampered URLs", () => {
  const migration = read(
    "supabase/migrations/202608140004_beauty_customer_profile_state.sql",
  );
  const service = read("lib/beauty-relationship.ts");
  const route = read("app/explore/beauty/[profileId]/page.tsx");

  assert.match(migration, /'state', 'public'/);
  assert.match(migration, /'state', 'private'/);
  assert.match(migration, /'state', 'profile_not_created'/);
  assert.match(migration, /'state', 'unlinked'/);
  assert.match(migration, /'state', 'forbidden'/);
  assert.match(
    migration,
    /where id = p_customer_id\s+and location_id = p_salon_id/,
  );
  assert.match(service, /input\.state === "private" && input\.customerId/);
  assert.match(service, /relationshipResult\.profile\.id === profileId/);
  assert.match(service, /relationshipResult\.state === "private"/);
  assert.match(service, /relationshipPublicProfile/);
  assert.match(route, /page\.access === "private_relationship"/);
  assert.doesNotMatch(route, /page\.timeline/);
});

test("Beauty visibility and profile route preserve privacy semantics", () => {
  const actions = read("app/beauty/actions.ts");
  const client = read("app/beauty/beauty-profile-client.tsx");
  const route = read("app/explore/beauty/[profileId]/page.tsx");

  assert.match(actions, /visibility\?: BeautyProfileVisibility/);
  assert.doesNotMatch(actions, /visibility: "public"/);
  assert.match(actions, /revalidatePath\(`\/explore\/beauty\/\$\{result\.data\.id\}`\)/);
  assert.match(client, /Profile visibility/);
  assert.match(client, /Private hides you from discovery/);
  assert.match(client, /Salons can only see that it is private/);
  assert.match(client, /setProfileDraftVisibility/);
  assert.match(route, /getBeautyProfileRoutePage/);
  assert.match(route, /private_relationship/);
  assert.match(route, /This Beauty profile is private/);
  assert.doesNotMatch(route, /Visible through salon relationship/);
  assert.match(route, /Customer details/);
});

test("personal My Book links booking detail to public salon profile", () => {
  const detailPage = read("app/my-bookings/[bookingId]/page.tsx");
  const detailActions = read("app/my-bookings/[bookingId]/booking-detail-actions.tsx");

  assert.match(detailPage, /salonProfileHref/);
  assert.match(detailPage, /\/explore\/salons\/\$\{booking\.salon_id\}/);
  assert.match(detailActions, /canViewSalon \? \(/);
  assert.match(detailActions, /href=\{`\/explore\/salons\/\$\{booking\.salon_id\}`\}/);
});

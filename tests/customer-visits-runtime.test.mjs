import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";

const ACCOUNT_ID = "51000000-0000-4000-8000-000000000001";
const OTHER_ACCOUNT_ID = "51000000-0000-4000-8000-000000000002";
const SALON_ID = "51000000-0000-4000-8000-000000000011";
const OTHER_SALON_ID = "51000000-0000-4000-8000-000000000012";
const STAFF_ID = "51000000-0000-4000-8000-000000000021";
const SERVICE_ID = "51000000-0000-4000-8000-000000000031";
const SERVICE_TWO_ID = "51000000-0000-4000-8000-000000000032";
const OTHER_SERVICE_ID = "51000000-0000-4000-8000-000000000033";
const PUBLIC_USER_ID = "51000000-0000-4000-8000-000000000041";
const AUTH_USER_ID = "51000000-0000-4000-8000-000000000042";
const WORKDAY_ID = "51000000-0000-4000-8000-000000000051";
const TOKEN_IDLE = "codex-runtime-visit-idle";
const TOKEN_CHECKOUT = "codex-runtime-visit-checkout";
const TOKEN_SELECT = "codex-runtime-visit-select";
const DRAFT_IDLE_ID = "51000000-0000-4000-8000-000000000061";
const DRAFT_CHECKOUT_ID = "51000000-0000-4000-8000-000000000062";
const DRAFT_SELECT_ID = "51000000-0000-4000-8000-000000000063";
const APPOINTMENT_ID = "51000000-0000-4000-8000-000000000071";
const APPOINTMENT_LINE_ID = "51000000-0000-4000-8000-000000000072";
const AMBIGUOUS_BOOKING_ONE_ID = "51000000-0000-4000-8000-000000000073";
const AMBIGUOUS_BOOKING_TWO_ID = "51000000-0000-4000-8000-000000000074";
const COMPLETE_TICKET_ID = "51000000-0000-4000-8000-000000000081";

const CUSTOMER_IDS = {
  ambiguous: "51000000-0000-4000-8000-000000000101",
  appointment: "51000000-0000-4000-8000-000000000102",
  cancel: "51000000-0000-4000-8000-000000000103",
  checkoutNoPrior: "51000000-0000-4000-8000-000000000104",
  duplicateIdentity: "51000000-0000-4000-8000-000000000111",
  existing: "51000000-0000-4000-8000-000000000105",
  otherSalon: "51000000-0000-4000-8000-000000000106",
  race: "51000000-0000-4000-8000-000000000107",
  select: "51000000-0000-4000-8000-000000000108",
  sameNameOne: "51000000-0000-4000-8000-000000000112",
  sameNameTwo: "51000000-0000-4000-8000-000000000113",
  waitingCheckout: "51000000-0000-4000-8000-000000000109",
  walkIn: "51000000-0000-4000-8000-000000000110",
};

const PHONES = {
  ambiguous: "5550101010",
  appointment: "5550101003",
  cancel: "5550101006",
  checkoutNoPrior: "5550101004",
  crossSalon: "5550109999",
  existing: "5550101001",
  race: "5550101008",
  sameNameOne: "5550101012",
  sameNameTwo: "5550101013",
  select: "5550101007",
  unknown: "5550101111",
  waitingCheckout: "5550101005",
  walkIn: "5550101002",
};

function readEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return separator >= 0
          ? [line.slice(0, separator), line.slice(separator + 1)]
          : [line, ""];
      }),
  );
}

function supabaseCommand() {
  const npmCommand = process.env.APPDATA
    ? `${process.env.APPDATA}\\npm\\supabase.cmd`
    : null;

  return npmCommand && existsSync(npmCommand) ? npmCommand : "supabase";
}

function runLinkedDatabaseQuery(sql) {
  const tempDir = mkdtempSync(join(tmpdir(), "kingpos-customer-visits-"));
  const sqlPath = join(tempDir, "query.sql");
  const command = supabaseCommand();

  writeFileSync(sqlPath, sql, "utf8");

  const result =
    process.platform === "win32"
      ? spawnSync(`"${command}" db query --linked --file "${sqlPath}"`, {
          encoding: "utf8",
          env: {
            ...process.env,
            SUPABASE_TELEMETRY_DISABLED: "1",
          },
          maxBuffer: 30 * 1024 * 1024,
          shell: true,
        })
      : spawnSync(command, ["db", "query", "--linked", "--file", sqlPath], {
          encoding: "utf8",
          env: {
            ...process.env,
            SUPABASE_TELEMETRY_DISABLED: "1",
          },
          maxBuffer: 30 * 1024 * 1024,
        });

  rmSync(tempDir, { force: true, recursive: true });

  return result;
}

function parseQueryRows(output) {
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");

  assert.ok(jsonStart >= 0 && jsonEnd > jsonStart, "Expected JSON query output.");

  return JSON.parse(output.slice(jsonStart, jsonEnd + 1)).rows ?? [];
}

function queryLinkedDatabase(sql) {
  const result = runLinkedDatabaseQuery(sql);

  assert.equal(
    result.status,
    0,
    `supabase db query failed: ${
      result.error?.message ?? `${result.stdout}\n${result.stderr}`
    }`,
  );

  return parseQueryRows(result.stdout.trim());
}

function expectLinkedDatabaseError(sql, pattern) {
  const result = runLinkedDatabaseQuery(sql);
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, "Expected linked database query to fail.");
  assert.match(output, pattern);
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

function activeVisitRows(customerId) {
  return queryLinkedDatabase(`
    select id, appointment_id, customer_id, source, status, ticket_id
    from public.customer_visits
    where salon_id = ${sqlUuid(SALON_ID)}
      and customer_id = ${sqlUuid(customerId)}
      and status in ('waiting', 'in_service', 'checkout')
    order by checked_in_at, id;
  `);
}

function activeVisitRowsByPhone(phone) {
  return queryLinkedDatabase(`
    select visits.id, visits.appointment_id, visits.customer_id, visits.source, visits.status, visits.ticket_id
    from public.customer_visits visits
    join public.customers customers
      on customers.id = visits.customer_id
     and customers.location_id = visits.salon_id
    where visits.salon_id = ${sqlUuid(SALON_ID)}
      and public.normalize_customer_claim_phone(customers.phone) = public.normalize_customer_claim_phone(${sqlString(phone)})
      and visits.status in ('waiting', 'in_service', 'checkout')
    order by visits.checked_in_at, visits.id;
  `);
}

function getStaffWorkday() {
  return queryLinkedDatabase(`
    select queue_turn_count
    from public.staff_workdays
    where id = ${sqlUuid(WORKDAY_ID)};
  `)[0];
}

function authenticatedJsonExpression(expression) {
  const rows = queryLinkedDatabase(`
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub = ${sqlString(AUTH_USER_ID)};
    select ${expression} as result;
    commit;
  `);

  return rows[0]?.result;
}

function authenticatedQueue(salonId = SALON_ID) {
  const rows = queryLinkedDatabase(`
    begin;
    set local role authenticated;
    set local request.jwt.claim.sub = ${sqlString(AUTH_USER_ID)};
    select coalesce(jsonb_agg(to_jsonb(queue_row) order by queue_row.checked_in_at, queue_row.id), '[]'::jsonb) as queue
    from public.get_customer_visit_queue(${sqlUuid(salonId)}, 100) queue_row;
    commit;
  `);

  return rows[0]?.queue ?? [];
}

function setupFixture() {
  queryLinkedDatabase(`
    insert into public.accounts (id, name, status)
    values
      (${sqlUuid(ACCOUNT_ID)}, 'Codex Runtime Visit Account', 'active'),
      (${sqlUuid(OTHER_ACCOUNT_ID)}, 'Codex Runtime Other Account', 'active');

    select public.seed_default_roles_for_account(${sqlUuid(ACCOUNT_ID)});
    select public.seed_default_roles_for_account(${sqlUuid(OTHER_ACCOUNT_ID)});

    insert into public.locations (id, account_id, name, status, country)
    values
      (${sqlUuid(SALON_ID)}, ${sqlUuid(ACCOUNT_ID)}, 'Codex Runtime Visit Salon', 'active', 'US'),
      (${sqlUuid(OTHER_SALON_ID)}, ${sqlUuid(OTHER_ACCOUNT_ID)}, 'Codex Runtime Other Salon', 'active', 'US');

    insert into public.users (id, auth_user_id, email, display_name, status)
    values (
      ${sqlUuid(PUBLIC_USER_ID)},
      ${sqlUuid(AUTH_USER_ID)},
      'codex-runtime-visit@example.test',
      'Codex Runtime Owner',
      'active'
    );

    insert into public.account_memberships (account_id, user_id, role_id, status, joined_at)
    select ${sqlUuid(ACCOUNT_ID)}, ${sqlUuid(PUBLIC_USER_ID)}, roles.id, 'active', now()
    from public.roles
    where roles.account_id = ${sqlUuid(ACCOUNT_ID)}
      and roles.code = 'OWNER';

    insert into public.salon_memberships (account_id, salon_id, user_id, role_id, status, joined_at)
    select ${sqlUuid(ACCOUNT_ID)}, ${sqlUuid(SALON_ID)}, ${sqlUuid(PUBLIC_USER_ID)}, roles.id, 'active', now()
    from public.roles
    where roles.account_id = ${sqlUuid(ACCOUNT_ID)}
      and roles.code = 'OWNER';

    insert into public.staff (
      id,
      salon_id,
      account_user_id,
      display_name,
      first_name,
      last_name,
      job_title,
      is_active,
      pos_enabled
    )
    values (
      ${sqlUuid(STAFF_ID)},
      ${sqlUuid(SALON_ID)},
      ${sqlUuid(PUBLIC_USER_ID)},
      'Runtime Nailtech',
      'Runtime',
      'Nailtech',
      'Nail tech',
      true,
      true
    );

    insert into public.services (
      id,
      salon_id,
      name,
      category,
      base_price,
      duration_minutes,
      is_active
    )
    values
      (
        ${sqlUuid(SERVICE_ID)},
        ${sqlUuid(SALON_ID)},
        'Runtime Manicure',
        'Nails',
        45,
        30,
        true
      ),
      (
        ${sqlUuid(SERVICE_TWO_ID)},
        ${sqlUuid(SALON_ID)},
        'Runtime Pedicure',
        'Nails',
        55,
        45,
        true
      ),
      (
        ${sqlUuid(OTHER_SERVICE_ID)},
        ${sqlUuid(OTHER_SALON_ID)},
        'Other Salon Service',
        'Other',
        99,
        60,
        true
      );

    insert into public.staff_workdays (
      id,
      salon_id,
      staff_id,
      work_date,
      status,
      check_in_at,
      queue_turn_count
    )
    values (
      ${sqlUuid(WORKDAY_ID)},
      ${sqlUuid(SALON_ID)},
      ${sqlUuid(STAFF_ID)},
      public.get_salon_business_date(${sqlUuid(SALON_ID)}),
      'working',
      now(),
      0
    );

    insert into public.customers (id, location_id, name, phone, status, source)
    values
      (${sqlUuid(CUSTOMER_IDS.ambiguous)}, ${sqlUuid(SALON_ID)}, 'Runtime Ambiguous', ${sqlString(PHONES.ambiguous)}, 'active', 'manual'),
      (${sqlUuid(CUSTOMER_IDS.appointment)}, ${sqlUuid(SALON_ID)}, 'Runtime Appointment', ${sqlString(PHONES.appointment)}, 'active', 'manual'),
      (${sqlUuid(CUSTOMER_IDS.cancel)}, ${sqlUuid(SALON_ID)}, 'Runtime Cancel', ${sqlString(PHONES.cancel)}, 'active', 'manual'),
      (${sqlUuid(CUSTOMER_IDS.checkoutNoPrior)}, ${sqlUuid(SALON_ID)}, 'Runtime Checkout', ${sqlString(PHONES.checkoutNoPrior)}, 'active', 'manual'),
      (${sqlUuid(CUSTOMER_IDS.existing)}, ${sqlUuid(SALON_ID)}, 'Runtime Existing', ${sqlString(PHONES.existing)}, 'active', 'manual'),
      (${sqlUuid(CUSTOMER_IDS.race)}, ${sqlUuid(SALON_ID)}, 'Runtime Race', ${sqlString(PHONES.race)}, 'active', 'manual'),
      (${sqlUuid(CUSTOMER_IDS.select)}, ${sqlUuid(SALON_ID)}, 'Runtime Select', ${sqlString(PHONES.select)}, 'active', 'manual'),
      (${sqlUuid(CUSTOMER_IDS.waitingCheckout)}, ${sqlUuid(SALON_ID)}, 'Runtime Waiting Checkout', ${sqlString(PHONES.waitingCheckout)}, 'active', 'manual'),
      (${sqlUuid(CUSTOMER_IDS.walkIn)}, ${sqlUuid(SALON_ID)}, 'Runtime Walk In', ${sqlString(PHONES.walkIn)}, 'active', 'manual'),
      (${sqlUuid(CUSTOMER_IDS.otherSalon)}, ${sqlUuid(OTHER_SALON_ID)}, 'Runtime Other Salon', ${sqlString(PHONES.crossSalon)}, 'active', 'manual');

    insert into public.pos_settings (salon_id, tip_suggestions, customer_promo_title, customer_promo_body)
    values (
      ${sqlUuid(SALON_ID)},
      array[15, 18, 20, 25]::numeric(12,2)[],
      'Runtime Salon',
      'Runtime visit fixture'
    );

    insert into public.pos_live_drafts (
      id,
      salon_id,
      token,
      staff_lines,
      subtotal,
      discount,
      tax,
      tip,
      total_before_tip,
      total,
      status,
      customer_handoff_started_at
    )
    values
      (${sqlUuid(DRAFT_IDLE_ID)}, ${sqlUuid(SALON_ID)}, ${sqlString(TOKEN_IDLE)}, '[]'::jsonb, 0, 0, 0, 0, 0, 0, 'draft', null),
      (${sqlUuid(DRAFT_CHECKOUT_ID)}, ${sqlUuid(SALON_ID)}, ${sqlString(TOKEN_CHECKOUT)}, '[]'::jsonb, 0, 0, 0, 0, 0, 0, 'draft', null),
      (${sqlUuid(DRAFT_SELECT_ID)}, ${sqlUuid(SALON_ID)}, ${sqlString(TOKEN_SELECT)}, '[]'::jsonb, 0, 0, 0, 0, 0, 0, 'draft', null);

    insert into public.bookings (
      id,
      salon_id,
      customer_id,
      staff_id,
      start_at,
      end_at,
      status,
      source,
      confirmation_status,
      salon_timezone_snapshot
    )
    values (
      ${sqlUuid(APPOINTMENT_ID)},
      ${sqlUuid(SALON_ID)},
      ${sqlUuid(CUSTOMER_IDS.appointment)},
      ${sqlUuid(STAFF_ID)},
      (public.get_salon_business_date(${sqlUuid(SALON_ID)})::text || ' 10:00:00')::timestamp at time zone 'America/Chicago',
      (public.get_salon_business_date(${sqlUuid(SALON_ID)})::text || ' 10:30:00')::timestamp at time zone 'America/Chicago',
      'confirmed',
      'owner_manual',
      'confirmed',
      'America/Chicago'
    );

    insert into public.booking_lines (
      id,
      salon_id,
      booking_id,
      service_id,
      service_name_snapshot,
      service_category_snapshot,
      unit_price,
      quantity,
      line_total,
      duration_minutes,
      assigned_staff_id,
      scheduled_start_at,
      scheduled_end_at,
      line_status
    )
    values (
      ${sqlUuid(APPOINTMENT_LINE_ID)},
      ${sqlUuid(SALON_ID)},
      ${sqlUuid(APPOINTMENT_ID)},
      ${sqlUuid(SERVICE_ID)},
      'Runtime Manicure',
      'Nails',
      45,
      1,
      45,
      30,
      ${sqlUuid(STAFF_ID)},
      (public.get_salon_business_date(${sqlUuid(SALON_ID)})::text || ' 10:00:00')::timestamp at time zone 'America/Chicago',
      (public.get_salon_business_date(${sqlUuid(SALON_ID)})::text || ' 10:30:00')::timestamp at time zone 'America/Chicago',
      'scheduled'
    );

    insert into public.bookings (
      id,
      salon_id,
      customer_id,
      staff_id,
      start_at,
      end_at,
      status,
      source,
      confirmation_status,
      salon_timezone_snapshot
    )
    values
      (
        ${sqlUuid(AMBIGUOUS_BOOKING_ONE_ID)},
        ${sqlUuid(SALON_ID)},
        ${sqlUuid(CUSTOMER_IDS.ambiguous)},
        ${sqlUuid(STAFF_ID)},
        (public.get_salon_business_date(${sqlUuid(SALON_ID)})::text || ' 11:00:00')::timestamp at time zone 'America/Chicago',
        (public.get_salon_business_date(${sqlUuid(SALON_ID)})::text || ' 11:30:00')::timestamp at time zone 'America/Chicago',
        'confirmed',
        'owner_manual',
        'confirmed',
        'America/Chicago'
      ),
      (
        ${sqlUuid(AMBIGUOUS_BOOKING_TWO_ID)},
        ${sqlUuid(SALON_ID)},
        ${sqlUuid(CUSTOMER_IDS.ambiguous)},
        ${sqlUuid(STAFF_ID)},
        (public.get_salon_business_date(${sqlUuid(SALON_ID)})::text || ' 12:00:00')::timestamp at time zone 'America/Chicago',
        (public.get_salon_business_date(${sqlUuid(SALON_ID)})::text || ' 12:30:00')::timestamp at time zone 'America/Chicago',
        'confirmed',
        'owner_manual',
        'confirmed',
        'America/Chicago'
      );
  `);
}

function cleanupFixture() {
  queryLinkedDatabase(`
    delete from public.customer_visits
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.booking_status_events
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.booking_lines
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.bookings
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.pos_ticket_audit_logs
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.pos_payments
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.pos_ticket_item_turn_parts
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.pos_ticket_items
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.pos_tickets
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.staff_workdays
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.customers
    where location_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.pos_live_drafts
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.pos_settings
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.services
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.staff
    where salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.salon_memberships
    where account_id in (${sqlUuid(ACCOUNT_ID)}, ${sqlUuid(OTHER_ACCOUNT_ID)})
       or salon_id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)})
       or user_id = ${sqlUuid(PUBLIC_USER_ID)};

    delete from public.account_memberships
    where account_id in (${sqlUuid(ACCOUNT_ID)}, ${sqlUuid(OTHER_ACCOUNT_ID)})
       or user_id = ${sqlUuid(PUBLIC_USER_ID)};

    delete from public.roles
    where account_id in (${sqlUuid(ACCOUNT_ID)}, ${sqlUuid(OTHER_ACCOUNT_ID)});

    delete from public.locations
    where id in (${sqlUuid(SALON_ID)}, ${sqlUuid(OTHER_SALON_ID)});

    delete from public.accounts
    where id in (${sqlUuid(ACCOUNT_ID)}, ${sqlUuid(OTHER_ACCOUNT_ID)});

    delete from public.users
    where id = ${sqlUuid(PUBLIC_USER_ID)}
       or auth_user_id = ${sqlUuid(AUTH_USER_ID)};
  `);
}

function markCheckoutHandoff() {
  queryLinkedDatabase(`
    update public.pos_live_drafts
    set
      customer = null,
      customer_handoff_started_at = now(),
      last_customer_action_id = null,
      selected_staff_id = ${sqlString(STAFF_ID)},
      staff_lines = jsonb_build_array(
        jsonb_build_object(
          'id', 'runtime-line-1',
          'label', 'Runtime Manicure',
          'amount', 60,
          'amountInput', '60',
          'amountParts', jsonb_build_array(60),
          'serviceId', ${sqlString(SERVICE_ID)},
          'sortOrder', 1,
          'staffId', ${sqlString(STAFF_ID)},
          'staffName', 'Runtime Nailtech'
        )
      ),
      subtotal = 60,
      discount = 0,
      tax = 0,
      tip = 0,
      total_before_tip = 60,
      total = 60,
      status = 'draft',
      receipt_version = receipt_version + 1,
      version = version + 1
    where id = ${sqlUuid(DRAFT_CHECKOUT_ID)};
  `);
}

function insertClosedTicket(customerId) {
  queryLinkedDatabase(`
    insert into public.pos_tickets (
      id,
      salon_id,
      ticket_number,
      ticket_sequence,
      customer_id,
      opened_at,
      closed_at,
      status
    )
    values (
      ${sqlUuid(COMPLETE_TICKET_ID)},
      ${sqlUuid(SALON_ID)},
      'CV-RT-1',
      1,
      ${sqlUuid(customerId)},
      now(),
      now(),
      'closed'
    );
  `);
}

function assertSortedByCheckIn(queue) {
  const ordered = [...queue].sort((left, right) => {
    const byTime = String(left.checked_in_at).localeCompare(String(right.checked_in_at));
    return byTime || String(left.id).localeCompare(String(right.id));
  });

  assert.deepEqual(
    queue.map((item) => item.id),
    ordered.map((item) => item.id),
    "Queue should be ordered oldest checked-in first.",
  );
}

test("customer visit RPCs work against the linked runtime database", async () => {
  const env = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required.");
  assert.ok(supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required.");

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const resolve = async ({ name = null, phone, requestId, token = TOKEN_IDLE }) => {
    const { data, error } = await supabase.rpc("resolve_customer_display_submission", {
      p_customer_name: name,
      p_phone: phone,
      p_request_id: requestId,
      p_token: token,
    });

    assert.equal(error, null, error?.message);
    return data;
  };

  cleanupFixture();
  setupFixture();

  try {
    const firstExisting = await resolve({
      phone: PHONES.existing,
      requestId: "existing-1",
    });

    assert.equal(firstExisting.ok, true);
    assert.equal(firstExisting.mode, "check_in");
    assert.equal(firstExisting.state, "checked_in");
    assert.equal("snapshot" in firstExisting, false);
    assert.equal(JSON.stringify(firstExisting).includes(PHONES.existing), false);

    const secondExisting = await resolve({
      phone: PHONES.existing,
      requestId: "existing-2",
    });

    assert.equal(secondExisting.ok, true);
    assert.equal(secondExisting.state, "already_checked_in");
    assert.equal(secondExisting.visit.id, firstExisting.visit.id);
    assert.equal(activeVisitRows(CUSTOMER_IDS.existing).length, 1);

    queryLinkedDatabase(`
      insert into public.customers (id, location_id, name, phone, email, status, source)
      values (
        ${sqlUuid(CUSTOMER_IDS.duplicateIdentity)},
        ${sqlUuid(SALON_ID)},
        'Runtime Existing Duplicate',
        ${sqlString(PHONES.existing)},
        'runtime-existing-duplicate@example.test',
        'active',
        'public_profile'
      );
    `);

    const duplicateIdentity = await resolve({
      phone: PHONES.existing,
      requestId: "existing-duplicate-customer",
    });

    assert.equal(duplicateIdentity.ok, true);
    assert.equal(duplicateIdentity.state, "already_checked_in");
    assert.equal(duplicateIdentity.visit.id, firstExisting.visit.id);
    assert.equal(activeVisitRowsByPhone(PHONES.existing).length, 1);

    const missingProfile = await resolve({
      phone: PHONES.unknown,
      requestId: "unknown-missing-profile",
    });

    assert.equal(missingProfile.ok, false);
    assert.equal(missingProfile.code, "profile_required");
    assert.equal(missingProfile.mode, "check_in");

    const unknownCreated = await resolve({
      name: "Runtime Unknown",
      phone: PHONES.unknown,
      requestId: "unknown-create",
    });

    assert.equal(unknownCreated.ok, true);
    assert.equal(unknownCreated.mode, "check_in");

    const unknownRows = queryLinkedDatabase(`
      select customers.id, customers.source, visits.status
      from public.customers
      join public.customer_visits visits
        on visits.customer_id = customers.id
       and visits.salon_id = customers.location_id
      where customers.location_id = ${sqlUuid(SALON_ID)}
        and public.normalize_customer_claim_phone(customers.phone) = public.normalize_customer_claim_phone(${sqlString(PHONES.unknown)});
    `);

    assert.equal(unknownRows.length, 1);
    assert.equal(unknownRows[0].source, "manual");
    assert.equal(unknownRows[0].status, "waiting");

    const appointment = await resolve({
      phone: PHONES.appointment,
      requestId: "appointment",
    });

    assert.equal(appointment.ok, true);
    assert.equal(appointment.visit.appointmentId, APPOINTMENT_ID);
    assert.equal(appointment.visit.source, "appointment");
    assert.deepEqual(
      appointment.visit.requestedServices.map((service) => service.id),
      [SERVICE_ID],
    );

    const appointmentRows = queryLinkedDatabase(`
      select bookings.status, count(events.id)::int as event_count
      from public.bookings
      left join public.booking_status_events events
        on events.booking_id = bookings.id
       and events.event_type = 'checked_in'
      where bookings.id = ${sqlUuid(APPOINTMENT_ID)}
      group by bookings.status;
    `);

    assert.equal(appointmentRows[0].status, "checked_in");
    assert.equal(appointmentRows[0].event_count, 1);

    const walkIn = await resolve({
      phone: PHONES.walkIn,
      requestId: "walk-in",
    });

    assert.equal(walkIn.ok, true);
    assert.equal(walkIn.visit.source, "customer_screen");
    assert.equal(walkIn.visit.appointmentId, null);

    const workdayBeforeRequestedServices = getStaffWorkday();
    const walkInServices = await supabase.rpc("update_customer_visit_requested_services", {
      p_service_ids: [SERVICE_ID, SERVICE_TWO_ID],
      p_token: TOKEN_IDLE,
      p_visit_id: walkIn.visit.id,
    });

    assert.equal(walkInServices.error, null, walkInServices.error?.message);
    assert.equal(walkInServices.data.ok, true);
    assert.deepEqual(
      walkInServices.data.visit.requestedServices.map((service) => service.id),
      [SERVICE_ID, SERVICE_TWO_ID],
    );
    assert.equal(
      getStaffWorkday().queue_turn_count,
      workdayBeforeRequestedServices.queue_turn_count,
    );

    const reusedWalkIn = await resolve({
      phone: PHONES.walkIn,
      requestId: "walk-in-reused-services",
    });

    assert.equal(reusedWalkIn.ok, true);
    assert.equal(reusedWalkIn.visit.id, walkIn.visit.id);
    assert.deepEqual(
      reusedWalkIn.visit.requestedServices.map((service) => service.id),
      [SERVICE_ID, SERVICE_TWO_ID],
    );

    const duplicateServices = await supabase.rpc("update_customer_visit_requested_services", {
      p_service_ids: [SERVICE_ID, SERVICE_ID],
      p_token: TOKEN_IDLE,
      p_visit_id: walkIn.visit.id,
    });

    assert.equal(duplicateServices.error, null, duplicateServices.error?.message);
    assert.equal(duplicateServices.data.ok, true);
    assert.deepEqual(
      duplicateServices.data.visit.requestedServices.map((service) => service.id),
      [SERVICE_ID],
    );

    const crossSalonService = await supabase.rpc("update_customer_visit_requested_services", {
      p_service_ids: [OTHER_SERVICE_ID],
      p_token: TOKEN_IDLE,
      p_visit_id: walkIn.visit.id,
    });

    assert.equal(crossSalonService.error, null, crossSalonService.error?.message);
    assert.equal(crossSalonService.data.ok, false);
    assert.equal(crossSalonService.data.code, "invalid_services");

    const restoredWalkInServices = await supabase.rpc(
      "update_customer_visit_requested_services",
      {
        p_service_ids: [SERVICE_ID, SERVICE_TWO_ID],
        p_token: TOKEN_IDLE,
        p_visit_id: walkIn.visit.id,
      },
    );

    assert.equal(
      restoredWalkInServices.error,
      null,
      restoredWalkInServices.error?.message,
    );
    assert.equal(restoredWalkInServices.data.ok, true);

    queryLinkedDatabase(`
      insert into public.customers (id, location_id, name, phone, status, source)
      values
        (${sqlUuid(CUSTOMER_IDS.sameNameOne)}, ${sqlUuid(SALON_ID)}, 'Runtime Same Name', ${sqlString(PHONES.sameNameOne)}, 'active', 'manual'),
        (${sqlUuid(CUSTOMER_IDS.sameNameTwo)}, ${sqlUuid(SALON_ID)}, 'Runtime Same Name', ${sqlString(PHONES.sameNameTwo)}, 'active', 'manual');
    `);

    const sameNameOne = await resolve({
      phone: PHONES.sameNameOne,
      requestId: "same-name-one",
    });
    const sameNameTwo = await resolve({
      phone: PHONES.sameNameTwo,
      requestId: "same-name-two",
    });

    assert.equal(sameNameOne.ok, true);
    assert.equal(sameNameTwo.ok, true);
    assert.notEqual(sameNameOne.visit.id, sameNameTwo.visit.id);
    assert.equal(activeVisitRowsByPhone(PHONES.sameNameOne).length, 1);
    assert.equal(activeVisitRowsByPhone(PHONES.sameNameTwo).length, 1);

    const ambiguous = await resolve({
      phone: PHONES.ambiguous,
      requestId: "ambiguous",
    });

    assert.equal(ambiguous.ok, false);
    assert.equal(ambiguous.code, "ambiguous_appointment");
    assert.equal(activeVisitRows(CUSTOMER_IDS.ambiguous).length, 0);

    const crossSalon = await resolve({
      phone: PHONES.crossSalon,
      requestId: "cross-salon",
    });

    assert.equal(crossSalon.ok, false);
    assert.equal(crossSalon.code, "profile_required");
    assert.equal(activeVisitRows(CUSTOMER_IDS.otherSalon).length, 0);

    markCheckoutHandoff();

    const checkoutNoPrior = await resolve({
      phone: PHONES.checkoutNoPrior,
      requestId: "checkout-no-prior",
      token: TOKEN_CHECKOUT,
    });

    assert.equal(checkoutNoPrior.ok, true);
    assert.equal(checkoutNoPrior.mode, "checkout");
    assert.equal(checkoutNoPrior.visit, null);
    assert.equal(checkoutNoPrior.snapshot.customer.id, CUSTOMER_IDS.checkoutNoPrior);
    assert.equal(checkoutNoPrior.snapshot.staff_lines.length, 1);
    assert.equal(activeVisitRows(CUSTOMER_IDS.checkoutNoPrior).length, 0);

    const waitingBeforeCheckout = await resolve({
      phone: PHONES.waitingCheckout,
      requestId: "waiting-before-checkout",
    });

    assert.equal(waitingBeforeCheckout.ok, true);
    assert.equal(waitingBeforeCheckout.visit.status, "waiting");

    markCheckoutHandoff();

    const waitingCheckout = await resolve({
      phone: PHONES.waitingCheckout,
      requestId: "waiting-checkout",
      token: TOKEN_CHECKOUT,
    });

    assert.equal(waitingCheckout.ok, true);
    assert.equal(waitingCheckout.mode, "checkout");
    assert.equal(waitingCheckout.visit.id, waitingBeforeCheckout.visit.id);
    assert.equal(waitingCheckout.visit.status, "checkout");
    assert.equal(waitingCheckout.snapshot.customer.visitId, waitingBeforeCheckout.visit.id);
    assert.equal(activeVisitRows(CUSTOMER_IDS.waitingCheckout).length, 1);

    const raceResults = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        resolve({
          phone: PHONES.race,
          requestId: `race-${index}`,
        }),
      ),
    );
    const raceVisitIds = new Set(
      raceResults
        .filter((result) => result.ok)
        .map((result) => result.visit.id),
    );

    assert.equal(raceResults.every((result) => result.ok), true);
    assert.equal(raceVisitIds.size, 1);
    assert.equal(activeVisitRows(CUSTOMER_IDS.race).length, 1);

    const selectVisit = await resolve({
      phone: PHONES.select,
      requestId: "select",
    });
    const selectVisitServices = await supabase.rpc(
      "update_customer_visit_requested_services",
      {
        p_service_ids: [SERVICE_ID, SERVICE_TWO_ID],
        p_token: TOKEN_IDLE,
        p_visit_id: selectVisit.visit.id,
      },
    );

    assert.equal(selectVisitServices.error, null, selectVisitServices.error?.message);
    assert.equal(selectVisitServices.data.ok, true);

    const workdayBeforeSelect = getStaffWorkday();
    const selectResult = authenticatedJsonExpression(
      `public.select_customer_visit_for_live_draft(${sqlUuid(selectVisit.visit.id)}, ${sqlString(TOKEN_SELECT)})`,
    );

    assert.equal(selectResult.ok, true);
    assert.equal(selectResult.snapshot.customer.id, CUSTOMER_IDS.select);
    assert.equal(selectResult.snapshot.customer.visitId, selectVisit.visit.id);
    assert.deepEqual(
      selectResult.snapshot.customer.requestedServices.map((service) => service.id),
      [SERVICE_ID, SERVICE_TWO_ID],
    );
    assert.deepEqual(selectResult.snapshot.staff_lines, []);
    assert.equal(Number(selectResult.snapshot.total), 0);
    assert.equal(getStaffWorkday().queue_turn_count, workdayBeforeSelect.queue_turn_count);

    const cancelVisit = await resolve({
      phone: PHONES.cancel,
      requestId: "cancel",
    });
    const cancelVisitServices = await supabase.rpc(
      "update_customer_visit_requested_services",
      {
        p_service_ids: [SERVICE_ID],
        p_token: TOKEN_IDLE,
        p_visit_id: cancelVisit.visit.id,
      },
    );

    assert.equal(cancelVisitServices.error, null, cancelVisitServices.error?.message);
    assert.equal(cancelVisitServices.data.ok, true);

    const cancelResult = authenticatedJsonExpression(
      `public.cancel_customer_visit(${sqlUuid(cancelVisit.visit.id)}, 'Runtime cancel')`,
    );

    assert.equal(cancelResult.ok, true);
    assert.equal(cancelResult.status, "cancelled");
    assert.equal(activeVisitRows(CUSTOMER_IDS.cancel).length, 0);

    const cancelledServiceRows = queryLinkedDatabase(`
      select count(*)::int as service_count
      from public.customer_visit_services
      where visit_id = ${sqlUuid(cancelVisit.visit.id)};
    `);

    assert.equal(cancelledServiceRows[0].service_count, 1);

    insertClosedTicket(CUSTOMER_IDS.appointment);

    const completeResult = authenticatedJsonExpression(
      `public.complete_customer_visit_for_ticket(${sqlUuid(SALON_ID)}, ${sqlUuid(CUSTOMER_IDS.appointment)}, ${sqlUuid(COMPLETE_TICKET_ID)}, ${sqlUuid(appointment.visit.id)})`,
    );

    assert.equal(completeResult.ok, true);
    assert.equal(completeResult.appointmentId, APPOINTMENT_ID);
    assert.equal(completeResult.status, "completed");
    assert.equal(completeResult.ticketId, COMPLETE_TICKET_ID);

    const completedRows = queryLinkedDatabase(`
      select visits.status, visits.ticket_id, bookings.pos_ticket_id
      from public.customer_visits visits
      join public.bookings bookings on bookings.id = visits.appointment_id
      where visits.id = ${sqlUuid(appointment.visit.id)};
    `);

    assert.equal(completedRows[0].status, "completed");
    assert.equal(completedRows[0].ticket_id, COMPLETE_TICKET_ID);
    assert.equal(completedRows[0].pos_ticket_id, COMPLETE_TICKET_ID);

    const completedServiceRows = queryLinkedDatabase(`
      select count(*)::int as service_count
      from public.customer_visit_services
      where visit_id = ${sqlUuid(appointment.visit.id)};
    `);

    assert.equal(completedServiceRows[0].service_count, 1);

    const queue = authenticatedQueue();
    const queueCountRows = queryLinkedDatabase(`
      begin;
      set local role authenticated;
      set local request.jwt.claim.sub = ${sqlString(AUTH_USER_ID)};
      select count(*)::int as row_count
      from public.get_customer_visit_queue(${sqlUuid(SALON_ID)}, 100);
      commit;
    `);
    const sameNameQueueRows = queue.filter(
      (item) => item.customer_name === "Runtime Same Name",
    );

    assertSortedByCheckIn(queue);
    assert.equal(queueCountRows[0].row_count, queue.length);
    assert.equal(sameNameQueueRows.length, 2);
    assert.deepEqual(
      new Set(sameNameQueueRows.map((item) => item.customer_id)),
      new Set([CUSTOMER_IDS.sameNameOne, CUSTOMER_IDS.sameNameTwo]),
    );
    assert.equal(queue.some((item) => item.id === cancelVisit.visit.id), false);
    assert.equal(queue.some((item) => item.id === appointment.visit.id), false);
    assert.equal(queue.every((item) => item.status === "waiting"), true);
    assert.ok(
      queue.some(
        (item) =>
          item.customer_id === CUSTOMER_IDS.walkIn &&
          item.source === "customer_screen",
      ),
      "Walk-in/customer-screen visit should be visible to Waiting/Today.",
    );
    const walkInQueueRow = queue.find(
      (item) => item.customer_id === CUSTOMER_IDS.walkIn,
    );

    assert.ok(walkInQueueRow, "Walk-in should be present in Waiting queue.");
    assert.equal(walkInQueueRow.service_label, "Runtime Manicure / Runtime Pedicure");
    assert.deepEqual(
      walkInQueueRow.requested_services.map((service) => service.id),
      [SERVICE_ID, SERVICE_TWO_ID],
    );
    assert.equal(getStaffWorkday().queue_turn_count, 0);

    const anonTableRead = await supabase
      .from("customer_visits")
      .select("id")
      .limit(1);

    assert.notEqual(anonTableRead.error, null);
    assert.match(anonTableRead.error.message, /permission denied|violates row-level security/i);

    const anonVisitServicesRead = await supabase
      .from("customer_visit_services")
      .select("id")
      .limit(1);

    assert.notEqual(anonVisitServicesRead.error, null);
    assert.match(
      anonVisitServicesRead.error.message,
      /permission denied|violates row-level security/i,
    );

    for (const [name, args] of [
      ["get_customer_visit_queue", { p_limit: 25, p_salon_id: SALON_ID }],
      ["select_customer_visit_for_live_draft", { p_token: TOKEN_SELECT, p_visit_id: selectVisit.visit.id }],
      ["cancel_customer_visit", { p_reason: "nope", p_visit_id: selectVisit.visit.id }],
      [
        "complete_customer_visit_for_ticket",
        {
          p_customer_id: CUSTOMER_IDS.select,
          p_preferred_visit_id: selectVisit.visit.id,
          p_salon_id: SALON_ID,
          p_ticket_id: COMPLETE_TICKET_ID,
        },
      ],
      [
        "create_or_reuse_customer_visit",
        {
          p_appointment_id: null,
          p_customer_id: CUSTOMER_IDS.select,
          p_origin_metadata: {},
          p_salon_id: SALON_ID,
          p_source: "customer_screen",
        },
      ],
    ]) {
      const { error } = await supabase.rpc(name, args);
      assert.notEqual(error, null, `${name} should be blocked for anon.`);
      assert.match(error.message, /permission denied|Could not find the function/i);
    }

    expectLinkedDatabaseError(
      `
        begin;
        set local role authenticated;
        set local request.jwt.claim.sub = ${sqlString(AUTH_USER_ID)};
        select count(*) from public.get_customer_visit_queue(${sqlUuid(OTHER_SALON_ID)}, 25);
        rollback;
      `,
      /Missing required permission/,
    );
  } finally {
    cleanupFixture();
  }
});

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const artifactsDir = path.resolve("artifacts/booking-browser-test");
const marker = "[E2E] Phase45 Browser 20260716203116";
const staffId = "705a6df0-0b09-4c33-a4ac-bd22631332e3";
const serviceIds = [
  "6e78a7a8-5068-4fcc-80c3-699c4e37a65e",
  "2566d503-e113-4ca9-b009-18d8c8d91178",
];

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start < 0 || end < start) {
    throw new Error(`Supabase CLI did not return JSON: ${text.slice(0, 200)}`);
  }

  return JSON.parse(text.slice(start, end + 1));
}

async function runSql(sql) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "kingpos-gatef-"));
  const filePath = path.join(dir, "query.sql");
  const supabaseArgs = [
    "db",
    "query",
    "--linked",
    "--output",
    "json",
    "--file",
    filePath,
  ];
  const command = process.platform === "win32" ? "cmd.exe" : "supabase";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "supabase.cmd", ...supabaseArgs]
      : supabaseArgs;

  await writeFile(filePath, sql);

  try {
    const { stdout } = await execFileAsync(command, args, {
      env: {
        ...process.env,
        SUPABASE_TELEMETRY_DISABLED: "1",
      },
      maxBuffer: 1024 * 1024 * 4,
    });
    return extractJson(stdout).rows ?? [];
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => {});
  }
}

const serviceIdList = serviceIds.map((id) => `${sqlLiteral(id)}::uuid`).join(", ");

const report = {
  activeTestBookingCount: null,
  exactIds: {
    services: serviceIds,
    staff: staffId,
  },
  finalStatuses: null,
  marker,
  ok: false,
  verified: null,
};

try {
  const verificationRows = await runSql(`
    with target_staff as (
      select
        id,
        display_name,
        is_active,
        online_booking_enabled,
        owner_public_enabled,
        public_profile_visible,
        organization_id,
        salon_id
      from public.staff
      where id = ${sqlLiteral(staffId)}::uuid
    ),
    target_services as (
      select
        id,
        name,
        is_active,
        organization_id,
        salon_id
      from public.services
      where id in (${serviceIdList})
    ),
    active_bookings as (
      select distinct bookings.id
      from public.bookings
      join public.booking_lines
        on booking_lines.booking_id = bookings.id
      where (
        booking_lines.assigned_staff_id = ${sqlLiteral(staffId)}::uuid
        or booking_lines.service_id in (${serviceIdList})
      )
      and bookings.status not in ('cancelled', 'no_show')
    )
    select jsonb_build_object(
      'staff', coalesce((select jsonb_agg(to_jsonb(target_staff)) from target_staff), '[]'::jsonb),
      'services', coalesce((select jsonb_agg(to_jsonb(target_services)) from target_services), '[]'::jsonb),
      'active_booking_count', (select count(*) from active_bookings),
      'assignment_count', (
        select count(*)
        from public.staff_service_assignments
        where staff_id = ${sqlLiteral(staffId)}::uuid
          or service_id in (${serviceIdList})
      ),
      'add_on_link_count', (
        select count(*)
        from public.service_add_on_links
        where parent_service_id in (${serviceIdList})
          or add_on_service_id in (${serviceIdList})
      )
    ) as payload;
  `);
  const verified = verificationRows[0]?.payload ?? {};
  const staffRows = verified.staff ?? [];
  const serviceRows = verified.services ?? [];
  const staffVerified =
    staffRows.length === 1 && staffRows[0].display_name?.includes(marker);
  const servicesVerified =
    serviceRows.length === serviceIds.length &&
    serviceRows.every((service) => service.name?.includes(marker));

  report.verified = {
    activeBookingCountBefore: verified.active_booking_count ?? null,
    addOnLinkCount: verified.add_on_link_count ?? null,
    assignmentCount: verified.assignment_count ?? null,
    servicesVerified,
    staffVerified,
  };

  if (!staffVerified || !servicesVerified) {
    throw new Error("Exact Gate F records were not verified as test-owned.");
  }

  const cleanupRows = await runSql(`
    with target_bookings as (
      select distinct bookings.id
      from public.bookings
      join public.booking_lines
        on booking_lines.booking_id = bookings.id
      where (
        booking_lines.assigned_staff_id = ${sqlLiteral(staffId)}::uuid
        or booking_lines.service_id in (${serviceIdList})
      )
      and bookings.status not in ('cancelled', 'no_show')
    ),
    cancelled as (
      update public.bookings
      set
        cancelled_at = coalesce(cancelled_at, now()),
        cancellation_reason = coalesce(cancellation_reason, 'Gate F exact E2E fixture cleanup'),
        confirmation_status = 'cancelled',
        status = 'cancelled',
        updated_at = now()
      where id in (select id from target_bookings)
      returning id, status, confirmation_status
    ),
    disabled_links as (
      update public.service_add_on_links
      set is_active = false, updated_at = now()
      where parent_service_id in (${serviceIdList})
         or add_on_service_id in (${serviceIdList})
      returning id, is_active
    ),
    disabled_assignments as (
      update public.staff_service_assignments
      set is_active = false, online_bookable = false, updated_at = now()
      where staff_id = ${sqlLiteral(staffId)}::uuid
         or service_id in (${serviceIdList})
      returning id, is_active, online_bookable
    ),
    disabled_services as (
      update public.services
      set is_active = false, updated_at = now()
      where id in (${serviceIdList})
        and name like ${sqlLiteral(`%${marker}%`)}
      returning id, name, is_active
    ),
    disabled_staff as (
      update public.staff
      set
        is_active = false,
        online_booking_enabled = false,
        owner_public_enabled = false,
        public_profile_visible = false,
        updated_at = now()
      where id = ${sqlLiteral(staffId)}::uuid
        and display_name like ${sqlLiteral(`%${marker}%`)}
      returning id, display_name, is_active, online_booking_enabled, owner_public_enabled, public_profile_visible
    ),
    remaining_active_bookings as (
      select distinct bookings.id
      from public.bookings
      join public.booking_lines
        on booking_lines.booking_id = bookings.id
      where (
        booking_lines.assigned_staff_id = ${sqlLiteral(staffId)}::uuid
        or booking_lines.service_id in (${serviceIdList})
      )
      and bookings.status not in ('cancelled', 'no_show')
    )
    select jsonb_build_object(
      'cancelled_bookings', coalesce((select jsonb_agg(to_jsonb(cancelled)) from cancelled), '[]'::jsonb),
      'disabled_assignments', (select count(*) from disabled_assignments),
      'disabled_links', (select count(*) from disabled_links),
      'disabled_services', coalesce((select jsonb_agg(to_jsonb(disabled_services)) from disabled_services), '[]'::jsonb),
      'disabled_staff', coalesce((select jsonb_agg(to_jsonb(disabled_staff)) from disabled_staff), '[]'::jsonb),
      'remaining_active_booking_count', (select count(*) from remaining_active_bookings)
    ) as payload;
  `);
  const payload = cleanupRows[0]?.payload ?? {};

  report.finalStatuses = {
    cancelledBookings: payload.cancelled_bookings ?? [],
    disabledAssignments: payload.disabled_assignments ?? 0,
    disabledLinks: payload.disabled_links ?? 0,
    disabledServices: payload.disabled_services ?? [],
    disabledStaff: payload.disabled_staff ?? [],
  };
  report.activeTestBookingCount = payload.remaining_active_booking_count ?? null;
  report.ok = report.activeTestBookingCount === 0;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await writeFile(
    path.join(artifactsDir, "gateF-clean-phase45-fixtures-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (!report.ok) {
    process.exitCode = 1;
  }
}

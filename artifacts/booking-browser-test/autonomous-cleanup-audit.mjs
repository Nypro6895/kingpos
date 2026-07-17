import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const artifactsDir = path.resolve("artifacts/booking-browser-test");
const expectedProjectRef = "bowkoiprvqwjilwaxhda";
const salonId = process.env.CLEANUP_SALON_ID ?? "7f599bc8-a806-4a68-be86-c149c21709e2";

function parseDotEnv(raw) {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        let value = line.slice(index + 1).trim();

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        return [line.slice(0, index).trim(), value];
      }),
  );
}

async function loadEnv() {
  let fileEnv = {};

  try {
    fileEnv = parseDotEnv(await readFile(".env.local", "utf8"));
  } catch {
    fileEnv = {};
  }

  return { ...fileEnv, ...process.env };
}

async function loadLinkedServiceRoleKey(projectRef) {
  const supabaseArgs = [
    "projects",
    "api-keys",
    "--project-ref",
    projectRef,
    "--output",
    "json",
  ];
  const command = process.platform === "win32" ? "cmd.exe" : "supabase";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "supabase.cmd", ...supabaseArgs]
      : supabaseArgs;
  const { stdout } = await execFileAsync(command, args, {
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    maxBuffer: 1024 * 1024,
  });
  const keys = JSON.parse(stdout);
  const serviceRole = keys.find(
    (key) => key.id === "service_role" || key.name === "service_role",
  );

  if (!serviceRole?.api_key || serviceRole.api_key.includes("·")) {
    throw new Error("Linked Supabase CLI did not return a usable service role key.");
  }

  return serviceRole.api_key;
}

function assertOk(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }

  return result.data ?? [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

async function selectTestRecords(admin) {
  const customers = assertOk(
    await admin
      .from("customers")
      .select("id, name, email, status")
      .eq("location_id", salonId)
      .or("email.ilike.gate%example.test,name.ilike.[E2E] Gate%"),
    "load test customers",
  );
  const staff = assertOk(
    await admin
      .from("staff")
      .select(
        "id, display_name, email, is_active, online_booking_enabled, owner_public_enabled, public_profile_visible",
      )
      .eq("salon_id", salonId)
      .ilike("email", "gate%example.test"),
    "load test staff",
  );
  const gateNamedServices = assertOk(
    await admin
      .from("services")
      .select("id, name, is_active")
      .eq("salon_id", salonId)
      .ilike("name", "Gate% Service"),
    "load gate-named test services",
  );
  const naturalVisualFixtureCandidates = assertOk(
    await admin
      .from("services")
      .select("id, name, description, base_price, duration_minutes, is_active, created_at")
      .eq("salon_id", salonId)
      .in("name", ["Builder Gel Overlay", "Signature Manicure"]),
    "load natural visual fixture service candidates",
  );
  const naturalVisualFixtures = naturalVisualFixtureCandidates.filter((service) => {
    const createdToday = String(service.created_at ?? "") >= "2026-07-17";
    const isBuilder =
      service.name === "Builder Gel Overlay" &&
      Number(service.base_price) === 62 &&
      service.duration_minutes === 60 &&
      service.description ===
        "Added strength and structure for a flawless natural finish.";
    const isSignature =
      service.name === "Signature Manicure" &&
      Number(service.base_price) === 32 &&
      service.duration_minutes === 35 &&
      service.description ===
        "Nail shaping, cuticle care, hand massage, and polish.";

    return createdToday && (isBuilder || isSignature);
  });
  const staffIds = staff.map((member) => member.id);
  const assignmentsForStaff =
    staffIds.length > 0
      ? assertOk(
          await admin
            .from("staff_service_assignments")
            .select("id, staff_id, service_id, is_active, online_bookable")
            .eq("salon_id", salonId)
            .in("staff_id", staffIds),
          "load test-staff assignments",
        )
      : [];
  const availabilityRulesForStaff =
    staffIds.length > 0
      ? assertOk(
          await admin
            .from("staff_availability_rules")
            .select("id, staff_id, is_active")
            .eq("salon_id", salonId)
            .in("staff_id", staffIds),
          "load test-staff availability rules",
        )
      : [];
  const serviceIds = unique([
    ...gateNamedServices.map((service) => service.id),
    ...naturalVisualFixtures.map((service) => service.id),
    ...assignmentsForStaff.map((assignment) => assignment.service_id),
  ]);
  const services =
    serviceIds.length > 0
      ? assertOk(
          await admin
            .from("services")
            .select("id, name, is_active")
            .eq("salon_id", salonId)
            .in("id", serviceIds),
          "load test services",
        )
      : [];
  const lineQueryIds = unique(serviceIds);
  const lines =
    lineQueryIds.length > 0 || staffIds.length > 0
      ? assertOk(
          await admin
            .from("booking_lines")
            .select("id, booking_id, service_id, assigned_staff_id, service_name_snapshot")
            .or(
              [
                lineQueryIds.length > 0 ? `service_id.in.(${lineQueryIds.join(",")})` : null,
                staffIds.length > 0 ? `assigned_staff_id.in.(${staffIds.join(",")})` : null,
              ]
                .filter(Boolean)
                .join(","),
            ),
          "load test booking lines",
        )
      : [];
  const customerIds = customers.map((customer) => customer.id);
  const bookingIds = unique(lines.map((line) => line.booking_id));
  const bookingsByCustomer =
    customerIds.length > 0
      ? assertOk(
          await admin
            .from("bookings")
            .select("id, status, customer_id, start_at, idempotency_key, cancellation_reason")
            .eq("salon_id", salonId)
            .in("customer_id", customerIds),
          "load test-customer bookings",
        )
      : [];
  const bookingsByLine =
    bookingIds.length > 0
      ? assertOk(
          await admin
            .from("bookings")
            .select("id, status, customer_id, start_at, idempotency_key, cancellation_reason")
            .eq("salon_id", salonId)
            .in("id", bookingIds),
          "load test-line bookings",
        )
      : [];
  const bookings = unique([...bookingsByCustomer, ...bookingsByLine].map((booking) => booking.id))
    .map((id) => [...bookingsByCustomer, ...bookingsByLine].find((booking) => booking.id === id))
    .filter(Boolean);

  return {
    assignmentsForStaff,
    availabilityRulesForStaff,
    bookings,
    customers,
    lines,
    services,
    staff,
  };
}

async function cleanup(admin, records) {
  const now = new Date().toISOString();
  const staffIds = records.staff.map((member) => member.id);
  const serviceIds = records.services.map((service) => service.id);
  const bookingIdsToCancel = records.bookings
    .filter((booking) => !["cancelled", "no_show", "completed"].includes(booking.status))
    .map((booking) => booking.id);
  const updateResults = {
    bookingsCancelled: [],
    serviceAddOnLinksDeactivated: [],
    servicesDeactivated: [],
    staffAvailabilityRuleCleanup: {
      blockedByInactiveStaff: [],
      deactivated: [],
    },
    staffDeactivated: [],
    staffServiceAssignmentsDeactivated: [],
  };

  if (bookingIdsToCancel.length > 0) {
    updateResults.bookingsCancelled = assertOk(
      await admin
        .from("bookings")
        .update({
          cancellation_reason: "Autonomous booking browser QA cleanup",
          cancelled_at: now,
          confirmation_status: "cancelled",
          status: "cancelled",
        })
        .eq("salon_id", salonId)
        .in("id", bookingIdsToCancel)
        .select("id, status, customer_id"),
      "cancel active test bookings",
    );
  }

  const activeStaffIds = records.staff
    .filter((member) => member.is_active)
    .map((member) => member.id);
  if (activeStaffIds.length > 0) {
    updateResults.staffAvailabilityRuleCleanup.deactivated = assertOk(
      await admin
        .from("staff_availability_rules")
        .update({ is_active: false })
        .eq("salon_id", salonId)
        .in("staff_id", activeStaffIds)
        .select("id, is_active, staff_id"),
      "deactivate active test-staff availability rules",
    );
  }
  updateResults.staffAvailabilityRuleCleanup.blockedByInactiveStaff =
    records.availabilityRulesForStaff.filter(
      (rule) =>
        rule.is_active &&
        !activeStaffIds.includes(rule.staff_id) &&
        staffIds.includes(rule.staff_id),
    );

  if (serviceIds.length > 0) {
    updateResults.serviceAddOnLinksDeactivated = assertOk(
      await admin
        .from("service_add_on_links")
        .update({ is_active: false })
        .eq("salon_id", salonId)
        .or(
          `parent_service_id.in.(${serviceIds.join(",")}),add_on_service_id.in.(${serviceIds.join(",")})`,
        )
        .select("id, is_active, parent_service_id, add_on_service_id"),
      "deactivate test service add-on links",
    );
  }

  if (staffIds.length > 0 || serviceIds.length > 0) {
    updateResults.staffServiceAssignmentsDeactivated = assertOk(
      await admin
        .from("staff_service_assignments")
        .update({ is_active: false, online_bookable: false })
        .eq("salon_id", salonId)
        .or(
          [
            staffIds.length > 0 ? `staff_id.in.(${staffIds.join(",")})` : null,
            serviceIds.length > 0 ? `service_id.in.(${serviceIds.join(",")})` : null,
          ]
            .filter(Boolean)
            .join(","),
        )
        .select("id, is_active, online_bookable, staff_id, service_id"),
      "deactivate test assignments",
    );
  }

  if (serviceIds.length > 0) {
    updateResults.servicesDeactivated = assertOk(
      await admin
        .from("services")
        .update({ is_active: false })
        .eq("salon_id", salonId)
        .in("id", serviceIds)
        .select("id, name, is_active"),
      "deactivate test services",
    );
  }

  if (staffIds.length > 0) {
    updateResults.staffDeactivated = assertOk(
      await admin
        .from("staff")
        .update({
          is_active: false,
          online_booking_enabled: false,
          owner_public_enabled: false,
          public_profile_visible: false,
        })
        .eq("salon_id", salonId)
        .in("id", staffIds)
        .select(
          "id, display_name, is_active, online_booking_enabled, owner_public_enabled, public_profile_visible",
        ),
      "deactivate test staff",
    );
  }

  return updateResults;
}

function countFinalProblems(records) {
  return {
    activeBookings: records.bookings.filter(
      (booking) => !["cancelled", "no_show", "completed"].includes(booking.status),
    ).length,
    activeServices: records.services.filter((service) => service.is_active).length,
    activeStaff: records.staff.filter(
      (member) =>
        member.is_active ||
        member.online_booking_enabled ||
        member.owner_public_enabled ||
        member.public_profile_visible,
    ).length,
    activeStaffAssignments: records.assignmentsForStaff.filter(
      (assignment) => assignment.is_active || assignment.online_bookable,
    ).length,
    activeRulesForInactiveStaff: records.availabilityRulesForStaff.filter((rule) => {
      const staff = records.staff.find((member) => member.id === rule.staff_id);
      return rule.is_active && staff && !staff.is_active;
    }).length,
  };
}

const report = {
  cleaned: null,
  finalCounts: null,
  initialCounts: null,
  ok: false,
  projectRef: null,
  records: null,
  salonId,
};

try {
  await mkdir(artifactsDir, { recursive: true });
  const projectRef = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
  report.projectRef = projectRef;

  if (projectRef !== expectedProjectRef) {
    throw new Error(`Linked project ref ${projectRef} does not match ${expectedProjectRef}.`);
  }

  const env = await loadEnv();
  const serviceRoleKey = await loadLinkedServiceRoleKey(projectRef);
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const before = await selectTestRecords(admin);
  report.initialCounts = countFinalProblems(before);
  report.cleaned = await cleanup(admin, before);
  const after = await selectTestRecords(admin);
  report.finalCounts = countFinalProblems(after);
  report.records = {
    activeBookingIdsBefore: before.bookings
      .filter((booking) => !["cancelled", "no_show", "completed"].includes(booking.status))
      .map((booking) => booking.id),
    activeBookingIdsAfter: after.bookings
      .filter((booking) => !["cancelled", "no_show", "completed"].includes(booking.status))
      .map((booking) => booking.id),
    customerIds: after.customers.map((customer) => customer.id),
    serviceIds: after.services.map((service) => service.id),
    staffIds: after.staff.map((member) => member.id),
  };
  report.ok =
    report.finalCounts.activeBookings === 0 &&
    report.finalCounts.activeServices === 0 &&
    report.finalCounts.activeStaff === 0 &&
    report.finalCounts.activeStaffAssignments === 0;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await writeFile(
    path.join(artifactsDir, "autonomous-cleanup-audit-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

if (!report.ok) {
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}

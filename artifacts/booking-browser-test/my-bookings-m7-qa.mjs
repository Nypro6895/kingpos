import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const artifactsDir = path.resolve("artifacts/booking-browser-test");
const baseUrl = process.env.MY_BOOKINGS_QA_BASE_URL ?? "http://localhost:3000";
const runStartedAt = new Date().toISOString();
const marker = `My Bookings M7 QA ${new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, "")
  .slice(0, 14)}`;
const slug = marker.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const accountEmail = `${slug}+customer@example.test`;
const otherEmail = `${slug}+other@example.test`;
const accountPassword = "KingPOS-MyBookings-M7-QA-12345!";
const timezone = "America/Chicago";
const slotDate = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
const pastDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

async function loadLinkedServiceRoleKey() {
  const projectRef = (await readFile("supabase/.temp/project-ref", "utf8")).trim();
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
    env: {
      ...process.env,
      SUPABASE_DISABLE_TELEMETRY: "1",
      SUPABASE_TELEMETRY_DISABLED: "1",
    },
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

  return result.data;
}

function dayOfWeek(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function addMinutes(isoValue, minutes) {
  return new Date(new Date(isoValue).getTime() + minutes * 60 * 1000).toISOString();
}

async function waitForServer() {
  let lastError;

  for (let index = 0; index < 60; index += 1) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });

      if (response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw lastError ?? new Error(`Server did not respond at ${baseUrl}.`);
}

async function launchBrowser() {
  const attempts = [
    () => chromium.launch({ channel: "chrome", headless: true }),
    () => chromium.launch({ channel: "msedge", headless: true }),
    () => chromium.launch({ headless: true }),
  ];
  let lastError;

  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function recordPageErrors(page, report) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      report.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure();

    if (failure?.errorText !== "net::ERR_ABORTED") {
      report.networkErrors.push(`${failure?.errorText ?? "request failed"} ${request.url()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      report.networkErrors.push(`${response.status()} ${response.url()}`);
    }
  });
}

async function screenshot(page, report, name) {
  await page.screenshot({
    fullPage: true,
    path: path.join(artifactsDir, name),
  });
  report.screenshots.push(name);
}

async function waitForPublicUser(admin, authUserId, email, displayName) {
  for (let index = 0; index < 10; index += 1) {
    const { data, error } = await admin
      .from("users")
      .select("id, auth_user_id, email, display_name")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (data) {
      return assertOk(
        await admin
          .from("users")
          .update({
            display_name: displayName,
            email,
            status: "active",
          })
          .eq("id", data.id)
          .select("id, auth_user_id, email, display_name")
          .single(),
        "normalize public user",
      );
    }

    if (error) {
      throw new Error(`load public user: ${error.message}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return assertOk(
    await admin
      .from("users")
      .insert({
        auth_user_id: authUserId,
        display_name: displayName,
        email,
        status: "active",
      })
      .select("id, auth_user_id, email, display_name")
      .single(),
    "create public user fallback",
  );
}

async function createAuthFixture(admin, email, displayName) {
  const created = assertOk(
    await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: accountPassword,
      user_metadata: {
        display_name: displayName,
      },
    }),
    `create auth fixture ${email}`,
  );
  const publicUser = await waitForPublicUser(admin, created.user.id, email, displayName);

  return {
    authUser: created.user,
    publicUser,
  };
}

async function insertBooking(admin, input) {
  const booking = assertOk(
    await admin
      .from("bookings")
      .insert({
        cancellation_policy_snapshot: {},
        cancelled_at: input.status === "cancelled" ? new Date().toISOString() : null,
        confirmation_mode: input.confirmationMode ?? "instant_booking",
        confirmation_status:
          input.confirmationStatus ??
          (input.status === "pending" ? "requested" : input.status === "cancelled" ? "cancelled" : "confirmed"),
        created_by_user_id: input.createdByUserId ?? null,
        customer_id: input.customerId,
        customer_user_id: input.customerUserId ?? null,
        end_at: input.endAt,
        idempotency_key: input.idempotencyKey,
        no_show_at: input.status === "no_show" ? new Date().toISOString() : null,
        organization_id: input.organizationId,
        payment_status: "not_required",
        salon_id: input.salonId,
        salon_timezone_snapshot: timezone,
        source: "public_profile",
        staff_id: input.staffId ?? null,
        start_at: input.startAt,
        status: input.status,
      })
      .select("id")
      .single(),
    `create booking ${input.idempotencyKey}`,
  );

  return booking;
}

async function seedFixtures(admin, report) {
  const salon = assertOk(
    await admin
      .from("locations")
      .select(
        "id, address_line1, address_line2, city, country, organization_id, name, phone, postal_code, state",
      )
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .single(),
    "load active salon",
  );
  const organization = assertOk(
    await admin
      .from("organizations")
      .select("id, name")
      .eq("id", salon.organization_id)
      .single(),
    "load organization",
  );
  const originalSalonSetting = assertOk(
    await admin
      .from("salon_settings")
      .select(
        "id, address_line1, address_line2, business_name, city, country, email, phone, postal_code, public_discovery_enabled, public_discovery_published_at, state, website",
      )
      .eq("salon_id", salon.id)
      .maybeSingle(),
    "load original salon setting",
  );
  assertOk(
    await admin.from("salon_settings").upsert(
      {
        address_line1: "100 Fixture Ave",
        address_line2: null,
        business_name: originalSalonSetting?.business_name ?? salon.name ?? "KingPOS salon",
        city: "Wichita",
        country: "US",
        email: `${slug}+salon@example.test`,
        organization_id: organization.id,
        phone: "+1555090199",
        postal_code: "67202",
        public_discovery_enabled: true,
        public_discovery_published_at:
          originalSalonSetting?.public_discovery_published_at ?? new Date().toISOString(),
        salon_id: salon.id,
        state: "KS",
        website: originalSalonSetting?.website ?? null,
      },
      { onConflict: "salon_id" },
    ),
    "seed salon contact setting",
  );
  assertOk(
    await admin
      .from("locations")
      .update({
        address_line1: "100 Fixture Ave",
        address_line2: null,
        city: "Wichita",
        country: "US",
        phone: "+1555090199",
        postal_code: "67202",
        state: "KS",
      })
      .eq("id", salon.id),
    "seed salon location contact",
  );
  const customerAccount = await createAuthFixture(admin, accountEmail, `${marker} Customer`);
  const otherAccount = await createAuthFixture(admin, otherEmail, "Other My Bookings M7 QA user");

  await admin
    .from("booking_settings")
    .upsert(
      {
        any_professional_enabled: true,
        booking_enabled: true,
        confirmation_mode: "instant_booking",
        default_cleanup_buffer_minutes: 0,
        guest_booking_enabled: true,
        maximum_advance_window_days: 365,
        minimum_lead_time_minutes: 0,
        online_booking_visible: true,
        organization_id: organization.id,
        salon_id: salon.id,
        same_day_booking_enabled: true,
        slot_interval_minutes: 15,
        split_staff_appointment_enabled: true,
        timezone_iana: timezone,
      },
      { onConflict: "salon_id" },
    );

  const staffRows = assertOk(
    await admin
      .from("staff")
      .insert([
        {
          display_name: `${marker} Stylist A`,
          email: `${slug}+staff-a@example.test`,
          first_name: "M7",
          is_active: true,
          job_title: "Color specialist",
          last_name: "Stylist A",
          online_booking_enabled: true,
          organization_id: organization.id,
          owner_public_enabled: true,
          phone: "+1555090101",
          profile_display_order: -8801,
          public_profile_photo_path: null,
          public_profile_visible: true,
          salon_id: salon.id,
          staff_public_consent_status: "granted",
        },
        {
          display_name: `${marker} Stylist B`,
          email: `${slug}+staff-b@example.test`,
          first_name: "M7",
          is_active: true,
          job_title: "Finishing specialist",
          last_name: "Stylist B",
          online_booking_enabled: true,
          organization_id: organization.id,
          owner_public_enabled: true,
          phone: "+1555090102",
          profile_display_order: -8800,
          public_profile_photo_path: null,
          public_profile_visible: true,
          salon_id: salon.id,
          staff_public_consent_status: "granted",
        },
        {
          display_name: `${marker} Historical Stylist`,
          email: `${slug}+staff-historical@example.test`,
          first_name: "M7",
          is_active: true,
          job_title: "Former professional",
          last_name: "Historical",
          online_booking_enabled: true,
          organization_id: organization.id,
          owner_public_enabled: false,
          phone: "+1555090103",
          profile_display_order: -8799,
          public_profile_photo_path: null,
          public_profile_visible: true,
          salon_id: salon.id,
          staff_public_consent_status: "granted",
        },
      ])
      .select("id, display_name")
      .returns(),
    "create staff fixtures",
  );
  const [staffA, staffB, historicalStaff] = staffRows;
  const serviceRows = assertOk(
    await admin
      .from("services")
      .insert([
        {
          base_price: 120,
          category: "My Bookings M7 QA",
          description: `${marker} root color`,
          duration_minutes: 45,
          is_active: true,
          name: `${marker} Root Color`,
          online_booking_enabled: true,
          organization_id: organization.id,
          salon_id: salon.id,
        },
        {
          base_price: 22,
          category: "My Bookings M7 QA",
          description: `${marker} gloss add-on`,
          duration_minutes: 15,
          is_active: true,
          name: `${marker} Gloss Add-on`,
          online_booking_enabled: true,
          organization_id: organization.id,
          salon_id: salon.id,
        },
        {
          base_price: 48,
          category: "My Bookings M7 QA",
          description: `${marker} blowout`,
          duration_minutes: 45,
          is_active: true,
          name: `${marker} Blowout`,
          online_booking_enabled: true,
          organization_id: organization.id,
          salon_id: salon.id,
        },
        {
          base_price: 65,
          category: "My Bookings M7 QA",
          description: `${marker} historical service`,
          duration_minutes: 45,
          is_active: true,
          name: `${marker} Historical Service`,
          online_booking_enabled: true,
          organization_id: organization.id,
          salon_id: salon.id,
        },
      ])
      .select("id, name")
      .returns(),
    "create service fixtures",
  );
  const [colorService, glossAddOn, blowoutService, historicalService] = serviceRows;
  const addOnLink = assertOk(
    await admin
      .from("service_add_on_links")
      .insert({
        add_on_service_id: glossAddOn.id,
        display_order: 0,
        is_active: true,
        organization_id: organization.id,
        parent_service_id: colorService.id,
        salon_id: salon.id,
      })
      .select("id")
      .single(),
    "create add-on link",
  );
  const assignments = assertOk(
    await admin
      .from("staff_service_assignments")
      .insert([
        {
          is_active: true,
          online_bookable: true,
          organization_id: organization.id,
          salon_id: salon.id,
          service_id: colorService.id,
          staff_id: staffA.id,
        },
        {
          is_active: true,
          online_bookable: true,
          organization_id: organization.id,
          salon_id: salon.id,
          service_id: glossAddOn.id,
          staff_id: staffA.id,
        },
        {
          is_active: true,
          online_bookable: true,
          organization_id: organization.id,
          salon_id: salon.id,
          service_id: blowoutService.id,
          staff_id: staffB.id,
        },
      ])
      .select("id"),
    "create staff assignments",
  );
  const availability = assertOk(
    await admin
      .from("staff_availability_rules")
      .insert([
        {
          day_of_week: dayOfWeek(slotDate),
          effective_end_date: slotDate,
          effective_start_date: slotDate,
          ends_at_local: "20:00:00",
          is_active: true,
          organization_id: organization.id,
          rule_type: "working",
          salon_id: salon.id,
          staff_id: staffA.id,
          starts_at_local: "08:00:00",
          timezone_iana: timezone,
        },
        {
          day_of_week: dayOfWeek(slotDate),
          effective_end_date: slotDate,
          effective_start_date: slotDate,
          ends_at_local: "20:00:00",
          is_active: true,
          organization_id: organization.id,
          rule_type: "working",
          salon_id: salon.id,
          staff_id: staffB.id,
          starts_at_local: "08:00:00",
          timezone_iana: timezone,
        },
        {
          day_of_week: dayOfWeek(slotDate),
          effective_end_date: slotDate,
          effective_start_date: slotDate,
          ends_at_local: "10:30:00",
          is_active: true,
          organization_id: organization.id,
          rule_type: "break",
          salon_id: salon.id,
          staff_id: staffA.id,
          starts_at_local: "10:00:00",
          timezone_iana: timezone,
        },
      ])
      .select("id"),
    "create availability fixtures",
  );
  const timeBlock = assertOk(
    await admin
      .from("staff_time_blocks")
      .insert({
        block_type: "time_off",
        ends_at: `${slotDate}T17:00:00.000Z`,
        is_active: true,
        organization_id: organization.id,
        reason: `${marker} time-off fixture`,
        salon_id: salon.id,
        staff_id: staffA.id,
        starts_at: `${slotDate}T16:15:00.000Z`,
        timezone_iana: timezone,
      })
      .select("id")
      .single(),
    "create time block fixture",
  );
  const customer = assertOk(
    await admin
      .from("customers")
      .insert({
        email: accountEmail,
        location_id: salon.id,
        name: `${marker} Customer`,
        phone: "+1555090111",
        status: "active",
      })
      .select("id")
      .single(),
    "create customer fixture",
  );
  const busyCustomer = assertOk(
    await admin
      .from("customers")
      .insert({
        email: `${slug}+busy@example.test`,
        location_id: salon.id,
        name: `${marker} Busy`,
        phone: "+1555090112",
        status: "active",
      })
      .select("id")
      .single(),
    "create busy customer fixture",
  );

  const bookingIds = [];
  const lineRows = [];
  const mainBooking = await insertBooking(admin, {
    createdByUserId: customerAccount.publicUser.id,
    customerId: customer.id,
    customerUserId: customerAccount.publicUser.id,
    endAt: `${slotDate}T16:45:00.000Z`,
    idempotencyKey: `${marker} upcoming multi add-on split`,
    organizationId: organization.id,
    salonId: salon.id,
    staffId: staffA.id,
    startAt: `${slotDate}T15:00:00.000Z`,
    status: "confirmed",
  });
  bookingIds.push(mainBooking.id);
  const mainLineId = crypto.randomUUID();
  const addOnLineId = crypto.randomUUID();
  const blowoutLineId = crypto.randomUUID();
  lineRows.push(
    {
      assigned_staff_id: staffA.id,
      booking_id: mainBooking.id,
      cleanup_buffer_minutes: 0,
      display_order: 0,
      duration_minutes: 45,
      id: mainLineId,
      line_type: "service",
      organization_id: organization.id,
      quantity: 1,
      salon_id: salon.id,
      scheduled_end_at: `${slotDate}T15:45:00.000Z`,
      scheduled_start_at: `${slotDate}T15:00:00.000Z`,
      service_id: colorService.id,
      service_name_snapshot: `${marker} Root Color`,
      unit_price: 120,
    },
    {
      assigned_staff_id: staffA.id,
      booking_id: mainBooking.id,
      cleanup_buffer_minutes: 0,
      display_order: 1,
      duration_minutes: 15,
      id: addOnLineId,
      line_type: "add_on",
      organization_id: organization.id,
      parent_booking_line_id: mainLineId,
      quantity: 1,
      salon_id: salon.id,
      scheduled_end_at: `${slotDate}T16:00:00.000Z`,
      scheduled_start_at: `${slotDate}T15:45:00.000Z`,
      service_id: glossAddOn.id,
      service_name_snapshot: `${marker} Gloss Add-on`,
      unit_price: 22,
    },
    {
      assigned_staff_id: staffB.id,
      booking_id: mainBooking.id,
      cleanup_buffer_minutes: 0,
      display_order: 2,
      duration_minutes: 45,
      id: blowoutLineId,
      line_type: "service",
      organization_id: organization.id,
      quantity: 1,
      salon_id: salon.id,
      scheduled_end_at: `${slotDate}T16:45:00.000Z`,
      scheduled_start_at: `${slotDate}T16:00:00.000Z`,
      service_id: blowoutService.id,
      service_name_snapshot: `${marker} Blowout`,
      unit_price: 48,
    },
  );

  const pendingBooking = await insertBooking(admin, {
    confirmationMode: "request_confirmation",
    confirmationStatus: "requested",
    createdByUserId: customerAccount.publicUser.id,
    customerId: customer.id,
    customerUserId: customerAccount.publicUser.id,
    endAt: `${slotDate}T17:45:00.000Z`,
    idempotencyKey: `${marker} pending`,
    organizationId: organization.id,
    salonId: salon.id,
    staffId: staffA.id,
    startAt: `${slotDate}T17:00:00.000Z`,
    status: "pending",
  });
  bookingIds.push(pendingBooking.id);
  lineRows.push({
    assigned_staff_id: staffA.id,
    booking_id: pendingBooking.id,
    cleanup_buffer_minutes: 0,
    display_order: 0,
    duration_minutes: 45,
    id: crypto.randomUUID(),
    line_type: "service",
    organization_id: organization.id,
    quantity: 1,
    salon_id: salon.id,
    scheduled_end_at: `${slotDate}T17:45:00.000Z`,
    scheduled_start_at: `${slotDate}T17:00:00.000Z`,
    service_id: colorService.id,
    service_name_snapshot: `${marker} Pending Service`,
    unit_price: 120,
  });

  const cancelledBooking = await insertBooking(admin, {
    createdByUserId: customerAccount.publicUser.id,
    customerId: customer.id,
    customerUserId: customerAccount.publicUser.id,
    endAt: `${slotDate}T18:45:00.000Z`,
    idempotencyKey: `${marker} cancelled`,
    organizationId: organization.id,
    salonId: salon.id,
    staffId: staffA.id,
    startAt: `${slotDate}T18:00:00.000Z`,
    status: "cancelled",
  });
  bookingIds.push(cancelledBooking.id);
  lineRows.push({
    assigned_staff_id: staffA.id,
    booking_id: cancelledBooking.id,
    cleanup_buffer_minutes: 0,
    display_order: 0,
    duration_minutes: 45,
    id: crypto.randomUUID(),
    line_type: "service",
    organization_id: organization.id,
    quantity: 1,
    salon_id: salon.id,
    scheduled_end_at: `${slotDate}T18:45:00.000Z`,
    scheduled_start_at: `${slotDate}T18:00:00.000Z`,
    service_id: colorService.id,
    service_name_snapshot: `${marker} Cancelled Service`,
    unit_price: 120,
  });

  const completedBooking = await insertBooking(admin, {
    createdByUserId: customerAccount.publicUser.id,
    customerId: customer.id,
    customerUserId: customerAccount.publicUser.id,
    endAt: `${pastDate}T16:45:00.000Z`,
    idempotencyKey: `${marker} completed`,
    organizationId: organization.id,
    salonId: salon.id,
    staffId: staffB.id,
    startAt: `${pastDate}T16:00:00.000Z`,
    status: "completed",
  });
  bookingIds.push(completedBooking.id);
  lineRows.push({
    assigned_staff_id: staffB.id,
    booking_id: completedBooking.id,
    cleanup_buffer_minutes: 0,
    display_order: 0,
    duration_minutes: 45,
    id: crypto.randomUUID(),
    line_type: "service",
    organization_id: organization.id,
    quantity: 1,
    salon_id: salon.id,
    scheduled_end_at: `${pastDate}T16:45:00.000Z`,
    scheduled_start_at: `${pastDate}T16:00:00.000Z`,
    service_id: blowoutService.id,
    service_name_snapshot: `${marker} Completed Blowout`,
    unit_price: 48,
  });

  const noShowBooking = await insertBooking(admin, {
    createdByUserId: customerAccount.publicUser.id,
    customerId: customer.id,
    customerUserId: customerAccount.publicUser.id,
    endAt: `${pastDate}T17:45:00.000Z`,
    idempotencyKey: `${marker} no show`,
    organizationId: organization.id,
    salonId: salon.id,
    staffId: staffA.id,
    startAt: `${pastDate}T17:00:00.000Z`,
    status: "no_show",
  });
  bookingIds.push(noShowBooking.id);
  lineRows.push({
    assigned_staff_id: staffA.id,
    booking_id: noShowBooking.id,
    cleanup_buffer_minutes: 0,
    display_order: 0,
    duration_minutes: 45,
    id: crypto.randomUUID(),
    line_type: "service",
    organization_id: organization.id,
    quantity: 1,
    salon_id: salon.id,
    scheduled_end_at: `${pastDate}T17:45:00.000Z`,
    scheduled_start_at: `${pastDate}T17:00:00.000Z`,
    service_id: colorService.id,
    service_name_snapshot: `${marker} No-show Service`,
    unit_price: 120,
  });

  const historicalBooking = await insertBooking(admin, {
    createdByUserId: customerAccount.publicUser.id,
    customerId: customer.id,
    customerUserId: customerAccount.publicUser.id,
    endAt: `${pastDate}T18:45:00.000Z`,
    idempotencyKey: `${marker} inactive snapshot`,
    organizationId: organization.id,
    salonId: salon.id,
    staffId: historicalStaff.id,
    startAt: `${pastDate}T18:00:00.000Z`,
    status: "completed",
  });
  bookingIds.push(historicalBooking.id);
  lineRows.push({
    assigned_staff_id: historicalStaff.id,
    booking_id: historicalBooking.id,
    cleanup_buffer_minutes: 0,
    display_order: 0,
    duration_minutes: 45,
    id: crypto.randomUUID(),
    line_type: "service",
    organization_id: organization.id,
    quantity: 1,
    salon_id: salon.id,
    scheduled_end_at: `${pastDate}T18:45:00.000Z`,
    scheduled_start_at: `${pastDate}T18:00:00.000Z`,
    service_id: historicalService.id,
    service_name_snapshot: `${marker} Historical Service`,
    unit_price: 65,
  });

  const busyBooking = await insertBooking(admin, {
    customerId: busyCustomer.id,
    endAt: `${slotDate}T14:45:00.000Z`,
    idempotencyKey: `${marker} busy blocker`,
    organizationId: organization.id,
    salonId: salon.id,
    staffId: staffA.id,
    startAt: `${slotDate}T14:00:00.000Z`,
    status: "confirmed",
  });
  bookingIds.push(busyBooking.id);
  lineRows.push({
    assigned_staff_id: staffA.id,
    booking_id: busyBooking.id,
    cleanup_buffer_minutes: 0,
    display_order: 0,
    duration_minutes: 45,
    id: crypto.randomUUID(),
    line_type: "service",
    organization_id: organization.id,
    quantity: 1,
    salon_id: salon.id,
    scheduled_end_at: `${slotDate}T14:45:00.000Z`,
    scheduled_start_at: `${slotDate}T14:00:00.000Z`,
    service_id: colorService.id,
    service_name_snapshot: `${marker} Busy Blocker`,
    unit_price: 120,
  });

  assertOk(await admin.from("booking_lines").insert(lineRows), "create booking lines");
  assertOk(
    await admin
      .from("services")
      .update({ is_active: false, online_booking_enabled: false })
      .eq("id", historicalService.id),
    "deactivate historical service fixture",
  );
  assertOk(
    await admin
      .from("staff")
      .update({
        is_active: false,
        online_booking_enabled: false,
        public_profile_visible: false,
      })
      .eq("id", historicalStaff.id),
    "deactivate historical staff fixture",
  );

  report.fixtures = {
    addOnLinkId: addOnLink.id,
    assignmentIds: assignments.map((item) => item.id),
    availabilityIds: availability.map((item) => item.id),
    bookingIds,
    customerIds: [customer.id, busyCustomer.id],
    mainBookingId: mainBooking.id,
    noShowBookingId: noShowBooking.id,
    originalSalonSetting,
    originalSalonLocation: salon,
    publicUserIds: [customerAccount.publicUser.id, otherAccount.publicUser.id],
    serviceIds: serviceRows.map((item) => item.id),
    staffIds: staffRows.map((item) => item.id),
    timeBlockId: timeBlock.id,
  };

  return {
    addOnLink,
    assignments,
    availability,
    bookingIds,
    busyCustomer,
    completedBooking,
    customer,
    customerAccount,
    historicalBooking,
    mainBooking,
    noShowBooking,
    organization,
    originalSalonSetting,
    originalSalonLocation: salon,
    otherAccount,
    salon,
    serviceRows,
    staffRows,
    timeBlock,
  };
}

async function createRaceBlocker(admin, fixtures, startAt) {
  const booking = await insertBooking(admin, {
    customerId: fixtures.busyCustomer.id,
    endAt: addMinutes(startAt, 45),
    idempotencyKey: `${marker} race blocker ${startAt}`,
    organizationId: fixtures.organization.id,
    salonId: fixtures.salon.id,
    staffId: fixtures.staffRows[0].id,
    startAt,
    status: "confirmed",
  });

  assertOk(
    await admin.from("booking_lines").insert({
      assigned_staff_id: fixtures.staffRows[0].id,
      booking_id: booking.id,
      cleanup_buffer_minutes: 0,
      display_order: 0,
      duration_minutes: 45,
      id: crypto.randomUUID(),
      line_type: "service",
      organization_id: fixtures.organization.id,
      quantity: 1,
      salon_id: fixtures.salon.id,
      scheduled_end_at: addMinutes(startAt, 45),
      scheduled_start_at: startAt,
      service_id: fixtures.serviceRows[0].id,
      service_name_snapshot: `${marker} Race Blocker`,
      unit_price: 120,
    }),
    "create race blocker line",
  );

  fixtures.bookingIds.push(booking.id);
  return booking.id;
}

async function cleanup(admin, fixtures, report) {
  if (!fixtures) {
    return;
  }

  const now = new Date().toISOString();
  const bookingIds = fixtures.bookingIds;
  await admin.from("app_notifications").delete().in("booking_id", bookingIds);
  await admin
    .from("bookings")
    .update({
      cancellation_reason: "My Bookings M7 browser QA cleanup",
      cancelled_at: now,
      confirmation_status: "cancelled",
      status: "cancelled",
      updated_at: now,
    })
    .in("id", bookingIds);
  await admin.from("app_notifications").delete().in("booking_id", bookingIds);
  await admin
    .from("staff_time_blocks")
    .update({ is_active: false })
    .eq("id", fixtures.timeBlock.id);
  await admin
    .from("staff_availability_rules")
    .update({ is_active: false })
    .in("id", fixtures.availability.map((item) => item.id));
  await admin
    .from("staff_service_assignments")
    .update({ is_active: false, online_bookable: false })
    .in("id", fixtures.assignments.map((item) => item.id));
  await admin
    .from("service_add_on_links")
    .delete()
    .eq("id", fixtures.addOnLink.id);
  await admin
    .from("services")
    .update({ is_active: false, online_booking_enabled: false })
    .in("id", fixtures.serviceRows.map((item) => item.id));
  await admin
    .from("staff")
    .update({
      is_active: false,
      online_booking_enabled: false,
      owner_public_enabled: false,
      public_profile_visible: false,
    })
    .in("id", fixtures.staffRows.map((item) => item.id));
  await admin
    .from("customers")
    .update({ status: "inactive" })
    .in("id", [fixtures.customer.id, fixtures.busyCustomer.id]);
  await admin.auth.admin.deleteUser(fixtures.customerAccount.authUser.id).catch(() => {});
  await admin.auth.admin.deleteUser(fixtures.otherAccount.authUser.id).catch(() => {});
  await admin
    .from("users")
    .update({ auth_user_id: null, status: "deleted" })
    .in("email", [accountEmail, otherEmail]);
  if (fixtures.originalSalonSetting) {
    await admin
      .from("salon_settings")
      .update({
        address_line1: fixtures.originalSalonSetting.address_line1,
        address_line2: fixtures.originalSalonSetting.address_line2,
        business_name: fixtures.originalSalonSetting.business_name,
        city: fixtures.originalSalonSetting.city,
        country: fixtures.originalSalonSetting.country,
        email: fixtures.originalSalonSetting.email,
        phone: fixtures.originalSalonSetting.phone,
        postal_code: fixtures.originalSalonSetting.postal_code,
        public_discovery_enabled: fixtures.originalSalonSetting.public_discovery_enabled,
        public_discovery_published_at:
          fixtures.originalSalonSetting.public_discovery_published_at,
        state: fixtures.originalSalonSetting.state,
        website: fixtures.originalSalonSetting.website,
      })
      .eq("id", fixtures.originalSalonSetting.id);
  } else {
    await admin
      .from("salon_settings")
      .delete()
      .eq("salon_id", fixtures.salon.id)
      .eq("email", `${slug}+salon@example.test`);
  }
  await admin
    .from("locations")
    .update({
      address_line1: fixtures.originalSalonLocation.address_line1,
      address_line2: fixtures.originalSalonLocation.address_line2,
      city: fixtures.originalSalonLocation.city,
      country: fixtures.originalSalonLocation.country,
      phone: fixtures.originalSalonLocation.phone,
      postal_code: fixtures.originalSalonLocation.postal_code,
      state: fixtures.originalSalonLocation.state,
    })
    .eq("id", fixtures.originalSalonLocation.id);

  const finalRows = assertOk(
    await admin
      .from("bookings")
      .select("id, status")
      .in("id", bookingIds),
    "load final booking cleanup state",
  );
  const activeNotificationRows = assertOk(
    await admin
      .from("app_notifications")
      .select("id")
      .in("booking_id", bookingIds),
    "load final notification cleanup state",
  );

  report.cleanup = {
    activeNotifications: activeNotificationRows.length,
    bookingStatuses: finalRows,
  };
}

async function login(page, email) {
  await page.goto(`${baseUrl}/login?next=/my-bookings`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(accountPassword);
  await page.getByRole("button", { name: "Login" }).click();
  await page.getByRole("heading", { name: "My bookings" }).waitFor({ timeout: 30000 });
}

async function runCustomerFlow(browser, admin, fixtures, report) {
  const context = await browser.newContext({ viewport: { height: 980, width: 1440 } });
  const page = await context.newPage();
  recordPageErrors(page, report);

  try {
    await login(page, accountEmail);
    await page.getByText(`${marker} Root Color`).first().waitFor({ timeout: 30000 });
    report.upcomingConfirmedVisible = true;
    report.pendingVisible = (await page.getByText("pending").count()) > 0;
    report.multiServiceVisible =
      (await page.getByText(`${marker} Blowout`).count()) > 0 ||
      (await page.getByText(/2 professionals/).count()) > 0;
    report.addOnsVisible = (await page.getByText(/add-on/i).count()) > 0;
    report.splitProfessionalsVisible = (await page.getByText(/2 professionals/).count()) > 0;
    await screenshot(page, report, "m7-my-bookings-desktop-list.png");

    await page.getByRole("link", { name: /Blowout/i }).first().click();
    await page.waitForURL(`**/my-bookings/${fixtures.mainBooking.id}`, { timeout: 30000 });
    try {
      await page.getByRole("heading", { name: /Appointment details/i }).waitFor({
        timeout: 30000,
      });
    } catch (error) {
      report.detailDebug = {
        bodyText: (await page.locator("body").innerText()).slice(0, 1200),
        url: page.url(),
      };
      await screenshot(page, report, "m7-detail-load-failure.png");
      throw error;
    }
    report.upcomingDetailLoaded = true;
    report.noRawDatetimeInput =
      (await page.locator("input[type='datetime-local']").count()) === 0;
    report.contactSalonAvailable =
      (await page.getByRole("button", { name: "Contact salon" }).count()) > 0;
    await page.getByRole("button", { name: "Contact salon" }).click();
    report.contactChoicesVisible =
      (await page.getByRole("link", { name: /Call salon|Email salon|Directions/ }).count()) > 0;
    await screenshot(page, report, "m7-upcoming-booking-detail.png");

    await page.getByRole("button", { name: "Reschedule" }).click();
    await page.getByRole("heading", { name: "Reschedule appointment" }).waitFor({
      timeout: 30000,
    });
    await page.locator("[data-slot-start]").first().waitFor({ timeout: 30000 });
    await screenshot(page, report, "m7-reschedule-modal.png");
    const slotButtons = page.locator("[data-slot-start]");
    const slotCount = await slotButtons.count();
    const slotTexts = await slotButtons.allTextContents();
    report.breakTimeOffBusyExcluded =
      !slotTexts.some((text) => /9:00 AM|10:00 AM|11:15 AM/.test(text));

    const raceSlot = await slotButtons.first().getAttribute("data-slot-start");
    if (!raceSlot || slotCount < 2) {
      throw new Error("Reschedule modal did not expose enough candidate slots.");
    }

    await createRaceBlocker(admin, fixtures, raceSlot);
    await page.getByRole("button", { name: "Confirm reschedule" }).click();
    await page.getByText("That time is no longer available.").waitFor({
      timeout: 30000,
    });
    report.rescheduleRaceRejected = true;

    await slotButtons.nth(1).click();
    await page.getByRole("button", { name: "Confirm reschedule" }).click();
    await page.getByText("Booking rescheduled.").waitFor({ timeout: 30000 });
    report.rescheduleValidSlotWorked = true;

    await page.getByRole("button", { name: "Cancel appointment" }).click();
    await page.getByRole("heading", { name: "Cancel this appointment?" }).waitFor({
      timeout: 30000,
    });
    report.cancelModalWorked = true;
    await screenshot(page, report, "m7-cancel-confirmation.png");
    await page.getByLabel("Reason optional").fill("My Bookings M7 cancellation");
    await page.getByRole("button", { name: "Confirm cancellation" }).click();
    await page.getByText("Booking cancelled.").waitFor({ timeout: 30000 });
    report.cancelWorked = true;

    await page.goto(`${baseUrl}/my-bookings?tab=past`, { waitUntil: "networkidle" });
    await page.getByText(`${marker} Blowout`).first().waitFor({ timeout: 30000 });
    await page.getByText("no show").waitFor({ timeout: 30000 });
    await page.getByText(`${marker} Historical Service`).waitFor({ timeout: 30000 });
    report.pastCompletedVisible = true;
    report.noShowVisible = true;
    report.inactiveSnapshotVisible = true;

    await page
      .getByRole("link", {
        name: new RegExp(`${escapeRegExp(marker)}[\\s\\S]*Blowout`, "i"),
      })
      .first()
      .click();
    await page.waitForURL(`**/my-bookings/${fixtures.completedBooking.id}`, {
      timeout: 30000,
    });
    await page.getByText(`${marker} Blowout`).first().waitFor({ timeout: 30000 });
    report.pastDetailLoaded = true;
    report.policyBlockedActions =
      (await page.getByRole("button", { name: "Reschedule" }).count()) === 0 &&
      (await page.getByRole("button", { name: "Cancel appointment" }).count()) === 0;
    await screenshot(page, report, "m7-past-booking-detail.png");

    await page.goto(`${baseUrl}/my-bookings?tab=cancelled`, { waitUntil: "networkidle" });
    await page.getByText("cancelled").first().waitFor({ timeout: 30000 });
    report.cancelledVisible = true;
  } finally {
    await context.close();
  }
}

async function runMobileAndTabletFlow(browser, fixtures, report) {
  const mobile = await browser.newContext({ viewport: { height: 844, width: 390 } });
  const mobilePage = await mobile.newPage();
  recordPageErrors(mobilePage, report);

  try {
    await login(mobilePage, accountEmail);
    await mobilePage.getByText("pending").waitFor({ timeout: 30000 });
    await screenshot(mobilePage, report, "m7-my-bookings-mobile-list.png");
    await mobilePage.goto(`${baseUrl}/my-bookings/${fixtures.mainBooking.id}`, {
      waitUntil: "networkidle",
    });
    await mobilePage.getByText(`${marker} Root Color`).waitFor({ timeout: 30000 });
    await screenshot(mobilePage, report, "m7-mobile-booking-detail.png");
    report.mobileUiFacts = await mobilePage.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
  } finally {
    await mobile.close();
  }

  const tablet = await browser.newContext({ viewport: { height: 1024, width: 768 } });
  const tabletPage = await tablet.newPage();
  recordPageErrors(tabletPage, report);

  try {
    await login(tabletPage, accountEmail);
    await tabletPage.getByText("pending").waitFor({ timeout: 30000 });
    await screenshot(tabletPage, report, "m7-my-bookings-tablet-list.png");
    report.tabletUiFacts = await tabletPage.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
  } finally {
    await tablet.close();
  }
}

async function runCrossAccountFlow(browser, fixtures, report) {
  const context = await browser.newContext({ viewport: { height: 800, width: 1280 } });
  const page = await context.newPage();
  recordPageErrors(page, report);

  try {
    await login(page, otherEmail);
    const response = await context.request.get(
      `${baseUrl}/my-bookings/${fixtures.mainBooking.id}`,
    );
    const bodyText = await response.text();
    report.crossAccountStatus = response.status();
    report.crossAccountRejected =
      response.status() === 404 ||
      /not found|404/i.test(bodyText);
    report.crossAccountDidNotExposeMarker = !bodyText.includes(marker);
  } finally {
    await context.close();
  }
}

const report = {
  addOnsVisible: false,
  baseUrl,
  breakTimeOffBusyExcluded: false,
  cancelModalWorked: false,
  cancelledVisible: false,
  cancelWorked: false,
  cleanup: null,
  cleanupError: null,
  consoleErrors: [],
  contactChoicesVisible: false,
  contactSalonAvailable: false,
  crossAccountDidNotExposeMarker: false,
  crossAccountRejected: false,
  crossAccountStatus: null,
  error: null,
  fixtures: null,
  inactiveSnapshotVisible: false,
  marker,
  mobileUiFacts: null,
  multiServiceVisible: false,
  networkErrors: [],
  noRawDatetimeInput: false,
  noShowVisible: false,
  ok: false,
  pageErrors: [],
  pastCompletedVisible: false,
  pastDetailLoaded: false,
  pendingVisible: false,
  policyBlockedActions: false,
  rescheduleRaceRejected: false,
  rescheduleValidSlotWorked: false,
  screenshots: [],
  splitProfessionalsVisible: false,
  startedAt: runStartedAt,
  tabletUiFacts: null,
  upcomingConfirmedVisible: false,
  upcomingDetailLoaded: false,
};

let admin;
let browser;
let fixtures;

try {
  await mkdir(artifactsDir, { recursive: true });
  const env = await loadEnv();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? (await loadLinkedServiceRoleKey());

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Supabase public environment is missing.");
  }

  admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  fixtures = await seedFixtures(admin, report);
  await waitForServer();
  browser = await launchBrowser();
  await runCustomerFlow(browser, admin, fixtures, report);
  await runMobileAndTabletFlow(browser, fixtures, report);
  await runCrossAccountFlow(browser, fixtures, report);

  report.ok =
    report.consoleErrors.length === 0 &&
    report.pageErrors.length === 0 &&
    report.networkErrors.length === 0 &&
    report.upcomingConfirmedVisible &&
    report.pendingVisible &&
    report.pastCompletedVisible &&
    report.cancelledVisible &&
    report.noShowVisible &&
    report.multiServiceVisible &&
    report.addOnsVisible &&
    report.splitProfessionalsVisible &&
    report.inactiveSnapshotVisible &&
    report.upcomingDetailLoaded &&
    report.pastDetailLoaded &&
    report.noRawDatetimeInput &&
    report.rescheduleValidSlotWorked &&
    report.rescheduleRaceRejected &&
    report.breakTimeOffBusyExcluded &&
    report.cancelModalWorked &&
    report.cancelWorked &&
    report.policyBlockedActions &&
    report.contactSalonAvailable &&
    report.contactChoicesVisible &&
    report.crossAccountRejected &&
    report.crossAccountDidNotExposeMarker &&
    report.mobileUiFacts?.documentScrollWidth <= report.mobileUiFacts?.innerWidth + 2 &&
    report.mobileUiFacts?.bodyScrollWidth <= report.mobileUiFacts?.innerWidth + 2 &&
    report.tabletUiFacts?.documentScrollWidth <= report.tabletUiFacts?.innerWidth + 2 &&
    report.tabletUiFacts?.bodyScrollWidth <= report.tabletUiFacts?.innerWidth + 2;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (browser) {
    await browser.close().catch(() => {});
  }

  if (admin) {
    await cleanup(admin, fixtures, report).catch((error) => {
      report.cleanupError = error instanceof Error ? error.message : String(error);
    });
  }

  await writeFile(
    path.join(artifactsDir, "my-bookings-m7-qa-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

if (!report.ok) {
  process.exitCode = 1;
}

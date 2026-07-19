import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const artifactsDir = path.resolve("artifacts/booking-browser-test");
const baseUrl = process.env.MY_BOOKINGS_QA_BASE_URL ?? "http://127.0.0.1:3394";
const runStartedAt = new Date().toISOString();
const marker = `My Bookings QA ${new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, "")
  .slice(0, 14)}`;
const slug = marker.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const accountEmail = `${slug}+customer@example.test`;
const otherEmail = `${slug}+other@example.test`;
const accountPassword = "KingPOS-MyBookings-QA-12345!";
const slotDate = new Date(Date.now() + 92 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10);
const originalStartAt = `${slotDate}T15:00:00.000Z`;
const originalEndAt = `${slotDate}T15:45:00.000Z`;
const guestStartAt = `${slotDate}T16:00:00.000Z`;
const guestEndAt = `${slotDate}T16:45:00.000Z`;
const rescheduleInput = `${slotDate}T12:00`;

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

async function seedFixtures(admin, report) {
  const salon = assertOk(
    await admin
      .from("locations")
      .select("id, organization_id, name, phone")
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
  const customerAccount = await createAuthFixture(admin, accountEmail, `${marker} Customer`);
  const otherAccount = await createAuthFixture(admin, otherEmail, "Other My Bookings QA user");

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
        timezone_iana: "America/Chicago",
      },
      { onConflict: "salon_id" },
    );

  const staff = assertOk(
    await admin
      .from("staff")
      .insert({
        display_name: `${marker} Stylist`,
        email: `${slug}+staff@example.test`,
        first_name: "My",
        is_active: true,
        job_title: "Customer booking QA stylist",
        last_name: "Bookings",
        online_booking_enabled: true,
        organization_id: organization.id,
        owner_public_enabled: true,
        phone: "+1555081801",
        profile_display_order: -8701,
        public_profile_visible: true,
        salon_id: salon.id,
        staff_public_consent_status: "granted",
      })
      .select("id, display_name")
      .single(),
    "create staff fixture",
  );
  const service = assertOk(
    await admin
      .from("services")
      .insert({
        base_price: 58,
        category: "My Bookings QA",
        description: `${marker} service`,
        duration_minutes: 45,
        is_active: true,
        name: `${marker} Service`,
        online_booking_enabled: true,
        organization_id: organization.id,
        salon_id: salon.id,
      })
      .select("id, name")
      .single(),
    "create service fixture",
  );
  const assignment = assertOk(
    await admin
      .from("staff_service_assignments")
      .insert({
        is_active: true,
        online_bookable: true,
        organization_id: organization.id,
        salon_id: salon.id,
        service_id: service.id,
        staff_id: staff.id,
      })
      .select("id")
      .single(),
    "create assignment fixture",
  );
  const availability = assertOk(
    await admin
      .from("staff_availability_rules")
      .insert({
        day_of_week: dayOfWeek(slotDate),
        effective_end_date: slotDate,
        effective_start_date: slotDate,
        ends_at_local: "20:00:00",
        is_active: true,
        organization_id: organization.id,
        rule_type: "working",
        salon_id: salon.id,
        staff_id: staff.id,
        starts_at_local: "08:00:00",
        timezone_iana: "America/Chicago",
      })
      .select("id")
      .single(),
    "create availability fixture",
  );
  const customer = assertOk(
    await admin
      .from("customers")
      .insert({
        email: accountEmail,
        location_id: salon.id,
        name: `${marker} Customer`,
        phone: "+1555081802",
        status: "active",
      })
      .select("id")
      .single(),
    "create linked customer fixture",
  );
  const guestCustomer = assertOk(
    await admin
      .from("customers")
      .insert({
        email: `${slug}+guest@example.test`,
        location_id: salon.id,
        name: `${marker} Guest`,
        phone: "+1555081803",
        status: "active",
      })
      .select("id")
      .single(),
    "create guest customer fixture",
  );
  const booking = assertOk(
    await admin
      .from("bookings")
      .insert({
        cancellation_policy_snapshot: {},
        confirmation_mode: "instant_booking",
        confirmation_status: "confirmed",
        created_by_user_id: customerAccount.publicUser.id,
        customer_id: customer.id,
        customer_user_id: customerAccount.publicUser.id,
        end_at: originalEndAt,
        idempotency_key: `${marker} linked booking`,
        organization_id: organization.id,
        payment_status: "not_required",
        salon_id: salon.id,
        salon_timezone_snapshot: "America/Chicago",
        source: "public_profile",
        staff_id: staff.id,
        start_at: originalStartAt,
        status: "confirmed",
      })
      .select("id")
      .single(),
    "create linked booking fixture",
  );
  const guestBooking = assertOk(
    await admin
      .from("bookings")
      .insert({
        cancellation_policy_snapshot: {},
        confirmation_mode: "instant_booking",
        confirmation_status: "confirmed",
        customer_id: guestCustomer.id,
        customer_user_id: null,
        end_at: guestEndAt,
        idempotency_key: `${marker} guest booking`,
        organization_id: organization.id,
        payment_status: "not_required",
        salon_id: salon.id,
        salon_timezone_snapshot: "America/Chicago",
        source: "public_profile",
        staff_id: staff.id,
        start_at: guestStartAt,
        status: "confirmed",
      })
      .select("id")
      .single(),
    "create guest booking fixture",
  );

  assertOk(
    await admin.from("booking_lines").insert([
      {
        assigned_staff_id: staff.id,
        booking_id: booking.id,
        cleanup_buffer_minutes: 0,
        display_order: 0,
        duration_minutes: 45,
        line_type: "service",
        organization_id: organization.id,
        quantity: 1,
        salon_id: salon.id,
        scheduled_end_at: originalEndAt,
        scheduled_start_at: originalStartAt,
        service_id: service.id,
        service_name_snapshot: `${marker} Service`,
        unit_price: 58,
      },
      {
        assigned_staff_id: staff.id,
        booking_id: guestBooking.id,
        cleanup_buffer_minutes: 0,
        display_order: 0,
        duration_minutes: 45,
        line_type: "service",
        organization_id: organization.id,
        quantity: 1,
        salon_id: salon.id,
        scheduled_end_at: guestEndAt,
        scheduled_start_at: guestStartAt,
        service_id: service.id,
        service_name_snapshot: `${marker} Guest Service`,
        unit_price: 58,
      },
    ]),
    "create booking lines",
  );

  const notification = assertOk(
    await admin
      .from("app_notifications")
      .insert({
        body: "Open customer booking detail.",
        booking_id: booking.id,
        href: "/notifications",
        metadata: { marker },
        notification_type: "my_bookings_qa_update",
        organization_id: organization.id,
        recipient_kind: "customer",
        recipient_user_id: customerAccount.publicUser.id,
        salon_id: salon.id,
        source_table: "booking_status_events",
        title: `${marker} Notification`,
      })
      .select("id")
      .single(),
    "create customer notification fixture",
  );

  report.fixtures = {
    assignmentId: assignment.id,
    availabilityId: availability.id,
    bookingId: booking.id,
    customerIds: [customer.id, guestCustomer.id],
    guestBookingId: guestBooking.id,
    notificationId: notification.id,
    publicUserIds: [customerAccount.publicUser.id, otherAccount.publicUser.id],
    salonId: salon.id,
    serviceId: service.id,
    staffId: staff.id,
  };

  return {
    assignment,
    availability,
    booking,
    customer,
    customerAccount,
    guestBooking,
    guestCustomer,
    notification,
    organization,
    otherAccount,
    salon,
    service,
    staff,
  };
}

async function cleanup(admin, fixtures, report) {
  if (!fixtures) {
    return;
  }

  const bookingIds = [fixtures.booking.id, fixtures.guestBooking.id];
  const now = new Date().toISOString();

  await admin.from("app_notifications").delete().in("booking_id", bookingIds);
  await admin
    .from("bookings")
    .update({
      cancellation_reason: "My Bookings browser QA cleanup",
      cancelled_at: now,
      confirmation_status: "cancelled",
      status: "cancelled",
      updated_at: now,
    })
    .in("id", bookingIds);
  await admin.from("app_notifications").delete().in("booking_id", bookingIds);
  await admin
    .from("staff_availability_rules")
    .update({ is_active: false })
    .eq("id", fixtures.availability.id);
  await admin
    .from("staff_service_assignments")
    .update({ is_active: false, online_bookable: false })
    .eq("id", fixtures.assignment.id);
  await admin
    .from("services")
    .update({ is_active: false, online_booking_enabled: false })
    .eq("id", fixtures.service.id);
  await admin
    .from("staff")
    .update({
      is_active: false,
      online_booking_enabled: false,
      owner_public_enabled: false,
      public_profile_visible: false,
    })
    .eq("id", fixtures.staff.id);
  await admin
    .from("customers")
    .update({ status: "inactive" })
    .in("id", [fixtures.customer.id, fixtures.guestCustomer.id]);

  await admin.auth.admin.deleteUser(fixtures.customerAccount.authUser.id).catch(() => {});
  await admin.auth.admin.deleteUser(fixtures.otherAccount.authUser.id).catch(() => {});
  await admin
    .from("users")
    .update({ auth_user_id: null, status: "deleted" })
    .in("email", [accountEmail, otherEmail]);

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
  await page.getByRole("heading", { name: "My Bookings" }).waitFor({
    timeout: 30000,
  });
}

async function runCustomerFlow(browser, admin, fixtures, report) {
  const context = await browser.newContext({ viewport: { height: 900, width: 1440 } });
  const page = await context.newPage();
  recordPageErrors(page, report);

  try {
    await login(page, accountEmail);
    await page.getByText(`${marker} Service`).waitFor({ timeout: 20000 });
    report.upcomingBookingVisible = true;
    report.guestBookingIsolated =
      (await page.getByText(`${marker} Guest Service`).count()) === 0;
    await screenshot(page, report, "my-bookings-upcoming-desktop.png");

    await page.getByRole("link", { name: new RegExp(`${marker} Service`) }).click();
    await page.waitForURL(`**/my-bookings/${fixtures.booking.id}`, { timeout: 20000 });
    await page.getByText(`${marker} Service`).waitFor({ timeout: 20000 });
    report.detailLoaded = true;
    const contactHref = await page.getByRole("link", { name: "Contact salon" }).getAttribute("href");
    report.contactSalonAvailable = Boolean(contactHref?.startsWith("tel:") || contactHref?.startsWith("/explore/salons/"));
    await screenshot(page, report, "my-bookings-detail-desktop.png");

    await page.locator("input[name='start_at']").fill(rescheduleInput);
    await page.getByRole("button", { name: "Reschedule" }).click();
    await page.getByText("Booking rescheduled.").waitFor({ timeout: 30000 });
    const rescheduled = assertOk(
      await admin
        .from("bookings")
        .select("id, start_at")
        .eq("id", fixtures.booking.id)
        .single(),
      "load rescheduled booking",
    );
    report.rescheduleWorked =
      Math.abs(
        new Date(rescheduled.start_at).getTime() -
          new Date(addMinutes(originalStartAt, 120)).getTime(),
      ) < 60 * 1000;

    await page.goto(`${baseUrl}/notifications`, { waitUntil: "networkidle" });
    await page.getByText(`${marker} Notification`).waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Open" }).first().click();
    await page.waitForURL(`**/my-bookings/${fixtures.booking.id}**`, {
      timeout: 20000,
    });
    report.notificationDeepLinkWorked = true;

    await page.getByLabel("Reason").fill("My Bookings QA cancellation");
    await page.getByRole("button", { name: "Cancel booking" }).click();
    await page.getByText("Booking cancelled.").waitFor({ timeout: 30000 });
    report.cancelWorked = true;

    await page.goto(`${baseUrl}/my-bookings?tab=cancelled`, { waitUntil: "networkidle" });
    await page.getByText(`${marker} Service`).waitFor({ timeout: 20000 });
    report.cancelledTabShowsBooking = true;
    await screenshot(page, report, "my-bookings-cancelled-desktop.png");
  } finally {
    await context.close();
  }
}

async function runCrossAccountFlow(browser, fixtures, report) {
  const context = await browser.newContext({ viewport: { height: 800, width: 1280 } });
  const page = await context.newPage();
  recordPageErrors(page, report);

  try {
    await login(page, otherEmail);
    const response = await context.request.get(
      `${baseUrl}/my-bookings/${fixtures.booking.id}`,
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

async function runMobileFlow(browser, fixtures, report) {
  const context = await browser.newContext({ viewport: { height: 844, width: 390 } });
  const page = await context.newPage();
  recordPageErrors(page, report);

  try {
    await login(page, accountEmail);
    await page.goto(`${baseUrl}/my-bookings?tab=cancelled`, { waitUntil: "networkidle" });
    await page.getByText(`${marker} Service`).waitFor({ timeout: 20000 });
    await screenshot(page, report, "my-bookings-cancelled-mobile.png");
    await page.goto(`${baseUrl}/my-bookings/${fixtures.booking.id}`, {
      waitUntil: "networkidle",
    });
    await screenshot(page, report, "my-bookings-detail-mobile.png");
    report.mobileUiFacts = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
  } finally {
    await context.close();
  }
}

const report = {
  baseUrl,
  cancelWorked: false,
  cancelledTabShowsBooking: false,
  cleanup: null,
  cleanupError: null,
  consoleErrors: [],
  contactSalonAvailable: false,
  crossAccountDidNotExposeMarker: false,
  crossAccountRejected: false,
  crossAccountStatus: null,
  detailLoaded: false,
  fixtures: null,
  guestBookingIsolated: false,
  marker,
  mobileUiFacts: null,
  networkErrors: [],
  notificationDeepLinkWorked: false,
  ok: false,
  pageErrors: [],
  rescheduleWorked: false,
  screenshots: [],
  startedAt: runStartedAt,
  upcomingBookingVisible: false,
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
  await runCrossAccountFlow(browser, fixtures, report);
  await runMobileFlow(browser, fixtures, report);

  report.ok =
    report.consoleErrors.length === 0 &&
    report.pageErrors.length === 0 &&
    report.networkErrors.length === 0 &&
    report.upcomingBookingVisible &&
    report.guestBookingIsolated &&
    report.detailLoaded &&
    report.contactSalonAvailable &&
    report.rescheduleWorked &&
    report.notificationDeepLinkWorked &&
    report.cancelWorked &&
    report.cancelledTabShowsBooking &&
    report.crossAccountRejected &&
    report.crossAccountDidNotExposeMarker &&
    report.mobileUiFacts?.documentScrollWidth <= report.mobileUiFacts?.innerWidth + 2 &&
    report.mobileUiFacts?.bodyScrollWidth <= report.mobileUiFacts?.innerWidth + 2;
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
    path.join(artifactsDir, "my-bookings-qa-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

if (!report.ok) {
  process.exitCode = 1;
}

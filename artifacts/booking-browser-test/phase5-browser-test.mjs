import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.PHASE5_BASE_URL ?? "http://127.0.0.1:3337";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const artifactsDir = path.resolve("artifacts/booking-browser-test");

const organizationId = "624cdaca-708c-44e1-b7c4-fff0ced26a63";
const salonId = "ece42ee9-16c2-4dea-a1af-ca4789dcf695";
const staffId = "ff0934c7-b712-458c-b51b-e52221ad0e80";
const marker = `[E2E] Phase5 Browser ${new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, "")
  .slice(0, 14)}`;

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  throw new Error("Supabase browser test environment is missing.");
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assertOk(result, label) {
  if (result.error) {
    throw new Error(`${label}: ${result.error.message}`);
  }
  return result.data;
}

async function createSessionForOwner() {
  const org = assertOk(
    await admin
      .from("organizations")
      .select("owner_user_id")
      .eq("id", organizationId)
      .single(),
    "load owner organization",
  );
  const owner = assertOk(
    await admin
      .from("users")
      .select("email")
      .eq("id", org.owner_user_id)
      .single(),
    "load owner user",
  );
  const link = assertOk(
    await admin.auth.admin.generateLink({
      email: owner.email,
      type: "magiclink",
    }),
    "generate owner magic link",
  );
  const tokenHash = link.properties?.hashed_token;

  if (!tokenHash) {
    throw new Error("Supabase did not return a magic-link token hash.");
  }

  const verified = assertOk(
    await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    }),
    "verify owner magic link",
  );

  if (!verified.session) {
    throw new Error("Owner magic-link verification returned no session.");
  }

  return verified.session;
}

async function seedAppointment() {
  const services = assertOk(
    await admin
      .from("services")
      .select("id, name")
      .eq("salon_id", salonId)
      .in("name", [
        "[E2E] Booking 20260716002831 Gel Manicure",
        "[E2E] Booking 20260716002831 Nail Art Add-on",
      ]),
    "load services",
  );
  const mainService = services.find((service) =>
    service.name.includes("Gel Manicure"),
  );
  const addOnService = services.find((service) =>
    service.name.includes("Nail Art Add-on"),
  );

  if (!mainService || !addOnService) {
    throw new Error("Phase5 browser service fixtures were not found.");
  }

  const customer = assertOk(
    await admin
      .from("customers")
      .insert({
        created_by_user_id: null,
        email: `${marker
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")}@example.test`,
        internal_notes: `${marker} owner-only note`,
        location_id: salonId,
        name: `${marker} Customer`,
        notes: `${marker} customer-safe note`,
        phone: "+1555010600",
        source: "owner_booking",
        staff_notes: `${marker} staff-safe note`,
        status: "active",
        updated_by_user_id: null,
      })
      .select("id")
      .single(),
    "create customer",
  );
  const booking = assertOk(
    await admin
      .from("bookings")
      .insert({
        confirmation_mode: "instant_booking",
        confirmation_status: "confirmed",
        customer_id: customer.id,
        end_at: "2026-08-24T16:00:00.000Z",
        idempotency_key: `${marker} booking`,
        internal_notes: `${marker} internal booking note`,
        organization_id: organizationId,
        public_notes: `${marker} public booking note`,
        salon_id: salonId,
        salon_timezone_snapshot: "America/Chicago",
        source: "owner_manual",
        staff_id: staffId,
        start_at: "2026-08-24T15:00:00.000Z",
        status: "confirmed",
      })
      .select("id")
      .single(),
    "create booking",
  );
  const mainLine = assertOk(
    await admin
      .from("booking_lines")
      .insert({
        assigned_staff_id: staffId,
        booking_id: booking.id,
        display_order: 10,
        duration_minutes: 45,
        line_type: "service",
        organization_id: organizationId,
        quantity: 1,
        salon_id: salonId,
        scheduled_end_at: "2026-08-24T15:45:00.000Z",
        scheduled_start_at: "2026-08-24T15:00:00.000Z",
        service_id: mainService.id,
        service_name_snapshot: `${marker} Main Snapshot`,
        unit_price: 45,
      })
      .select("id")
      .single(),
    "create main line",
  );
  assertOk(
    await admin.from("booking_lines").insert({
      assigned_staff_id: staffId,
      booking_id: booking.id,
      display_order: 20,
      duration_minutes: 15,
      line_type: "add_on",
      organization_id: organizationId,
      parent_booking_line_id: mainLine.id,
      quantity: 1,
      salon_id: salonId,
      scheduled_end_at: "2026-08-24T16:00:00.000Z",
      scheduled_start_at: "2026-08-24T15:45:00.000Z",
      service_id: addOnService.id,
      service_name_snapshot: `${marker} Add-on Snapshot`,
      unit_price: 15,
    }),
    "create add-on line",
  );

  return { bookingId: booking.id, customerId: customer.id };
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

async function cleanup(ids) {
  const ticketId =
    ids.ticketId ??
    assertOk(
      await admin
        .from("bookings")
        .select("pos_ticket_id")
        .eq("id", ids.bookingId)
        .single(),
      "load cleanup ticket id",
    )?.pos_ticket_id;

  if (ticketId) {
    await admin
      .from("pos_tickets")
      .update({ status: "voided" })
      .eq("id", ticketId)
      .eq("salon_id", salonId);
  }

  await admin
    .from("bookings")
    .update({
      cancellation_reason: "Phase5 browser cleanup soft-cancel",
      cancelled_at: new Date().toISOString(),
      cancelled_by_user_id: null,
      confirmation_status: "cancelled",
      status: "cancelled",
    })
    .eq("id", ids.bookingId)
    .eq("salon_id", salonId);
}

const report = {
  baseUrl,
  bookingId: null,
  cleanup: null,
  consoleErrors: [],
  customerId: null,
  marker,
  networkErrors: [],
  ok: false,
  pageErrors: [],
  screenshots: [],
  steps: [],
  ticketId: null,
};

let browser;
let seeded;

try {
  seeded = await seedAppointment();
  report.bookingId = seeded.bookingId;
  report.customerId = seeded.customerId;

  const session = await createSessionForOwner();
  browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: { height: 900, width: 1440 },
  });
  await context.addCookies([
    {
      httpOnly: true,
      name: "sb-access-token",
      sameSite: "Lax",
      url: baseUrl,
      value: session.access_token,
    },
    {
      httpOnly: true,
      name: "sb-refresh-token",
      sameSite: "Lax",
      url: baseUrl,
      value: session.refresh_token,
    },
    {
      name: "kingpos-selected-workspace",
      sameSite: "Lax",
      url: baseUrl,
      value: `manage:${salonId}`,
    },
    {
      name: "kingpos-current-organization-id",
      sameSite: "Lax",
      url: baseUrl,
      value: organizationId,
    },
    {
      name: "kingpos-current-manage-salon-id",
      sameSite: "Lax",
      url: baseUrl,
      value: salonId,
    },
    {
      name: "kingpos-current-salon-id",
      sameSite: "Lax",
      url: baseUrl,
      value: salonId,
    },
  ]);
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") {
      report.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      report.networkErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(
    `${baseUrl}/bookings?date=2026-08-24&bookingId=${seeded.bookingId}`,
    { waitUntil: "networkidle" },
  );
  await page.getByText(`${marker} Customer`).first().waitFor({ timeout: 15000 });
  await page.screenshot({
    path: path.join(artifactsDir, "phase5-owner-booking-detail-desktop.png"),
    fullPage: true,
  });
  report.screenshots.push("phase5-owner-booking-detail-desktop.png");
  report.steps.push({ ownerDetail: "loaded" });

  await page.getByRole("textbox", { name: "Start" }).fill("2026-08-24T10:15");
  await page.getByRole("textbox", { name: "End" }).fill("2026-08-24T11:15");
  await page.getByRole("button", { name: "Save time" }).click();
  await page.getByText("Appointment rescheduled.").waitFor({ timeout: 15000 });
  report.steps.push({ reschedule: "saved" });

  await page.getByRole("button", { name: "Save assignment" }).click();
  await page.getByText("Staff assignment updated.").waitFor({ timeout: 15000 });
  report.steps.push({ reassign: "saved" });

  await page.getByRole("button", { name: "Check in" }).click();
  await page.getByText("Appointment updated.").waitFor({ timeout: 15000 });
  report.steps.push({ statusAction: "checked_in" });

  await page.getByRole("button", { name: "Create POS ticket" }).click();
  await page.getByText("POS ticket is ready.").waitFor({ timeout: 15000 });
  await page.getByRole("link", { name: "Open POS ticket" }).waitFor({
    timeout: 15000,
  });
  report.steps.push({ ticketCreate: "created" });

  const bookingAfterTicket = assertOk(
    await admin
      .from("bookings")
      .select("pos_ticket_id")
      .eq("id", seeded.bookingId)
      .single(),
    "load browser ticket id",
  );
  report.ticketId = bookingAfterTicket.pos_ticket_id;

  await page.getByRole("link", { name: "Open POS ticket" }).click();
  await page.waitForURL(/\/pos-tickets\//, { timeout: 15000 });
  await page.getByText("From appointment", { exact: true }).waitFor({
    timeout: 15000,
  });
  await page.getByText(`${marker} Customer`).first().waitFor({ timeout: 15000 });
  await page.screenshot({
    path: path.join(artifactsDir, "phase5-pos-ticket-detail-desktop.png"),
    fullPage: true,
  });
  report.screenshots.push("phase5-pos-ticket-detail-desktop.png");
  report.steps.push({ posReverseLink: "verified" });

  await page.goto(`${baseUrl}/customers?q=${encodeURIComponent(marker)}`, {
    waitUntil: "networkidle",
  });
  await page.getByText(`${marker} Customer`).first().waitFor({ timeout: 15000 });
  await page.getByText(/1 appts|2 appts|3 appts/).first().waitFor({
    timeout: 15000,
  });
  await page.screenshot({
    path: path.join(artifactsDir, "phase5-customers-list-desktop.png"),
    fullPage: true,
  });
  report.screenshots.push("phase5-customers-list-desktop.png");
  report.steps.push({ customerList: "verified" });

  await page.getByRole("link", { name: "View" }).first().click();
  await page.getByText("Booking History").waitFor({ timeout: 15000 });
  await page.getByText("POS Ticket History").waitFor({ timeout: 15000 });
  await page.screenshot({
    path: path.join(artifactsDir, "phase5-customer-detail-desktop.png"),
    fullPage: true,
  });
  report.screenshots.push("phase5-customer-detail-desktop.png");
  report.steps.push({ customerDetail: "verified" });

  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(
    `${baseUrl}/bookings?date=2026-08-24&bookingId=${seeded.bookingId}`,
    { waitUntil: "networkidle" },
  );
  await page.getByText(`${marker} Customer`).first().waitFor({ timeout: 15000 });
  await page.screenshot({
    path: path.join(artifactsDir, "phase5-owner-booking-mobile.png"),
    fullPage: true,
  });
  report.screenshots.push("phase5-owner-booking-mobile.png");
  report.steps.push({ mobile: "booking detail captured" });

  await cleanup({ ...seeded, ticketId: report.ticketId });
  report.cleanup = "soft-cancelled booking and voided E2E ticket";
  report.ok =
    report.consoleErrors.length === 0 &&
    report.pageErrors.length === 0 &&
    report.networkErrors.length === 0;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (browser) {
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages[0];
    if (page) {
      const failurePath = path.join(artifactsDir, "phase5-browser-failure.png");
      await page.screenshot({ fullPage: true, path: failurePath }).catch(() => {});
      report.screenshots.push("phase5-browser-failure.png");
      report.failureUrl = page.url();
    }
  }
  if (seeded?.bookingId) {
    await cleanup({ ...seeded, ticketId: report.ticketId }).catch(() => {});
    report.cleanup = "attempted cleanup after failure";
  }
} finally {
  await browser?.close();
  await writeFile(
    path.join(artifactsDir, "phase5-browser-report.json"),
    JSON.stringify(report, null, 2),
  );
}

if (!report.ok) {
  throw new Error(report.error ?? "Phase5 browser test failed.");
}

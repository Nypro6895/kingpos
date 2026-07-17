import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const artifactsDir = path.resolve("artifacts/booking-browser-test");
const baseUrl = process.env.GATEC_BASE_URL ?? "http://127.0.0.1:3357";
const salonId = process.env.GATEC_SALON_ID ?? "7f599bc8-a806-4a68-be86-c149c21709e2";
const date = process.env.GATEC_DATE ?? "2026-07-15";
const marker = `GateC ${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
const execFileAsync = promisify(execFile);

function parseDotEnv(raw) {
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();

        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        return [key, value];
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
    env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    maxBuffer: 1024 * 1024,
  });
  const keys = JSON.parse(stdout);
  const serviceRole = keys.find(
    (key) => key.id === "service_role" || key.name === "service_role",
  );

  if (!serviceRole?.api_key || serviceRole.api_key.includes("Â·")) {
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

async function loadOwnerContext(admin) {
  const salon = assertOk(
    await admin
      .from("locations")
      .select("id, organization_id, name")
      .eq("id", salonId)
      .single(),
    "load salon",
  );
  const organization = assertOk(
    await admin
      .from("organizations")
      .select("id, name, owner_user_id")
      .eq("id", salon.organization_id)
      .single(),
    "load organization",
  );
  const owner = assertOk(
    await admin
      .from("users")
      .select("id, email")
      .eq("id", organization.owner_user_id)
      .single(),
    "load owner",
  );

  if (!owner.email) {
    throw new Error("Owner user has no email for magic-link session.");
  }

  return { organization, owner, salon };
}

async function createOwnerSession(env, serviceRoleKey, ownerEmail) {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const link = assertOk(
    await admin.auth.admin.generateLink({
      email: ownerEmail,
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

async function ensureFixtures(admin, context, report) {
  const staff = assertOk(
    await admin
      .from("staff")
      .insert({
        account_user_id: context.owner.id,
        display_name: `${marker} Artist`,
        email: `${marker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.test`,
        first_name: "Parity",
        is_active: true,
        job_title: "Booking artist",
        last_name: "Artist",
        online_booking_enabled: true,
        organization_id: context.organization.id,
        owner_public_enabled: true,
        profile_display_order: -7200,
        public_bio: "Temporary staff profile for booking setup visual verification.",
        public_profile_visible: true,
        salon_id: context.salon.id,
        salon_profile_content_posting_enabled: true,
        specialties: ["Booking"],
        staff_public_consent_status: "granted",
      })
      .select("id")
      .single(),
    "create staff fixture",
  );
  const service = assertOk(
    await admin
      .from("services")
      .insert({
        base_price: 42,
        category: "Booking parity",
        description: "Temporary service for booking setup visual verification.",
        duration_minutes: 35,
        is_active: true,
        name: `${marker} Service`,
        organization_id: context.organization.id,
        salon_id: context.salon.id,
      })
      .select("id")
      .single(),
    "create service fixture",
  );

  report.fixtureIds.staffId = staff.id;
  report.fixtureIds.serviceId = service.id;

  return { serviceId: service.id, staffId: staff.id };
}

async function createAppointmentFixture(admin, context, fixtures, report) {
  const customer = assertOk(
    await admin
      .from("customers")
      .insert({
        created_by_user_id: context.owner.id,
        email: `${marker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}+customer@example.test`,
        location_id: context.salon.id,
        name: `${marker} Customer`,
        phone: "+1555010715",
        source: "owner_booking",
        updated_by_user_id: context.owner.id,
      })
      .select("id")
      .single(),
    "create staff appointment customer fixture",
  );
  const booking = assertOk(
    await admin
      .from("bookings")
      .insert({
        confirmation_mode: "instant_booking",
        confirmation_status: "confirmed",
        created_by_user_id: context.owner.id,
        customer_id: customer.id,
        end_at: "2026-07-15T15:35:00.000Z",
        idempotency_key: `${marker} staff appointment`,
        organization_id: context.organization.id,
        salon_id: context.salon.id,
        salon_timezone_snapshot: "America/Chicago",
        source: "owner_manual",
        staff_id: fixtures.staffId,
        start_at: "2026-07-15T15:00:00.000Z",
        status: "confirmed",
        updated_by_user_id: context.owner.id,
      })
      .select("id")
      .single(),
    "create staff appointment booking fixture",
  );

  assertOk(
    await admin.from("staff_service_assignments").insert({
      is_active: true,
      online_bookable: false,
      organization_id: context.organization.id,
      salon_id: context.salon.id,
      service_id: fixtures.serviceId,
      staff_id: fixtures.staffId,
    }),
    "create staff appointment assignment fixture",
  );

  assertOk(
    await admin.from("booking_lines").insert({
      assigned_staff_id: fixtures.staffId,
      booking_id: booking.id,
      display_order: 1,
      duration_minutes: 35,
      line_type: "service",
      organization_id: context.organization.id,
      quantity: 1,
      salon_id: context.salon.id,
      scheduled_end_at: "2026-07-15T15:35:00.000Z",
      scheduled_start_at: "2026-07-15T15:00:00.000Z",
      service_id: fixtures.serviceId,
      service_name_snapshot: `${marker} Service`,
      unit_price: 42,
    }),
    "create staff appointment booking line fixture",
  );

  report.fixtureIds.bookingId = booking.id;
}

async function cleanupFixtures(admin, report) {
  const { bookingId, serviceId, staffId } = report.fixtureIds;

  if (bookingId) {
    await admin
      .from("bookings")
      .update({
        cancellation_reason: "GateC staff visual cleanup",
        cancelled_at: new Date().toISOString(),
        confirmation_status: "cancelled",
        status: "cancelled",
      })
      .eq("id", bookingId);
  }

  if (staffId || serviceId) {
    let query = admin
      .from("staff_service_assignments")
      .update({ is_active: false, online_bookable: false });

    if (staffId && serviceId) {
      query = query.eq("staff_id", staffId).eq("service_id", serviceId);
    } else if (staffId) {
      query = query.eq("staff_id", staffId);
    } else if (serviceId) {
      query = query.eq("service_id", serviceId);
    }

    await query;
  }

  if (serviceId) {
    await admin.from("services").update({ is_active: false }).eq("id", serviceId);
  }

  if (staffId) {
    await admin
      .from("staff")
      .update({
        is_active: false,
        online_booking_enabled: false,
        owner_public_enabled: false,
        public_profile_visible: false,
      })
      .eq("id", staffId);
  }
}

function recordPageErrors(page, report) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      report.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("response", (response) => {
    const url = response.url();

    if (url.includes(".css")) {
      report.cssResponses.push({
        ok: response.ok(),
        status: response.status(),
        url: url.replace(/\?.*$/, ""),
      });
    }

    if (response.status() >= 500) {
      report.networkErrors.push(`${response.status()} ${url}`);
    }
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();

    if (failure?.errorText !== "net::ERR_ABORTED") {
      report.networkErrors.push(`${failure?.errorText ?? "request failed"} ${request.url()}`);
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

async function screenshotLocator(locator, report, name) {
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({
    path: path.join(artifactsDir, name),
  });
  report.screenshots.push(name);
}

async function setWorkspaceCookies(context, auth, workspace, business) {
  const common = [
    {
      httpOnly: true,
      name: "sb-access-token",
      sameSite: "Lax",
      url: baseUrl,
      value: auth.access_token,
    },
    {
      httpOnly: true,
      name: "sb-refresh-token",
      sameSite: "Lax",
      url: baseUrl,
      value: auth.refresh_token,
    },
    {
      name: "kingpos-current-organization-id",
      sameSite: "Lax",
      url: baseUrl,
      value: business.organization.id,
    },
    {
      name: "kingpos-current-salon-id",
      sameSite: "Lax",
      url: baseUrl,
      value: business.salon.id,
    },
  ];
  const modeCookies =
    workspace === "staff"
      ? [
          {
            name: "kingpos-selected-workspace",
            sameSite: "Lax",
            url: baseUrl,
            value: `staff:${business.salon.id}`,
          },
          {
            name: "kingpos-current-staff-salon-id",
            sameSite: "Lax",
            url: baseUrl,
            value: business.salon.id,
          },
        ]
      : [
          {
            name: "kingpos-selected-workspace",
            sameSite: "Lax",
            url: baseUrl,
            value: `manage:${business.salon.id}`,
          },
          {
            name: "kingpos-current-manage-salon-id",
            sameSite: "Lax",
            url: baseUrl,
            value: business.salon.id,
          },
        ];

  await context.addCookies([...common, ...modeCookies]);
}

async function collectFacts(page) {
  return page.evaluate(() => {
    function style(selector, props) {
      const element = document.querySelector(selector);

      if (!element) {
        return null;
      }

      const computed = getComputedStyle(element);
      return Object.fromEntries(props.map((prop) => [prop, computed.getPropertyValue(prop)]));
    }

    return {
      bookingSetupPanel: style("[data-booking-setup-surface]", [
        "background-color",
        "border-top-color",
        "border-radius",
        "font-family",
      ]),
      staffAppointmentsRoot: style("[data-staff-appointments-surface]", [
        "background-color",
        "font-family",
      ]),
      staffAppointmentsDateDisplay: style(".staff-appointments-date-display", [
        "border-radius",
        "display",
        "font-family",
        "min-height",
      ]),
      staffAppointmentsView: style(".staff-appointments-view-tab[aria-current='page']", [
        "background-color",
        "color",
      ]),
      toolbarText:
        document.querySelector(".staff-appointments-toolbar")?.textContent?.trim() ?? null,
      url: window.location.href,
      visibleDateInputs: Array.from(
        document.querySelectorAll(".staff-appointments-toolbar input[type='date']"),
      ).filter((element) => {
        const rect = element.getBoundingClientRect();
        const computed = getComputedStyle(element);

        return rect.width > 1 && rect.height > 1 && computed.display !== "none";
      }).length,
    };
  });
}

const report = {
  baseUrl,
  consoleErrors: [],
  cssResponses: [],
  date,
  fixtureIds: {},
  networkErrors: [],
  ok: false,
  pageErrors: [],
  salonId,
  screenshots: [],
  styleFacts: {},
};

let admin;
let browser;

try {
  await mkdir(artifactsDir, { recursive: true });
  const env = await loadEnv();

  if (
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    env.SUPABASE_SERVICE_ROLE_KEY = await loadLinkedServiceRoleKey();
  }

  admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const business = await loadOwnerContext(admin);
  const session = await createOwnerSession(
    env,
    env.SUPABASE_SERVICE_ROLE_KEY,
    business.owner.email,
  );
  const fixtures = await ensureFixtures(admin, business, report);

  report.organizationId = business.organization.id;
  report.organizationName = business.organization.name;
  report.salonName = business.salon.name;

  browser = await launchBrowser();
  const context = await browser.newContext({ viewport: { height: 941, width: 1610 } });
  const page = await context.newPage();
  recordPageErrors(page, report);

  await setWorkspaceCookies(context, session, "staff", business);
  await page.goto(`${baseUrl}/staff/appointments?date=${date}&view=list`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("heading", { name: "Staff Appointments" }).waitFor({ timeout: 15000 });
  await screenshot(page, report, "gateC-staff-appointments-list-empty.png");

  await createAppointmentFixture(admin, business, fixtures, report);
  await page.goto(`${baseUrl}/staff/appointments?date=${date}&view=list`, {
    waitUntil: "networkidle",
  });
  await page
    .locator(".staff-appointments-card")
    .filter({ hasText: `${marker} Customer` })
    .first()
    .waitFor({ timeout: 15000 });
  await screenshot(page, report, "gateC-staff-appointments-list.png");
  report.styleFacts.staffAppointments = await collectFacts(page);

  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(`${baseUrl}/staff/appointments?date=${date}&view=list`, {
    waitUntil: "networkidle",
  });
  await screenshot(page, report, "gateC-staff-appointments-mobile.png");

  await page.setViewportSize({ height: 941, width: 1610 });
  await setWorkspaceCookies(context, session, "manage", business);
  await page.goto(`${baseUrl}/staff?staff=${fixtures.staffId}&setup=booking`, {
    waitUntil: "networkidle",
  });
  const staffServicesPanel = page.locator('[data-booking-setup-surface="staff-services"]');
  await page.getByRole("heading", { name: "Services & booking" }).waitFor({ timeout: 15000 });
  await screenshotLocator(
    staffServicesPanel,
    report,
    "gateC-staff-services-booking-editor-panel.png",
  );
  report.styleFacts.staffServicesEditor = await collectFacts(page);

  await page.goto(`${baseUrl}/services?service=${fixtures.serviceId}&setup=bookable_staff`, {
    waitUntil: "networkidle",
  });
  const bookableStaffPanel = page.locator('[data-booking-setup-surface="bookable-staff"]');
  await page.getByRole("heading", { name: "Bookable staff" }).waitFor({ timeout: 15000 });
  await screenshotLocator(
    bookableStaffPanel,
    report,
    "gateC-service-bookable-staff-editor-panel.png",
  );
  report.styleFacts.serviceBookableStaff = await collectFacts(page);

  await page.goto(`${baseUrl}/bookings?tab=availability&staffId=${fixtures.staffId}`, {
    waitUntil: "networkidle",
  });
  const availabilityPanel = page.locator('[data-booking-setup-surface="availability"]');
  await page.getByRole("heading", { name: "Staff availability" }).waitFor({ timeout: 15000 });
  await screenshotLocator(availabilityPanel, report, "gateC-owner-availability-editor-panel.png");
  report.styleFacts.availabilityEditor = await collectFacts(page);

  report.ok =
    report.consoleErrors.length === 0 &&
    report.pageErrors.length === 0 &&
    report.networkErrors.length === 0 &&
    report.cssResponses.every((response) => response.ok) &&
    report.styleFacts.staffAppointments.staffAppointmentsRoot?.["background-color"] ===
      "rgb(247, 247, 248)" &&
    report.styleFacts.staffAppointments.staffAppointmentsView?.["background-color"] ===
      "rgb(100, 42, 86)" &&
    ["flex", "inline-flex"].includes(
      report.styleFacts.staffAppointments.staffAppointmentsDateDisplay?.display ?? "",
    ) &&
    report.styleFacts.staffAppointments.staffAppointmentsDateDisplay?.["min-height"] ===
      "40px" &&
    report.styleFacts.staffAppointments.visibleDateInputs === 0 &&
    !/\bGo\b/.test(report.styleFacts.staffAppointments.toolbarText ?? "") &&
    ["staffServicesEditor", "serviceBookableStaff", "availabilityEditor"].every(
      (key) =>
        report.styleFacts[key].bookingSetupPanel?.["background-color"] ===
          "rgb(255, 255, 255)" &&
        report.styleFacts[key].bookingSetupPanel?.["border-radius"] === "14px",
    );
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (browser) {
    const page = browser.contexts().flatMap((item) => item.pages())[0];

    if (page) {
      const failurePath = path.join(artifactsDir, "gateC-staff-setup-failure.png");
      await page.screenshot({ fullPage: true, path: failurePath }).catch(() => {});
      report.screenshots.push("gateC-staff-setup-failure.png");
      report.failureUrl = page.url();
    }
  }
} finally {
  if (browser) {
    await browser.close();
  }

  if (admin) {
    await cleanupFixtures(admin, report);
  }

  await writeFile(
    path.join(artifactsDir, "gateC-staff-setup-visual-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (!report.ok) {
    process.exitCode = 1;
  }
}

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const artifactsDir = path.resolve("artifacts/booking-browser-test");
const baseUrl = process.env.PROFESSIONAL_QA_BASE_URL ?? "http://127.0.0.1:3390";
const salonId =
  process.env.PROFESSIONAL_QA_SALON_ID ??
  "7f599bc8-a806-4a68-be86-c149c21709e2";
const slotDate = process.env.PROFESSIONAL_QA_DATE ?? "2026-07-20";
const marker = `Professional QA ${new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, "")
  .slice(0, 14)}`;

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

function pngAvatar() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAACAklEQVR42u2dvXnDMAwFMU/GSaEJMoNHyZAuXbh1qjT+/CPKAN8jeQVaFHeNBIBAXM7XG6GLAAICEEAgAAEEAhBAIAABbvHzte2O3+/Tw0BAQ/xDawH/Cr67kHCC3gP+ff6lBbyDUw3fQUS4gFfCV4oIB/Au8BUiAvjP808jYET4vSSECvwI8HuICODvzz+MgBnhV0kI4LfntxWwAvzsz9QA/vH8NgJWhJ8lIVb/zv80v1zAyvAzJATwtbWjAL62dhQzlpRV+bsJAP7z/DIBwO8kAPhbar0oRmqgz1g1DeBrq6aHBQBfKAD4eSXrAL62ZN0kAPht+VMFAL+mX1AiAPjJAoBf1y9IFQB8oQDgCwUAXygA+EIBwH+fv0wA8HPalIcEAD+vTdksAPi57wuaBAA/v0e8WwDwa3rEkTH7CfyTjwDgCwUAXygA+EIBwBcKAH4HAUzE1Y2mBENZ2tGUYCirLj9zQTPNBTGaUvOOuEwAQ1lCAdSOtrr3AcDPfUGfKgD4HQTQI87dvpgiAPidBdCmzHst/5EA4AsF0CkT74qgWWOwLYV+gfnCJub/hTvjgC/cmgh84d5Q4BtszgW+we5o4BtsTwe+yf2Alb/zbS5oAN/8hsyK8O2uKM2wC5o7YtwRG+sPmlOGgp84bkl2HgDgmiqBAAQQCEAAgQAEEAhwij/L4UYTeb9fagAAAABJRU5ErkJggg==",
    "base64",
  );
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

async function seedFixtures(admin, report) {
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

  await admin
    .from("staff")
    .update({
      is_active: false,
      online_booking_enabled: false,
      owner_public_enabled: false,
      public_profile_visible: false,
    })
    .eq("salon_id", salon.id)
    .like("display_name", "Professional QA %");
  await admin
    .from("services")
    .update({ is_active: false, online_booking_enabled: false })
    .eq("salon_id", salon.id)
    .like("name", "Professional QA %");

  await admin
    .from("booking_settings")
    .upsert(
      {
        any_professional_enabled: true,
        booking_enabled: true,
        confirmation_mode: "instant_booking",
        default_cleanup_buffer_minutes: 0,
        guest_booking_enabled: true,
        maximum_advance_window_days: 30,
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

  await admin
    .from("salon_profile_settings")
    .upsert(
      {
        business_name: salon.name,
        organization_id: organization.id,
        public_discovery_enabled: true,
        public_discovery_published_at: new Date().toISOString(),
        salon_id: salon.id,
      },
      { onConflict: "salon_id" },
    );

  const staffRows = assertOk(
    await admin
      .from("staff")
      .insert([
        {
          display_name: `${marker} Avery Stone`,
          email: `${marker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}+avery@example.test`,
          first_name: "Avery",
          is_active: true,
          job_title: "Lead nail artist",
          last_name: "Stone",
          online_booking_enabled: true,
          organization_id: organization.id,
          owner_public_enabled: true,
          phone: "+1555018101",
          profile_display_order: -8103,
          public_bio: "Precision gel work and clean finishes.",
          public_profile_visible: true,
          salon_id: salon.id,
          salon_profile_content_posting_enabled: true,
          specialties: ["Gel", "Art"],
          staff_public_consent_status: "granted",
        },
        {
          display_name: `${marker} Mina Chen`,
          email: `${marker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}+mina@example.test`,
          first_name: "Mina",
          is_active: true,
          job_title: "Pedicure specialist",
          last_name: "Chen",
          online_booking_enabled: true,
          organization_id: organization.id,
          owner_public_enabled: true,
          phone: "+1555018102",
          profile_display_order: -8102,
          public_bio: "Detailed care with a calm pace.",
          public_profile_photo_path: null,
          public_profile_visible: true,
          salon_id: salon.id,
          salon_profile_content_posting_enabled: true,
          specialties: ["Pedicure"],
          staff_public_consent_status: "granted",
        },
        {
          display_name: `${marker} Noah Blocked`,
          email: `${marker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}+noah@example.test`,
          first_name: "Noah",
          is_active: true,
          job_title: "Fully booked artist",
          last_name: "Blocked",
          online_booking_enabled: true,
          organization_id: organization.id,
          owner_public_enabled: true,
          phone: "+1555018103",
          profile_display_order: -8101,
          public_bio: "Fixture staff with no openings.",
          public_profile_visible: true,
          salon_id: salon.id,
          salon_profile_content_posting_enabled: false,
          specialties: ["Busy"],
          staff_public_consent_status: "granted",
        },
      ])
      .select("id, display_name"),
    "create staff fixtures",
  );
  const staffByName = new Map(staffRows.map((staff) => [staff.display_name, staff]));
  const avery = staffRows[0];
  const mina = staffRows[1];
  const noah = staffRows[2];
  const avatarPath = `${salon.id}/staff/${avery.id}/avatar/${crypto.randomUUID()}.png`;

  assertOk(
    await admin.storage
      .from("salon-profile-media")
      .upload(avatarPath, pngAvatar(), {
        contentType: "image/png",
        upsert: true,
      }),
    "upload staff avatar",
  );
  await assertOk(
    await admin
      .from("staff")
      .update({ public_profile_photo_path: avatarPath })
      .eq("id", avery.id)
      .select("id")
      .single(),
    "attach staff avatar",
  );

  const services = assertOk(
    await admin
      .from("services")
      .insert([
        {
          base_price: 52,
          category: "Professional QA",
          description: `${marker} gel manicure for Professional step QA.`,
          duration_minutes: 45,
          is_active: true,
          name: `${marker} Gel Manicure`,
          online_booking_enabled: true,
          organization_id: organization.id,
          salon_id: salon.id,
        },
        {
          base_price: 64,
          category: "Professional QA",
          description: `${marker} pedicure for split Professional QA.`,
          duration_minutes: 50,
          is_active: true,
          name: `${marker} Spa Pedicure`,
          online_booking_enabled: true,
          organization_id: organization.id,
          salon_id: salon.id,
        },
        {
          base_price: 18,
          category: "Professional QA",
          description: `${marker} add-on duration check.`,
          duration_minutes: 20,
          is_active: true,
          name: `${marker} Line Art Accent`,
          online_booking_enabled: true,
          organization_id: organization.id,
          salon_id: salon.id,
        },
      ])
      .select("id, name"),
    "create services",
  );
  const gel = services[0];
  const pedicure = services[1];
  const addOn = services[2];

  assertOk(
    await admin.from("staff_service_assignments").insert(
      staffRows.flatMap((staff) =>
        services.map((service) => ({
          is_active: true,
          online_bookable: true,
          organization_id: organization.id,
          salon_id: salon.id,
          service_id: service.id,
          staff_id: staff.id,
        })),
      ),
    ),
    "create staff assignments",
  );
  const addOnLink = assertOk(
    await admin
      .from("service_add_on_links")
      .insert({
        add_on_service_id: addOn.id,
        display_order: -8100,
        is_active: true,
        organization_id: organization.id,
        parent_service_id: gel.id,
        salon_id: salon.id,
      })
      .select("id")
      .single(),
    "create add-on link",
  );
  const availability = assertOk(
    await admin
      .from("staff_availability_rules")
      .insert(
        staffRows.flatMap((staff) => [
          {
            day_of_week: 1,
            effective_end_date: slotDate,
            effective_start_date: slotDate,
            ends_at_local: "17:00:00",
            is_active: true,
            organization_id: organization.id,
            rule_type: "working",
            salon_id: salon.id,
            staff_id: staff.id,
            starts_at_local: "09:00:00",
            timezone_iana: "America/Chicago",
          },
          {
            day_of_week: 1,
            effective_end_date: slotDate,
            effective_start_date: slotDate,
            ends_at_local: "13:00:00",
            is_active: true,
            organization_id: organization.id,
            rule_type: "break",
            salon_id: salon.id,
            staff_id: staff.id,
            starts_at_local: "12:00:00",
            timezone_iana: "America/Chicago",
          },
        ]),
      )
      .select("id"),
    "create availability",
  );
  const timeBlocks = assertOk(
    await admin
      .from("staff_time_blocks")
      .insert([
        {
          block_type: "time_off",
          ends_at: "2026-07-20T15:00:00.000Z",
          is_active: true,
          organization_id: organization.id,
          reason: `${marker} morning time off`,
          salon_id: salon.id,
          staff_id: avery.id,
          starts_at: "2026-07-20T14:00:00.000Z",
          timezone_iana: "America/Chicago",
        },
        {
          block_type: "blocked",
          ends_at: "2026-08-18T05:00:00.000Z",
          is_active: true,
          organization_id: organization.id,
          reason: `${marker} no public openings`,
          salon_id: salon.id,
          staff_id: noah.id,
          starts_at: "2026-07-18T05:00:00.000Z",
          timezone_iana: "America/Chicago",
        },
      ])
      .select("id"),
    "create time blocks",
  );
  report.activeGlobalBlocks = assertOk(
    await admin
      .from("staff_time_blocks")
      .select("id, starts_at, ends_at, reason")
      .eq("salon_id", salon.id)
      .eq("is_active", true)
      .is("staff_id", null)
      .lt("starts_at", "2026-07-21T05:00:00.000Z")
      .gt("ends_at", "2026-07-20T05:00:00.000Z"),
    "load active global blocks",
  );
  report.directAvailability = {
    avery1045: assertOk(
      await admin.rpc("public_staff_line_is_available", {
        p_end_at: "2026-07-20T16:30:00.000Z",
        p_ignore_booking_id: null,
        p_organization_id: organization.id,
        p_salon_id: salon.id,
        p_staff_id: avery.id,
        p_start_at: "2026-07-20T15:45:00.000Z",
        p_timezone_iana: "America/Chicago",
      }),
      "check Avery availability",
    ),
    mina0900: assertOk(
      await admin.rpc("public_staff_line_is_available", {
        p_end_at: "2026-07-20T14:45:00.000Z",
        p_ignore_booking_id: null,
        p_organization_id: organization.id,
        p_salon_id: salon.id,
        p_staff_id: mina.id,
        p_start_at: "2026-07-20T14:00:00.000Z",
        p_timezone_iana: "America/Chicago",
      }),
      "check Mina availability",
    ),
  };
  const rawContext = assertOk(
    await admin.rpc("get_public_booking_context", {
      p_range_end: "2026-08-18T05:00:00.000Z",
      p_range_start: new Date().toISOString(),
      target_salon_id: salon.id,
    }),
    "load public booking context",
  );
  const markerServices = (rawContext.services ?? []).filter((service) =>
    String(service.name ?? "").includes(marker),
  );
  const markerStaff = (rawContext.staff ?? []).filter((staff) =>
    String(staff.display_name ?? "").includes(marker),
  );
  const markerStaffIds = new Set(markerStaff.map((staff) => staff.id));
  report.contextDebug = {
    assignmentCount: (rawContext.assignments ?? []).filter((assignment) =>
      markerStaffIds.has(assignment.staff_id),
    ).length,
    markerServices: markerServices.map((service) => ({
      id: service.id,
      name: service.name,
    })),
    markerStaff: markerStaff.map((staff) => ({
      avatarPath: staff.avatar_path ?? null,
      id: staff.id,
      name: staff.display_name,
    })),
    state: rawContext.state,
    timeBlockCount: (rawContext.time_blocks ?? []).filter((block) =>
      !block.staff_id || markerStaffIds.has(block.staff_id),
    ).length,
    workingRuleCount: (rawContext.availability_rules ?? []).filter(
      (rule) => rule.rule_type === "working" && markerStaffIds.has(rule.staff_id),
    ).length,
  };
  const customer = assertOk(
    await admin
      .from("customers")
      .insert({
        email: `${marker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}+busy@example.test`,
        location_id: salon.id,
        name: `${marker} Busy Customer`,
        phone: "+1555018199",
        source: "owner_booking",
      })
      .select("id")
      .single(),
    "create busy customer",
  );
  const booking = assertOk(
    await admin
      .from("bookings")
      .insert({
        confirmation_mode: "instant_booking",
        confirmation_status: "confirmed",
        customer_id: customer.id,
        end_at: "2026-07-20T15:45:00.000Z",
        idempotency_key: `${marker} busy`,
        organization_id: organization.id,
        salon_id: salon.id,
        salon_timezone_snapshot: "America/Chicago",
        source: "owner_manual",
        staff_id: avery.id,
        start_at: "2026-07-20T15:00:00.000Z",
        status: "confirmed",
      })
      .select("id")
      .single(),
    "create busy booking",
  );
  assertOk(
    await admin.from("booking_lines").insert({
      assigned_staff_id: avery.id,
      booking_id: booking.id,
      display_order: 0,
      duration_minutes: 45,
      line_type: "service",
      organization_id: organization.id,
      quantity: 1,
      salon_id: salon.id,
      scheduled_end_at: "2026-07-20T15:45:00.000Z",
      scheduled_start_at: "2026-07-20T15:00:00.000Z",
      service_id: gel.id,
      service_name_snapshot: gel.name,
      unit_price: 52,
    }),
    "create busy booking line",
  );

  report.fixtureIds = {
    addOnLink: addOnLink.id,
    avatarPath,
    booking: booking.id,
    services: services.map((service) => service.id),
    staff: staffRows.map((staff) => staff.id),
    staffByName,
    timeBlocks: timeBlocks.map((block) => block.id),
    availabilityRules: availability.map((rule) => rule.id),
  };

  return {
    addOn,
    addOnLink,
    avatarPath,
    booking,
    gel,
    mina,
    noah,
    pedicure,
    services,
    staffRows,
    timeBlocks,
    availability,
  };
}

async function cleanup(admin, fixtures) {
  if (!fixtures) {
    return;
  }

  await admin
    .from("bookings")
    .update({
      cancellation_reason: "Professional public booking QA cleanup",
      cancelled_at: new Date().toISOString(),
      confirmation_status: "cancelled",
      status: "cancelled",
    })
    .eq("id", fixtures.booking.id);
  await admin
    .from("staff_time_blocks")
    .update({ is_active: false, cancelled_at: new Date().toISOString() })
    .in("id", fixtures.timeBlocks.map((block) => block.id));
  await admin
    .from("staff_availability_rules")
    .update({ is_active: false })
    .in("id", fixtures.availability.map((rule) => rule.id));
  await admin
    .from("service_add_on_links")
    .update({ is_active: false })
    .eq("id", fixtures.addOnLink.id);
  await admin
    .from("staff_service_assignments")
    .update({ is_active: false, online_bookable: false })
    .in("staff_id", fixtures.staffRows.map((staff) => staff.id));
  await admin
    .from("services")
    .update({ is_active: false, online_booking_enabled: false })
    .in("id", fixtures.services.map((service) => service.id));
  await admin
    .from("staff")
    .update({
      is_active: false,
      online_booking_enabled: false,
      owner_public_enabled: false,
      public_profile_visible: false,
    })
    .in("id", fixtures.staffRows.map((staff) => staff.id));
  await admin.storage
    .from("salon-profile-media")
    .remove([fixtures.avatarPath])
    .catch(() => {});
}

async function runBrowser(fixtures, report) {
  const browser = await launchBrowser();

  try {
    const context = await browser.newContext({
      viewport: { height: 900, width: 1440 },
    });
    const page = await context.newPage();
    recordPageErrors(page, report);

    await page.goto(
      `${baseUrl}/book/${salonId}?serviceId=${fixtures.gel.id}&date=${slotDate}`,
      { waitUntil: "networkidle" },
    );
    await page.getByRole("heading", { name: "Choose your services" }).waitFor({
      timeout: 20000,
    });

    await page.getByRole("button", { name: "Next: Choose professional" }).click();
    await page.getByRole("heading", { name: "Choose your professional" }).waitFor({
      timeout: 20000,
    });
    await page.waitForTimeout(3000);
    report.professionalStepText = await page
      .getByTestId("public-booking-content")
      .textContent();
    await screenshot(page, report, "professional-debug-professional-step.png");
    await page.getByText(marker, { exact: false }).first().waitFor({
      timeout: 20000,
    });
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll(".public-booking-professional-next")).some(
          (element) => /Next available|No openings/.test(element.textContent ?? ""),
        ),
      null,
      {
        timeout: 30000,
      },
    );
    report.availabilityText = await page
      .locator(".public-booking-professional-next")
      .evaluateAll((elements) => elements.map((element) => element.textContent ?? ""));
    report.nextAvailableCount = report.availabilityText.filter((text) =>
      text.includes("Next available"),
    ).length;
    report.noOpeningCount = report.availabilityText.filter((text) =>
      text.includes("No openings"),
    ).length;
    if (report.nextAvailableCount === 0) {
      throw new Error("Professional QA expected at least one next-available hint.");
    }
    await page.getByText("No openings in the next 30 days").waitFor({
      timeout: 30000,
    });
    await screenshot(page, report, "professional-desktop-any-staff-grid.png");

    await page
      .locator("label")
      .filter({ hasText: fixtures.mina.display_name })
      .first()
      .click();
    await screenshot(page, report, "professional-desktop-selected-staff.png");
    await page
      .locator("label")
      .filter({ hasText: fixtures.mina.display_name })
      .first()
      .screenshot({
        path: path.join(artifactsDir, "professional-avatar-fallback-state.png"),
      });
    report.screenshots.push("professional-avatar-fallback-state.png");

    await page.getByRole("button", { name: /Services/ }).click();
    await page
      .locator("[data-testid='public-booking-addon-panel'] label")
      .filter({ hasText: fixtures.addOn.name })
      .first()
      .click();
    await page
      .locator("[data-testid='public-booking-service-card']")
      .filter({ hasText: fixtures.pedicure.name })
      .first()
      .click();
    await page.getByRole("button", { name: "Next: Choose professional" }).click();
    await page.getByRole("heading", { name: "Choose your professional" }).waitFor();
    await page.getByText("Split by service").waitFor({ timeout: 20000 });
    await page.waitForFunction(
      () =>
        Array.from(
          document.querySelectorAll(
            ".public-booking-professional-split-panel .public-booking-professional-next",
          ),
        ).some((element) => /Next available|No openings/.test(element.textContent ?? "")),
      null,
      {
        timeout: 30000,
      },
    );
    await screenshot(page, report, "professional-desktop-split-by-service.png");

    await page.setViewportSize({ height: 844, width: 390 });
    await page.waitForTimeout(200);
    await screenshot(page, report, "professional-mobile-list.png");
    await page
      .locator("label")
      .filter({ hasText: fixtures.mina.display_name })
      .first()
      .click();
    await screenshot(page, report, "professional-mobile-selected-state.png");

    report.uiFacts = await page.evaluate(() => {
      const body = document.body;
      const html = document.documentElement;
      const professionalCards = Array.from(
        document.querySelectorAll(".public-booking-professional-option"),
      ).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: rect.height,
          text: element.textContent?.trim().slice(0, 120) ?? "",
          width: rect.width,
        };
      });

      return {
        bodyScrollWidth: body.scrollWidth,
        cardCount: professionalCards.length,
        documentScrollWidth: html.scrollWidth,
        innerWidth: window.innerWidth,
        professionalCards,
      };
    });
  } finally {
    await browser.close();
  }
}

const report = {
  baseUrl,
  consoleErrors: [],
  fixtureIds: null,
  marker,
  networkErrors: [],
  nextAvailableCount: 0,
  noOpeningCount: 0,
  ok: false,
  pageErrors: [],
  professionalStepText: null,
  screenshots: [],
  uiFacts: null,
};

let admin;
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
  await runBrowser(fixtures, report);

  report.ok =
    report.consoleErrors.length === 0 &&
    report.pageErrors.length === 0 &&
    report.networkErrors.length === 0 &&
    report.nextAvailableCount > 0 &&
    report.noOpeningCount > 0 &&
    report.uiFacts?.documentScrollWidth <= report.uiFacts?.innerWidth + 2 &&
    report.uiFacts?.bodyScrollWidth <= report.uiFacts?.innerWidth + 2;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (admin && fixtures) {
    await cleanup(admin, fixtures).catch((error) => {
      report.cleanupError = error instanceof Error ? error.message : String(error);
    });
  }

  await writeFile(
    path.join(artifactsDir, "professional-public-booking-qa-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

if (!report.ok) {
  process.exitCode = 1;
}

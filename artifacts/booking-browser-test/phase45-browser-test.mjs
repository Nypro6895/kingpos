import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const baseUrl = process.env.PHASE45_BASE_URL ?? "http://127.0.0.1:3337";
const artifactsDir = path.resolve("artifacts/booking-browser-test");
const organizationId = "387af6da-69bb-45dc-bf25-5954a1d10ded";
const salonId = "7f599bc8-a806-4a68-be86-c149c21709e2";
const timezone = "America/Chicago";
const slotDate = "2026-07-20";
const marker = `[E2E] Phase45 Browser ${new Date()
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

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "kingpos-phase45-"));
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
    const { stdout } = await execFileAsync(
      command,
      args,
      {
        env: {
          ...process.env,
          SUPABASE_TELEMETRY_DISABLED: "1",
        },
        maxBuffer: 1024 * 1024 * 4,
      },
    );
    return extractJson(stdout).rows ?? [];
  } finally {
    await unlink(filePath).catch(() => {});
  }
}

function assertOk(result, label) {
  if (result.error) {
    const details = [
      result.error.name,
      result.error.message,
      result.error.status ? `status ${result.error.status}` : null,
      result.error.code ? `code ${result.error.code}` : null,
    ]
      .filter(Boolean)
      .join(" / ");
    throw new Error(`${label}: ${details || JSON.stringify(result.error)}`);
  }
  return result.data;
}

async function createSession(env) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error("Supabase public environment is missing.");
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const slug = slugify(marker);
  const email = `${slug}@example.com`;
  const password = `Phase45!${Date.now()}Aa`;

  await runSql(`
    with auth_seed as (
      select
        gen_random_uuid() as id,
        ${sqlLiteral(email)}::text as email,
        ${sqlLiteral(`${marker} Owner`)}::text as display_name
    ),
    inserted_auth as (
      insert into auth.users (
        aud,
        confirmation_token,
        created_at,
        email,
        email_change,
        email_change_confirm_status,
        email_change_token_current,
        email_change_token_new,
        email_confirmed_at,
        encrypted_password,
        id,
        instance_id,
        is_anonymous,
        is_sso_user,
        raw_app_meta_data,
        raw_user_meta_data,
        reauthentication_token,
        recovery_token,
        role,
        updated_at
      )
      select
        'authenticated',
        '',
        now(),
        auth_seed.email,
        '',
        0,
        '',
        '',
        now(),
        crypt(${sqlLiteral(password)}, gen_salt('bf')),
        auth_seed.id,
        coalesce(
          (select instance_id from auth.users where instance_id is not null limit 1),
          '00000000-0000-0000-0000-000000000000'::uuid
        ),
        false,
        false,
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object(
          'display_name',
          auth_seed.display_name,
          'email',
          auth_seed.email,
          'email_verified',
          true,
          'phone_verified',
          false,
          'sub',
          auth_seed.id::text
        ),
        '',
        '',
        'authenticated',
        now()
      from auth_seed
      returning id, email, raw_user_meta_data->>'display_name' as display_name
    ),
    inserted_identity as (
      insert into auth.identities (
        created_at,
        identity_data,
        last_sign_in_at,
        provider,
        provider_id,
        user_id,
        updated_at
      )
      select
        now(),
        jsonb_build_object(
          'sub',
          id::text,
          'email',
          email,
          'email_verified',
          true,
          'phone_verified',
          false
        ),
        now(),
        'email',
        id::text,
        id,
        now()
      from inserted_auth
      returning id
    ),
    upsert_user as (
      insert into public.users (
        auth_user_id,
        display_name,
        email,
        language,
        status,
        timezone
      )
      select
        id,
        coalesce(nullif(display_name, ''), email),
        email,
        'en',
        'active',
        ${sqlLiteral(timezone)}
      from inserted_auth
      on conflict (auth_user_id) do update
      set display_name = excluded.display_name,
          email = excluded.email,
          status = 'active',
          updated_at = now()
      returning id, auth_user_id, email
    ),
    owner_role as (
      select id
      from public.roles
      where organization_id = ${sqlLiteral(organizationId)}::uuid
        and code = 'OWNER'
      limit 1
    ),
    upsert_membership as (
      insert into public.organization_memberships (
        organization_id,
        role,
        role_id,
        status,
        user_id,
        joined_at
      )
      select
        ${sqlLiteral(organizationId)}::uuid,
        'owner',
        owner_role.id,
        'active',
        upsert_user.id,
        now()
      from upsert_user
      cross join owner_role
      on conflict (organization_id, user_id) do update
      set role = 'owner',
          role_id = excluded.role_id,
          status = 'active',
          joined_at = coalesce(public.organization_memberships.joined_at, now()),
          updated_at = now()
      returning id
    )
    select
      upsert_user.id as public_user_id,
      upsert_user.auth_user_id,
      upsert_membership.id as membership_id
    from upsert_user
    cross join upsert_membership;
  `);

  const signin = assertOk(
    await anon.auth.signInWithPassword({ email, password }),
    "sign in owner",
  );

  if (!signin.session) {
    throw new Error("Owner sign-in returned no session.");
  }

  return { email, session: signin.session };
}

async function seedFixtures() {
  const staffName = `000 ${marker} Staff`;
  const serviceAName = `000 ${marker} Gel Manicure`;
  const serviceBName = `000 ${marker} Pedicure`;
  const rows = await runSql(`
    with staff_row as (
      insert into public.staff (
        display_name,
        email,
        first_name,
        is_active,
        job_title,
        last_name,
        online_booking_enabled,
        organization_id,
        owner_public_enabled,
        phone,
        profile_display_order,
        public_bio,
        public_profile_visible,
        salon_id,
        salon_profile_content_posting_enabled,
        specialties,
        staff_public_consent_status
      )
      values (
        ${sqlLiteral(staffName)},
        ${sqlLiteral(slugify(marker) + "@staff.example.test")},
        'Phase45',
        true,
        'E2E Professional',
        'Browser',
        true,
        ${sqlLiteral(organizationId)}::uuid,
        true,
        '+1555014500',
        -4500,
        ${sqlLiteral(`${marker} dev booking setup staff`)},
        true,
        ${sqlLiteral(salonId)}::uuid,
        true,
        array['E2E booking setup']::text[],
        'granted'
      )
      returning id
    ),
    service_rows as (
      insert into public.services (
        base_price,
        category,
        description,
        duration_minutes,
        is_active,
        name,
        organization_id,
        salon_id
      )
      values
        (
          45,
          'E2E Booking Setup',
          ${sqlLiteral(`${marker} public slot verification service`)},
          30,
          true,
          ${sqlLiteral(serviceAName)},
          ${sqlLiteral(organizationId)}::uuid,
          ${sqlLiteral(salonId)}::uuid
        ),
        (
          55,
          'E2E Booking Setup',
          ${sqlLiteral(`${marker} service-centric toggle verification`)},
          45,
          true,
          ${sqlLiteral(serviceBName)},
          ${sqlLiteral(organizationId)}::uuid,
          ${sqlLiteral(salonId)}::uuid
        )
      returning id, name
    )
    select
      (select id from staff_row) as staff_id,
      (select id from service_rows where name = ${sqlLiteral(serviceAName)}) as service_a_id,
      (select id from service_rows where name = ${sqlLiteral(serviceBName)}) as service_b_id;
  `);
  const row = rows[0];

  if (!row?.staff_id || !row?.service_a_id || !row?.service_b_id) {
    throw new Error("Failed to seed staff/services for browser test.");
  }

  return {
    serviceAId: row.service_a_id,
    serviceAName,
    serviceBId: row.service_b_id,
    serviceBName,
    staffId: row.staff_id,
    staffName,
  };
}

async function deactivateFixtures(fixtures) {
  if (!fixtures?.staffId) {
    return;
  }

  await runSql(`
    update public.staff_service_assignments
    set is_active = false, updated_at = now()
    where salon_id = ${sqlLiteral(salonId)}::uuid
      and staff_id = ${sqlLiteral(fixtures.staffId)}::uuid;

    update public.staff_availability_rules
    set is_active = false, updated_at = now()
    where salon_id = ${sqlLiteral(salonId)}::uuid
      and staff_id = ${sqlLiteral(fixtures.staffId)}::uuid;

    update public.staff_time_blocks
    set is_active = false, cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
    where salon_id = ${sqlLiteral(salonId)}::uuid
      and staff_id = ${sqlLiteral(fixtures.staffId)}::uuid;

    update public.services
    set is_active = false, updated_at = now()
    where id in (
      ${sqlLiteral(fixtures.serviceAId)}::uuid,
      ${sqlLiteral(fixtures.serviceBId)}::uuid
    )
      and name in (${sqlLiteral(fixtures.serviceAName)}, ${sqlLiteral(fixtures.serviceBName)});

    update public.staff
    set is_active = false, updated_at = now()
    where id = ${sqlLiteral(fixtures.staffId)}::uuid
      and display_name = ${sqlLiteral(fixtures.staffName)};
  `);
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

async function waitForSaved(page) {
  await page.getByText("Saved.").last().waitFor({ timeout: 20000 });
}

async function setChecked(locator, checked) {
  if ((await locator.isChecked()) !== checked) {
    await locator.setChecked(checked);
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

async function verifySqlSlots(fixtures) {
  const rows = await runSql(`
    select
      public.public_staff_line_is_available(
        ${sqlLiteral(salonId)}::uuid,
        ${sqlLiteral(organizationId)}::uuid,
        ${sqlLiteral(fixtures.staffId)}::uuid,
        '2026-07-20T14:00:00Z'::timestamptz,
        '2026-07-20T14:30:00Z'::timestamptz,
        ${sqlLiteral(timezone)},
        null::uuid
      ) as work_slot_available,
      public.public_staff_line_is_available(
        ${sqlLiteral(salonId)}::uuid,
        ${sqlLiteral(organizationId)}::uuid,
        ${sqlLiteral(fixtures.staffId)}::uuid,
        '2026-07-20T15:15:00Z'::timestamptz,
        '2026-07-20T15:45:00Z'::timestamptz,
        ${sqlLiteral(timezone)},
        null::uuid
      ) as time_block_rejected,
      public.public_staff_line_is_available(
        ${sqlLiteral(salonId)}::uuid,
        ${sqlLiteral(organizationId)}::uuid,
        ${sqlLiteral(fixtures.staffId)}::uuid,
        '2026-07-20T17:15:00Z'::timestamptz,
        '2026-07-20T17:45:00Z'::timestamptz,
        ${sqlLiteral(timezone)},
        null::uuid
      ) as break_rejected,
      public.public_staff_line_is_available(
        ${sqlLiteral(salonId)}::uuid,
        ${sqlLiteral(organizationId)}::uuid,
        ${sqlLiteral(fixtures.staffId)}::uuid,
        '2026-07-20T18:15:00Z'::timestamptz,
        '2026-07-20T18:45:00Z'::timestamptz,
        ${sqlLiteral(timezone)},
        null::uuid
      ) as afternoon_slot_available;
  `);
  const row = rows[0] ?? {};

  if (
    row.work_slot_available !== true ||
    row.time_block_rejected !== false ||
    row.break_rejected !== false ||
    row.afternoon_slot_available !== true
  ) {
    throw new Error(`Unexpected slot verification result: ${JSON.stringify(row)}`);
  }

  return row;
}

async function runBrowserScenario(session, fixtures, report) {
  const browser = await launchBrowser();
  report.browser = "launched";

  try {
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
    recordPageErrors(page, report);

    await page.goto(`${baseUrl}/bookings?date=${slotDate}`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("heading", { exact: true, name: "Booking" }).waitFor({
      timeout: 20000,
    });
    await screenshot(page, report, "phase45-readiness-navigation-desktop.png");
    const readinessVisible = await page
      .getByText("Finish online booking setup")
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (readinessVisible) {
      await page.getByRole("link", { name: "Assign services" }).first().click();
      await page.waitForURL(/\/staff\?/, { timeout: 15000 });
      await page.getByRole("heading", { name: "Services & booking" }).waitFor({
        timeout: 20000,
      });
      report.steps.push({ readinessAssignmentDeepLink: page.url() });
    } else {
      report.steps.push({ readinessPanel: "already complete for current dev salon" });
    }

    await page.goto(`${baseUrl}/staff?staff=${fixtures.staffId}&setup=booking`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("heading", { name: "Services & booking" }).waitFor({
      timeout: 20000,
    });
    await page.getByText(fixtures.staffName).first().waitFor({ timeout: 15000 });
    await setChecked(page.getByLabel(`Assign ${fixtures.serviceAName}`), true);
    await setChecked(
      page.getByLabel(`Enable online booking for ${fixtures.serviceAName}`),
      true,
    );
    await setChecked(page.getByLabel(`Assign ${fixtures.serviceBName}`), true);
    await setChecked(
      page.getByLabel(`Enable online booking for ${fixtures.serviceBName}`),
      true,
    );
    await screenshot(page, report, "phase45-staff-assignment-desktop.png");
    await page.getByRole("button", { name: "Save changes" }).click();
    await waitForSaved(page);
    report.steps.push({ staffCentricAssignment: "saved two services online" });

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Services & booking" }).waitFor({
      timeout: 20000,
    });
    if (
      !(await page.getByLabel(`Assign ${fixtures.serviceAName}`).isChecked()) ||
      !(await page
        .getByLabel(`Enable online booking for ${fixtures.serviceAName}`)
        .isChecked())
    ) {
      throw new Error("Staff-centric service assignment did not persist.");
    }

    await page.goto(
      `${baseUrl}/services?service=${fixtures.serviceBId}&setup=bookable_staff`,
      { waitUntil: "networkidle" },
    );
    await page.getByRole("heading", { name: "Bookable staff" }).waitFor({
      timeout: 20000,
    });
    await page.getByText(fixtures.serviceBName).first().waitFor({
      timeout: 15000,
    });
    await setChecked(page.getByLabel(`Assign ${fixtures.staffName}`), false);
    await screenshot(page, report, "phase45-service-bookable-staff-desktop.png");
    await page.getByRole("button", { name: "Save changes" }).click();
    await waitForSaved(page);
    report.steps.push({ serviceCentricAssignment: "service B unassigned" });

    await page.goto(`${baseUrl}/staff?staff=${fixtures.staffId}&setup=booking`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("heading", { name: "Services & booking" }).waitFor({
      timeout: 20000,
    });
    if (await page.getByLabel(`Assign ${fixtures.serviceBName}`).isChecked()) {
      throw new Error("Service-centric assignment change did not reflect on staff editor.");
    }

    await page.goto(
      `${baseUrl}/bookings?date=${slotDate}&tab=settings&section=availability&staffId=${fixtures.staffId}`,
      { waitUntil: "networkidle" },
    );
    await page.getByRole("heading", { name: "Staff availability" }).waitFor({
      timeout: 20000,
    });
    await page.getByRole("button", { name: fixtures.staffName }).click();
    await page.getByRole("button", { name: "Monday-Friday preset" }).click();
    const monday = page
      .locator(
        "xpath=//section[.//h4[normalize-space()='Mon'] and not(.//h4[normalize-space()='Tue'])]",
      )
      .first();
    await setChecked(monday.getByRole("checkbox").first(), true);
    await monday.getByRole("button", { name: "Add interval" }).nth(1).click();
    await screenshot(page, report, "phase45-availability-desktop.png");
    await page.getByRole("button", { name: "Save changes" }).click();
    await waitForSaved(page);
    report.steps.push({ availability: "weekday preset plus Monday break saved" });

    await page.getByLabel("Start", { exact: true }).fill(`${slotDate}T10:00`);
    await page.getByLabel("End", { exact: true }).fill(`${slotDate}T11:00`);
    await page.getByPlaceholder("Reason").fill(`${marker} time off`);
    await page.getByRole("button", { name: "Add block" }).click();
    await waitForSaved(page);
    await page.getByText(`${marker} time off`).waitFor({ timeout: 15000 });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByText(`${marker} time off`).waitFor({ timeout: 20000 });
    await screenshot(page, report, "phase45-breaks-time-off-desktop.png");
    report.steps.push({ timeBlock: "future time-off block persisted" });

    report.slotVerification = await verifySqlSlots(fixtures);

    await page.goto(
      `${baseUrl}/book/${salonId}?serviceId=${fixtures.serviceAId}&date=${slotDate}`,
      { waitUntil: "networkidle" },
    );
    await page.getByRole("heading", { name: "Choose a service" }).waitFor({
      timeout: 20000,
    });
    await page.getByText(fixtures.serviceAName).first().waitFor({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Add-ons" }).waitFor({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Choose a professional" }).waitFor({
      timeout: 15000,
    });
    await page.getByRole("button", { name: "Specific" }).click();
    await page.getByText(fixtures.staffName).first().waitFor({ timeout: 15000 });
    await page.getByRole("button", { name: fixtures.staffName }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("heading", { name: "Choose date and time" }).waitFor({
      timeout: 20000,
    });
    await page.locator("button").filter({ hasText: "9:00" }).first().waitFor({
      timeout: 20000,
    });
    await screenshot(page, report, "phase45-public-booking-slots-desktop.png");
    report.steps.push({ publicBooking: "service, staff, and slots visible" });

    await page.goto(`${baseUrl}/bookings?date=${slotDate}`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("button", { name: "New appointment" }).click();
    const modal = page.getByRole("dialog", { name: "New appointment" });
    await modal.getByRole("heading", { name: "New appointment" }).waitFor({
      timeout: 15000,
    });
    await modal
      .getByRole("textbox", { exact: true, name: "Name" })
      .fill(`${marker} Manual Customer`);
    await modal
      .getByRole("textbox", { exact: true, name: "Phone" })
      .fill("+1555014501");
    await modal.getByRole("textbox", { exact: true, name: "Email" }).fill(
      `${slugify(marker)}@manual.example.test`,
    );
    await modal.getByRole("button", { exact: true, name: "Next" }).click();
    await modal.getByLabel("Service 1").selectOption(fixtures.serviceAId);
    await modal.getByRole("button", { exact: true, name: "Next" }).click();
    await modal.locator("select").first().selectOption(fixtures.staffId);
    await screenshot(page, report, "phase45-manual-booking-desktop.png");
    await modal.getByRole("button", { exact: true, name: "Next" }).click();
    await modal.getByLabel("Start", { exact: true }).fill(`${slotDate}T09:00`);
    await modal.locator("button").filter({ hasText: "09:00" }).first().waitFor({
      timeout: 15000,
    });
    report.steps.push({ manualBooking: "eligible staff and real slots visible" });

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(`${baseUrl}/staff?staff=${fixtures.staffId}&setup=booking`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("heading", { name: "Services & booking" }).waitFor({
      timeout: 20000,
    });
    await screenshot(page, report, "phase45-booking-setup-mobile.png");
    report.steps.push({ mobile: "staff booking setup captured" });

    if (
      report.consoleErrors.length > 0 ||
      report.pageErrors.length > 0 ||
      report.networkErrors.length > 0
    ) {
      throw new Error("Browser runtime errors were captured.");
    }
  } finally {
    await browser.close();
  }
}

const report = {
  baseUrl,
  browser: null,
  consoleErrors: [],
  devConfigLeftActive: true,
  fixtureIds: null,
  marker,
  networkErrors: [],
  ok: false,
  pageErrors: [],
  screenshots: [],
  slotVerification: null,
  steps: [],
  userEmail: null,
};

let fixtures;

try {
  const env = await loadEnv();
  const { email, session } = await createSession(env);
  report.userEmail = email;
  fixtures = await seedFixtures();
  report.fixtureIds = {
    serviceAId: fixtures.serviceAId,
    serviceBId: fixtures.serviceBId,
    staffId: fixtures.staffId,
  };

  await runBrowserScenario(session, fixtures, report);
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (fixtures) {
    await deactivateFixtures(fixtures).catch((cleanupError) => {
      report.cleanupError =
        cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
    });
    report.devConfigLeftActive = false;
  }
} finally {
  await writeFile(
    path.join(artifactsDir, "phase45-browser-report.json"),
    JSON.stringify(report, null, 2),
  );
}

if (!report.ok) {
  throw new Error(report.error ?? "Phase45 browser test failed.");
}

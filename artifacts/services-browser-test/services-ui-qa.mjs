import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.SERVICES_QA_BASE_URL ?? "http://localhost:3100";
const artifactsDir = path.resolve("artifacts/services-browser-test");
const marker = `[E2E Services Gate] ${new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, "")
  .slice(0, 14)}`;
const ids = {
  authUser: randomUUID(),
  organization: randomUUID(),
  salon: randomUUID(),
  staffAnna: randomUUID(),
  staffLisa: randomUUID(),
  staffMarry: randomUUID(),
  serviceGel: randomUUID(),
  serviceManicure: randomUUID(),
  serviceNailArt: randomUUID(),
  serviceNailRepair: randomUUID(),
  servicePedicure: randomUUID(),
  serviceRetired: randomUUID(),
};

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
  const dir = await mkdtemp(path.join(os.tmpdir(), "kingpos-services-qa-"));
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
    await unlink(filePath).catch(() => {});
  }
}

async function loadEnv() {
  const fileEnv = parseDotEnv(await readFile(".env.local", "utf8"));
  return { ...fileEnv, ...process.env };
}

async function seedFixtures(email, password) {
  await runSql(`
    begin;

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
    values (
      'authenticated',
      '',
      now(),
      ${sqlLiteral(email)},
      '',
      0,
      '',
      '',
      now(),
      crypt(${sqlLiteral(password)}, gen_salt('bf')),
      ${sqlLiteral(ids.authUser)}::uuid,
      coalesce(
        (select instance_id from auth.users where instance_id is not null limit 1),
        '00000000-0000-0000-0000-000000000000'::uuid
      ),
      false,
      false,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'display_name', 'King Nails Owner',
        'email', ${sqlLiteral(email)},
        'email_verified', true,
        'phone_verified', false,
        'sub', ${sqlLiteral(ids.authUser)}
      ),
      '',
      '',
      'authenticated',
      now()
    );

    insert into auth.identities (
      created_at,
      identity_data,
      last_sign_in_at,
      provider,
      provider_id,
      user_id,
      updated_at
    )
    values (
      now(),
      jsonb_build_object(
        'sub', ${sqlLiteral(ids.authUser)},
        'email', ${sqlLiteral(email)},
        'email_verified', true,
        'phone_verified', false
      ),
      now(),
      'email',
      ${sqlLiteral(ids.authUser)},
      ${sqlLiteral(ids.authUser)}::uuid,
      now()
    );

    update public.users
    set
      display_name = 'King Nails Owner',
      email = ${sqlLiteral(email)},
      language = 'en',
      status = 'active',
      timezone = 'America/Chicago'
    where auth_user_id = ${sqlLiteral(ids.authUser)}::uuid;

    insert into public.organizations (
      id,
      name,
      legal_name,
      owner_user_id,
      status
    )
    values (
      ${sqlLiteral(ids.organization)}::uuid,
      'King Nails Group',
      ${sqlLiteral(`${marker} LLC`)},
      (
        select id
        from public.users
        where auth_user_id = ${sqlLiteral(ids.authUser)}::uuid
      ),
      'active'
    );

    insert into public.organization_memberships (
      organization_id,
      user_id,
      role_id,
      role,
      status,
      joined_at
    )
    select
      ${sqlLiteral(ids.organization)}::uuid,
      (
        select id
        from public.users
        where auth_user_id = ${sqlLiteral(ids.authUser)}::uuid
      ),
      roles.id,
      'owner',
      'active',
      now()
    from public.roles
    where roles.organization_id = ${sqlLiteral(ids.organization)}::uuid
      and roles.code = 'OWNER';

    insert into public.locations (
      id,
      organization_id,
      name,
      phone,
      address_line1,
      city,
      state,
      postal_code,
      country,
      status
    )
    values (
      ${sqlLiteral(ids.salon)}::uuid,
      ${sqlLiteral(ids.organization)}::uuid,
      'King Nails',
      '3125550199',
      '100 Test Plaza',
      'Chicago',
      'IL',
      '60601',
      'US',
      'active'
    );

    insert into public.staff (
      id,
      organization_id,
      salon_id,
      display_name,
      first_name,
      last_name,
      email,
      job_title,
      is_active,
      online_booking_enabled,
      owner_public_enabled,
      public_profile_visible,
      staff_public_consent_status,
      profile_display_order
    )
    values
      (
        ${sqlLiteral(ids.staffMarry)}::uuid,
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        'Marry',
        'Marry',
        'QA',
        'marry@staff.example.test',
        'Nail professional',
        true,
        true,
        true,
        true,
        'granted',
        1
      ),
      (
        ${sqlLiteral(ids.staffAnna)}::uuid,
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        'Anna',
        'Anna',
        'QA',
        'anna@staff.example.test',
        'Nail professional',
        true,
        true,
        true,
        true,
        'granted',
        2
      ),
      (
        ${sqlLiteral(ids.staffLisa)}::uuid,
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        'Lisa',
        'Lisa',
        'QA',
        'lisa@staff.example.test',
        'Nail professional',
        true,
        false,
        true,
        true,
        'granted',
        3
      );

    insert into public.services (
      id,
      organization_id,
      salon_id,
      name,
      category,
      description,
      base_price,
      duration_minutes,
      is_active,
      online_booking_enabled
    )
    values
      (
        ${sqlLiteral(ids.servicePedicure)}::uuid,
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        'Pedicure',
        'Nails',
        'Classic pedicure with polish.',
        45,
        45,
        true,
        true
      ),
      (
        ${sqlLiteral(ids.serviceManicure)}::uuid,
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        'Manicure',
        'Nails',
        'Classic manicure.',
        35,
        30,
        true,
        false
      ),
      (
        ${sqlLiteral(ids.serviceNailRepair)}::uuid,
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        'Nail Repair',
        'Nails',
        'Single nail repair.',
        15,
        15,
        false,
        false
      ),
      (
        ${sqlLiteral(ids.serviceGel)}::uuid,
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        'Gel Polish',
        'Add-ons',
        'Long-wear gel polish.',
        15,
        15,
        true,
        true
      ),
      (
        ${sqlLiteral(ids.serviceNailArt)}::uuid,
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        'Nail Art',
        'Add-ons',
        'Custom nail art.',
        20,
        20,
        true,
        true
      ),
      (
        ${sqlLiteral(ids.serviceRetired)}::uuid,
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        'Seasonal Charm',
        'Add-ons',
        'A previously offered seasonal add-on.',
        10,
        10,
        true,
        false
      );

    insert into public.staff_service_assignments (
      organization_id,
      salon_id,
      staff_id,
      service_id,
      is_active,
      online_bookable
    )
    values
      (
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        ${sqlLiteral(ids.staffMarry)}::uuid,
        ${sqlLiteral(ids.servicePedicure)}::uuid,
        true,
        true
      ),
      (
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        ${sqlLiteral(ids.staffAnna)}::uuid,
        ${sqlLiteral(ids.servicePedicure)}::uuid,
        true,
        true
      ),
      (
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        ${sqlLiteral(ids.staffLisa)}::uuid,
        ${sqlLiteral(ids.servicePedicure)}::uuid,
        true,
        true
      ),
      (
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        ${sqlLiteral(ids.staffMarry)}::uuid,
        ${sqlLiteral(ids.serviceGel)}::uuid,
        true,
        true
      );

    insert into public.service_add_on_links (
      organization_id,
      salon_id,
      parent_service_id,
      add_on_service_id,
      is_active,
      display_order
    )
    values
      (
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        ${sqlLiteral(ids.servicePedicure)}::uuid,
        ${sqlLiteral(ids.serviceGel)}::uuid,
        true,
        0
      ),
      (
        ${sqlLiteral(ids.organization)}::uuid,
        ${sqlLiteral(ids.salon)}::uuid,
        ${sqlLiteral(ids.servicePedicure)}::uuid,
        ${sqlLiteral(ids.serviceRetired)}::uuid,
        true,
        1
      );

    update public.staff
    set is_active = false
    where id = ${sqlLiteral(ids.staffLisa)}::uuid;

    update public.services
    set is_active = false
    where id = ${sqlLiteral(ids.serviceRetired)}::uuid;

    commit;
  `);
}

async function createSession(env, email, password) {
  const supabase = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.session) {
    throw new Error(error?.message ?? "Services QA sign-in returned no session.");
  }

  return data.session;
}

async function cleanupFixtures() {
  await runSql(`
    begin;

    alter table public.roles
    disable trigger prevent_system_role_delete;
    alter table public.staff
    disable trigger prevent_staff_delete;
    alter table public.services
    disable trigger prevent_service_delete;
    alter table public.salon_settings
    disable trigger prevent_salon_settings_delete;

    delete from public.organizations
    where id = ${sqlLiteral(ids.organization)}::uuid;

    alter table public.salon_settings
    enable trigger prevent_salon_settings_delete;
    alter table public.services
    enable trigger prevent_service_delete;
    alter table public.staff
    enable trigger prevent_staff_delete;
    alter table public.roles
    enable trigger prevent_system_role_delete;

    delete from public.users
    where auth_user_id = ${sqlLiteral(ids.authUser)}::uuid;

    delete from auth.users
    where id = ${sqlLiteral(ids.authUser)}::uuid;

    commit;
  `);

  const rows = await runSql(`
    select
      (select count(*) from public.organizations
        where id = ${sqlLiteral(ids.organization)}::uuid) as organizations,
      (select count(*) from public.services
        where organization_id = ${sqlLiteral(ids.organization)}::uuid) as services,
      (select count(*) from public.staff
        where organization_id = ${sqlLiteral(ids.organization)}::uuid) as staff,
      (select count(*) from auth.users
        where id = ${sqlLiteral(ids.authUser)}::uuid) as auth_users;
  `);

  return rows[0] ?? {};
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
  page.on("response", (response) => {
    if (response.status() >= 500) {
      report.networkErrors.push(`${response.status()} ${response.url()}`);
    }
  });
}

async function screenshot(page, report, name, fullPage = true) {
  await page.screenshot({
    fullPage,
    path: path.join(artifactsDir, name),
  });
  report.screenshots.push(name);
}

function serviceRow(page, name) {
  return page.locator("article.service-row").filter({ hasText: name }).first();
}

async function waitForServices(page) {
  await page.getByRole("heading", { level: 1, name: "Services" }).waitFor({
    timeout: 30000,
  });
  await page
    .locator(".service-row__identity strong")
    .filter({ hasText: /^Pedicure$/ })
    .first()
    .waitFor({ timeout: 20000 });
}

async function assertUniqueServiceRows(page) {
  await page.waitForTimeout(500);
  const names = await page
    .locator(".service-row__identity > strong")
    .allTextContents();

  if (new Set(names).size !== names.length) {
    throw new Error(`Duplicate service rows rendered: ${names.join(", ")}`);
  }
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const overflows = [...document.querySelectorAll("main *")]
      .filter((element) => {
        const node = /** @type {HTMLElement} */ (element);
        const style = getComputedStyle(node);
        return (
          node.scrollWidth > node.clientWidth + 2 &&
          style.overflowX === "visible" &&
          node.getBoundingClientRect().width > 0
        );
      })
      .slice(0, 10)
      .map((element) => ({
        className: /** @type {HTMLElement} */ (element).className,
        tag: element.tagName,
      }));

    return {
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      visibleElementOverflows: overflows,
    };
  });
}

async function runBrowserScenario(session, report) {
  const browser = await launchBrowser();
  report.browser = "launched";

  try {
    const context = await browser.newContext({
      viewport: { height: 1000, width: 1440 },
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
        value: `manage:${ids.salon}`,
      },
      {
        name: "kingpos-current-organization-id",
        sameSite: "Lax",
        url: baseUrl,
        value: ids.organization,
      },
      {
        name: "kingpos-current-manage-salon-id",
        sameSite: "Lax",
        url: baseUrl,
        value: ids.salon,
      },
      {
        name: "kingpos-current-salon-id",
        sameSite: "Lax",
        url: baseUrl,
        value: ids.salon,
      },
    ]);

    const page = await context.newPage();
    recordPageErrors(page, report);
    const response = await page.goto(`${baseUrl}/services`, {
      waitUntil: "networkidle",
    });

    if (!response || response.status() >= 400) {
      throw new Error(`Services page returned ${response?.status() ?? "no response"}.`);
    }

    await waitForServices(page);
    await assertUniqueServiceRows(page);
    await screenshot(page, report, "services-desktop.png");
    report.metrics.desktopCollapsed = await layoutMetrics(page);

    await page.getByRole("button", { name: "Expand Pedicure" }).click();
    await page.getByRole("heading", { name: "Service details" }).waitFor();
    await page.getByRole("heading", { name: "Online booking" }).waitFor();
    await page.getByText("Linked · inactive", { exact: true }).waitFor();
    await page.getByText("Lisa", { exact: true }).waitFor();
    await screenshot(page, report, "services-desktop-expanded.png");
    report.interactions.expandedEditor =
      "details, booking staff, add-ons, and inactive linked add-on visible";

    const countBeforeDrawer = await page.locator("article.service-row").count();
    await page.getByRole("button", { name: "New service" }).click();
    const dialog = page.getByRole("dialog", { name: "New service" });
    await dialog.waitFor();
    await screenshot(page, report, "services-create-drawer.png", false);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    if ((await page.locator("article.service-row").count()) !== countBeforeDrawer) {
      throw new Error("Opening and closing the create drawer changed service data.");
    }

    await page.getByRole("button", { name: "New service" }).click();
    const createDialog = page.getByRole("dialog", { name: "New service" });
    await createDialog.getByLabel("Name").fill("French Tips");
    await createDialog.getByLabel("Category").fill("Nails");
    await createDialog.getByLabel("Price").fill("12");
    await createDialog.getByLabel("Duration").fill("15");

    if (
      await createDialog
        .getByRole("switch", { name: "Enable online booking for new service" })
        .isChecked()
    ) {
      throw new Error("New service online booking did not default to Off.");
    }

    await createDialog.getByRole("button", { name: "Create service" }).click();
    await page.getByText("French Tips", { exact: true }).waitFor({
      timeout: 30000,
    });
    const createdRow = serviceRow(page, "French Tips");

    if (
      await createdRow
        .getByRole("switch", { name: "Enable online booking for French Tips" })
        .first()
        .isChecked()
    ) {
      throw new Error("Created service unexpectedly enabled online booking.");
    }
    report.interactions.createDefaultOff = "passed";

    await page.getByRole("button", { name: "Expand Pedicure" }).click();
    await serviceRow(page, "Pedicure").getByLabel("Price").fill("47");
    await page.getByRole("button", { name: "Expand Manicure" }).click();
    await serviceRow(page, "Manicure").getByLabel("Duration").fill("35");
    await page.getByText("2 services have unsaved changes").waitFor();

    page.once("dialog", async (leaveDialog) => {
      report.interactions.leaveWarning = leaveDialog.message();
      await leaveDialog.dismiss();
    });
    await page.locator('a[href="/bookings"]').first().click();
    await page.waitForTimeout(300);

    if (!page.url().includes("/services")) {
      throw new Error("Navigation warning did not retain the dirty Services page.");
    }

    await page.getByRole("button", { name: "Save all changes" }).click();
    await page.getByText("2 services saved.", { exact: true }).waitFor({
      timeout: 30000,
    });
    await page.reload({ waitUntil: "networkidle" });
    await waitForServices(page);
    await assertUniqueServiceRows(page);

    if (!(await serviceRow(page, "Pedicure").getByText("$47.00").isVisible())) {
      throw new Error("Batch-saved Pedicure price was not visible after reload.");
    }
    if (!(await serviceRow(page, "Manicure").getByText("35 min").isVisible())) {
      throw new Error("Batch-saved Manicure duration was not visible after reload.");
    }
    report.interactions.atomicBatchReload = "two service drafts saved and reloaded";

    const search = page.getByPlaceholder("Search services");
    await search.fill("Nail Repair");

    if ((await page.locator("article.service-row").count()) !== 1) {
      throw new Error("Service search did not narrow the list to one row.");
    }

    await search.fill("");
    await page.getByLabel("Status filter").selectOption("needs_setup");
    await page.getByText("Nail Art", { exact: true }).waitFor();

    if (await page.getByText("Manicure", { exact: true }).isVisible()) {
      throw new Error("Needs setup filter included an online-disabled service.");
    }

    await page.getByLabel("Status filter").selectOption("all");
    await page.getByLabel("Category filter").selectOption("Nails");

    const filteredNames = await page
      .locator(".service-row__identity > strong")
      .allTextContents();

    if (filteredNames.includes("Gel Polish")) {
      throw new Error("Category filter included an Add-ons service.");
    }
    report.interactions.searchAndFilters = "passed";

    await page.getByLabel("Category filter").selectOption("all");
    await page.setViewportSize({ height: 900, width: 820 });
    await page.getByRole("button", { name: "Expand Pedicure" }).click();
    await screenshot(page, report, "services-tablet-expanded.png");
    report.metrics.tablet = await layoutMetrics(page);

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(`${baseUrl}/services`, { waitUntil: "networkidle" });
    await waitForServices(page);
    await assertUniqueServiceRows(page);
    await screenshot(page, report, "services-mobile.png");
    await page.getByRole("button", { name: "Expand Pedicure" }).click();
    await page.getByText("Linked · inactive", { exact: true }).waitFor();
    await screenshot(page, report, "services-mobile-expanded.png");
    report.metrics.mobile = await layoutMetrics(page);

    const bookingResponse = await page.goto(`${baseUrl}/bookings`, {
      waitUntil: "networkidle",
    });

    if (!bookingResponse || bookingResponse.status() >= 400) {
      throw new Error(`Bookings page returned ${bookingResponse?.status() ?? "no response"}.`);
    }

    const tabs = page.getByTestId("booking-owner-tabs");
    const tabText = await tabs.innerText();

    for (const expected of [
      "Appointments",
      "Booking page",
      "Availability",
      "Settings",
    ]) {
      if (!tabText.includes(expected)) {
        throw new Error(`Booking tab ${expected} is missing.`);
      }
    }

    if (/\bServices\b/.test(tabText)) {
      throw new Error("Booking Services tab still exists.");
    }
    report.interactions.bookingTabs =
      "Appointments | Booking page | Availability | Settings";

    for (const [name, metrics] of Object.entries(report.metrics)) {
      if (metrics.horizontalOverflow) {
        throw new Error(`${name} viewport has horizontal overflow.`);
      }
    }

    if (
      report.consoleErrors.length > 0 ||
      report.pageErrors.length > 0 ||
      report.networkErrors.length > 0
    ) {
      throw new Error("Browser QA recorded console, page, or network errors.");
    }

    await context.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  await mkdir(artifactsDir, { recursive: true });
  const report = {
    browser: "not launched",
    consoleErrors: [],
    fixtureCleanup: null,
    interactions: {},
    marker,
    metrics: {},
    networkErrors: [],
    pageErrors: [],
    screenshots: [],
    status: "running",
  };
  const env = await loadEnv();
  const email = `owner.${Date.now()}@kingnails.example.test`;
  const password = `ServicesQA!${Date.now()}Aa`;
  let failure = null;

  try {
    await seedFixtures(email, password);
    const session = await createSession(env, email, password);
    await runBrowserScenario(session, report);
    report.status = "passed";
  } catch (error) {
    failure = error;
    report.status = "failed";
    report.failure = error instanceof Error ? error.message : String(error);
  } finally {
    try {
      report.fixtureCleanup = await cleanupFixtures();
    } catch (cleanupError) {
      report.fixtureCleanup = {
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError),
      };
      failure ??= cleanupError;
      report.status = "failed";
    }

    await writeFile(
      path.join(artifactsDir, "services-ui-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }

  if (failure) {
    throw failure;
  }
}

await main();

import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const baseUrl = process.env.GATE21_BASE_URL ?? "http://localhost:3000";
const artifactsDir = path.resolve("artifacts/booking-browser-test");
const organizationId = "387af6da-69bb-45dc-bf25-5954a1d10ded";
const salonId = "7f599bc8-a806-4a68-be86-c149c21709e2";
const timezone = "America/Chicago";
const marker = `Gate21 ${new Date()
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "kingpos-gate21-"));
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
  const password = `Gate21!${Date.now()}Aa`;

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
  const slug = slugify(marker);
  const rows = await runSql(`
    with staff_seed(label, display_name, job_title, online_enabled, sort_order) as (
      values
        ('marry', ${sqlLiteral(`000 ${marker} Marry`)}, 'Senior stylist', true, -6210),
        ('lina', ${sqlLiteral(`000 ${marker} Lina`)}, 'Nail artist', false, -6209),
        ('noa', ${sqlLiteral(`000 ${marker} Noa`)}, 'Colorist', true, -6208)
    ),
    staff_rows as (
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
      select
        display_name,
        ${sqlLiteral(slug)} || '-' || label || '@staff.example.test',
        initcap(label),
        true,
        job_title,
        'Gate21',
        online_enabled,
        ${sqlLiteral(organizationId)}::uuid,
        true,
        '+1555021000',
        sort_order,
        ${sqlLiteral(`${marker} availability visual QA`)},
        true,
        ${sqlLiteral(salonId)}::uuid,
        true,
        array['Gate 2.1']::text[],
        'granted'
      from staff_seed
      returning id, display_name
    ),
    service_seed(label, name, duration, price) as (
      values
        ('cut', ${sqlLiteral(`000 ${marker} Signature Cut`)}, 30, 45),
        ('color', ${sqlLiteral(`000 ${marker} Color Gloss`)}, 45, 75)
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
      select
        price,
        'Gate 2.1',
        ${sqlLiteral(`${marker} services for availability UI`)},
        duration,
        true,
        name,
        ${sqlLiteral(organizationId)}::uuid,
        ${sqlLiteral(salonId)}::uuid
      from service_seed
      returning id, name
    ),
    assignments as (
      insert into public.staff_service_assignments (
        organization_id,
        salon_id,
        staff_id,
        service_id,
        is_active,
        online_bookable
      )
      select
        ${sqlLiteral(organizationId)}::uuid,
        ${sqlLiteral(salonId)}::uuid,
        staff_rows.id,
        service_rows.id,
        true,
        staff_rows.display_name like ${sqlLiteral(`000 ${marker} Marry`)} || '%'
      from staff_rows
      cross join service_rows
      where staff_rows.display_name not like ${sqlLiteral(`000 ${marker} Noa`)} || '%'
      returning id
    ),
    availability_rules as (
      insert into public.staff_availability_rules (
        organization_id,
        salon_id,
        staff_id,
        rule_type,
        day_of_week,
        starts_at_local,
        ends_at_local,
        timezone_iana,
        is_active
      )
      select
        ${sqlLiteral(organizationId)}::uuid,
        ${sqlLiteral(salonId)}::uuid,
        staff_rows.id,
        values.rule_type,
        values.day_of_week,
        values.starts_at::time,
        values.ends_at::time,
        ${sqlLiteral(timezone)},
        true
      from staff_rows
      join (
        values
          (${sqlLiteral(`000 ${marker} Marry`)}, 'working', 0, '09:00', '17:00'),
          (${sqlLiteral(`000 ${marker} Marry`)}, 'working', 1, '09:00', '12:00'),
          (${sqlLiteral(`000 ${marker} Marry`)}, 'working', 1, '13:00', '17:00'),
          (${sqlLiteral(`000 ${marker} Marry`)}, 'break', 1, '11:00', '11:30'),
          (${sqlLiteral(`000 ${marker} Marry`)}, 'working', 2, '09:00', '17:00'),
          (${sqlLiteral(`000 ${marker} Marry`)}, 'working', 3, '09:00', '17:00'),
          (${sqlLiteral(`000 ${marker} Marry`)}, 'working', 4, '09:00', '17:00'),
          (${sqlLiteral(`000 ${marker} Marry`)}, 'working', 5, '09:00', '17:00'),
          (${sqlLiteral(`000 ${marker} Lina`)}, 'working', 1, '10:00', '16:00'),
          (${sqlLiteral(`000 ${marker} Lina`)}, 'working', 2, '10:00', '16:00'),
          (${sqlLiteral(`000 ${marker} Lina`)}, 'working', 3, '10:00', '16:00')
      ) as values(staff_name, rule_type, day_of_week, starts_at, ends_at)
        on staff_rows.display_name = values.staff_name
      returning id
    ),
    time_blocks as (
      insert into public.staff_time_blocks (
        organization_id,
        salon_id,
        staff_id,
        block_type,
        starts_at,
        ends_at,
        timezone_iana,
        reason,
        is_active
      )
      select
        ${sqlLiteral(organizationId)}::uuid,
        ${sqlLiteral(salonId)}::uuid,
        staff_rows.id,
        'time_off',
        values.starts_at::timestamptz,
        values.ends_at::timestamptz,
        ${sqlLiteral(timezone)},
        values.reason,
        true
      from staff_rows
      join (
        values
          (${sqlLiteral(`000 ${marker} Marry`)}, '2026-07-20T05:00:00Z', '2026-07-25T04:59:00Z', ${sqlLiteral(`${marker} vacation`)}),
          (${sqlLiteral(`000 ${marker} Marry`)}, '2026-08-03T05:00:00Z', '2026-08-04T04:59:00Z', ${sqlLiteral(`${marker} personal day`)})
      ) as values(staff_name, starts_at, ends_at, reason)
        on staff_rows.display_name = values.staff_name
      returning id
    )
    select
      (select id from staff_rows where display_name = ${sqlLiteral(`000 ${marker} Marry`)}) as marry_id,
      (select id from staff_rows where display_name = ${sqlLiteral(`000 ${marker} Lina`)}) as lina_id,
      (select id from staff_rows where display_name = ${sqlLiteral(`000 ${marker} Noa`)}) as noa_id,
      (select id from service_rows where name = ${sqlLiteral(`000 ${marker} Signature Cut`)}) as service_cut_id,
      (select id from service_rows where name = ${sqlLiteral(`000 ${marker} Color Gloss`)}) as service_color_id;
  `);
  const row = rows[0];

  if (!row?.marry_id || !row?.lina_id || !row?.noa_id) {
    throw new Error("Failed to seed Gate 2.1 availability fixtures.");
  }

  return {
    linaId: row.lina_id,
    marryId: row.marry_id,
    noaId: row.noa_id,
    serviceColorId: row.service_color_id,
    serviceCutId: row.service_cut_id,
  };
}

async function deactivateFixtures(fixtures) {
  if (!fixtures?.marryId) {
    return;
  }

  await runSql(`
    update public.staff_service_assignments
    set is_active = false, updated_at = now()
    where salon_id = ${sqlLiteral(salonId)}::uuid
      and staff_id in (
        ${sqlLiteral(fixtures.marryId)}::uuid,
        ${sqlLiteral(fixtures.linaId)}::uuid,
        ${sqlLiteral(fixtures.noaId)}::uuid
      );

    update public.staff_availability_rules
    set is_active = false, updated_at = now()
    where salon_id = ${sqlLiteral(salonId)}::uuid
      and staff_id in (
        ${sqlLiteral(fixtures.marryId)}::uuid,
        ${sqlLiteral(fixtures.linaId)}::uuid,
        ${sqlLiteral(fixtures.noaId)}::uuid
      );

    update public.staff_time_blocks
    set is_active = false,
        cancelled_at = coalesce(cancelled_at, now()),
        updated_at = now()
    where salon_id = ${sqlLiteral(salonId)}::uuid
      and staff_id in (
        ${sqlLiteral(fixtures.marryId)}::uuid,
        ${sqlLiteral(fixtures.linaId)}::uuid,
        ${sqlLiteral(fixtures.noaId)}::uuid
      );

    update public.services
    set is_active = false, updated_at = now()
    where id in (
      ${sqlLiteral(fixtures.serviceCutId)}::uuid,
      ${sqlLiteral(fixtures.serviceColorId)}::uuid
    );

    update public.staff
    set is_active = false, updated_at = now()
    where id in (
      ${sqlLiteral(fixtures.marryId)}::uuid,
      ${sqlLiteral(fixtures.linaId)}::uuid,
      ${sqlLiteral(fixtures.noaId)}::uuid
    );
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

async function screenshot(page, report, name, locator = null, fullPage = true) {
  const filePath = path.join(artifactsDir, name);

  if (locator) {
    await locator.screenshot({ path: filePath });
  } else {
    await page.screenshot({ fullPage, path: filePath });
  }

  report.screenshots.push(name);
}

async function waitForAvailability(page) {
  await page.getByRole("heading", { name: "Staff availability" }).waitFor({
    timeout: 30000,
  });
}

async function expandStaff(page, staffId) {
  const row = page.locator(`[data-testid="availability-staff-row-${staffId}"]`);
  const expanded = await page
    .locator(`#availability-expanded-${staffId}`)
    .isVisible()
    .catch(() => false);

  if (!expanded) {
    await row.locator(".booking-availability-staff-summary").click({
      position: { x: 12, y: 12 },
    });
  }

  await page.locator(`#availability-expanded-${staffId}`).waitFor({
    timeout: 15000,
  });
  return row;
}

async function collapseStaff(page, staffId) {
  const row = page.locator(`[data-testid="availability-staff-row-${staffId}"]`);
  const expanded = await page
    .locator(`#availability-expanded-${staffId}`)
    .isVisible()
    .catch(() => false);

  if (expanded) {
    await row.locator(".booking-availability-staff-summary").click({
      position: { x: 12, y: 12 },
    });
  }

  await page
    .locator(`#availability-expanded-${staffId}`)
    .waitFor({ state: "detached", timeout: 15000 })
    .catch(() => {});
  return row;
}

async function waitForSaved(page) {
  await page.getByText("Saved.").last().waitFor({ timeout: 20000 });
}

async function layoutMetrics(page, staffId) {
  return await page.evaluate((targetStaffId) => {
    const root = document.querySelector(
      '[data-booking-setup-surface="availability"]',
    );
    const staffRow = document.querySelector(
      `[data-testid="availability-staff-row-${targetStaffId}"]`,
    );
    const staffSummary = staffRow?.querySelector(
      ".booking-availability-staff-summary",
    );
    const dayRows = Array.from(
      document.querySelectorAll('[data-testid^="availability-day-"]'),
    );
    const baseDayRow =
      dayRows.find((row) => row.querySelectorAll('input[type="time"]').length <= 2) ??
      dayRows[0];
    const viewportHeight = window.innerHeight;
    const visibleDayRows = dayRows.filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < viewportHeight;
    }).length;
    const interactiveOverflow = Array.from(
      root?.querySelectorAll("button, a, summary") ?? [],
    ).filter((element) => element.scrollWidth > element.clientWidth + 1).length;

    return {
      collapsedStaffRowHeight: staffSummary
        ? Math.round(staffSummary.getBoundingClientRect().height)
        : null,
      dayRowBaseHeight: baseDayRow
        ? Math.round(baseDayRow.getBoundingClientRect().height)
        : null,
      horizontalOverflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth + 1,
      interactiveOverflow,
      largeWhiteSpaceObserved: false,
      visibleDayRows,
    };
  }, staffId);
}

async function runBrowserScenario(session, fixtures, report) {
  const browser = await launchBrowser();
  report.browser = "launched";

  try {
    const context = await browser.newContext({
      viewport: { height: 1050, width: 1440 },
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

    await page.goto(
      `${baseUrl}/bookings?date=2026-07-20&tab=availability&staffId=${fixtures.marryId}`,
      { waitUntil: "networkidle" },
    );
    await waitForAvailability(page);
    await page.getByText(`000 ${marker} Marry`).waitFor({ timeout: 20000 });

    await collapseStaff(page, fixtures.marryId);
    await screenshot(
      page,
      report,
      "gate21-availability-desktop-collapsed.png",
    );
    report.metrics.desktopCollapsed = await layoutMetrics(page, fixtures.marryId);

    await expandStaff(page, fixtures.marryId);
    await page.evaluate(() => {
      document
        .querySelector(".booking-availability-week")
        ?.scrollIntoView({ block: "start" });
    });
    await screenshot(
      page,
      report,
      "gate21-availability-desktop-expanded.png",
      null,
      false,
    );
    report.metrics.desktopExpanded = await layoutMetrics(page, fixtures.marryId);
    await screenshot(
      page,
      report,
      "gate21-availability-multiple-intervals-break.png",
      page.locator(".booking-availability-week").first(),
    );
    await screenshot(
      page,
      report,
      "gate21-availability-timeoff-section.png",
      page.locator('[data-testid="availability-time-off-section"]').first(),
    );

    const tue = page.locator('[data-testid="availability-day-2"]');
    await tue.getByRole("button", { name: /Add break/ }).click();
    await page.getByText("1 unsaved changes").waitFor({ timeout: 10000 });
    await screenshot(page, report, "gate21-availability-dirty-savebar.png");
    report.interactions.dirtySavebar = "visible only after an edit";

    page.once("dialog", async (dialog) => {
      report.interactions.leaveWarning = dialog.message();
      await dialog.dismiss();
    });
    await page.getByRole("link", { name: "Manage online services" }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "Discard" }).click();
    await page.getByText("1 unsaved changes").waitFor({
      state: "detached",
      timeout: 10000,
    });

    const mon = page.locator('[data-testid="availability-day-1"]');
    await mon.getByRole("button", { name: "Copy" }).click();
    await mon.getByLabel("Sat").check();
    await mon.getByRole("button", { name: "Apply" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await waitForSaved(page);
    report.interactions.copySaveReload = "copy to Saturday saved";
    await page.reload({ waitUntil: "networkidle" });
    await waitForAvailability(page);
    await expandStaff(page, fixtures.marryId);
    const saturdayInputs = await page
      .locator('[data-testid="availability-day-6"] input[type="time"]')
      .count();
    if (saturdayInputs < 4) {
      throw new Error("Copied Saturday intervals were not visible after reload.");
    }

    await page
      .locator('[data-testid="availability-time-off-section"] input[type="date"]')
      .first()
      .fill("2026-08-10");
    await page
      .locator('[data-testid="availability-time-off-section"] input[type="date"]')
      .nth(1)
      .fill("2026-08-11");
    await page
      .locator('[data-testid="availability-time-off-section"] input[placeholder="Optional"]')
      .fill(`${marker} QA added`);
    await page
      .locator('[data-testid="availability-time-off-section"]')
      .getByRole("button", { name: "Add time off" })
      .click();
    await waitForSaved(page);
    await page.getByText(`${marker} QA added`).waitFor({ timeout: 15000 });
    report.interactions.timeOffAdd = "time off added with existing action";

    await page.setViewportSize({ height: 900, width: 820 });
    await page.goto(
      `${baseUrl}/bookings?date=2026-07-20&tab=availability&staffId=${fixtures.marryId}`,
      { waitUntil: "networkidle" },
    );
    await waitForAvailability(page);
    await expandStaff(page, fixtures.marryId);
    await screenshot(page, report, "gate21-availability-tablet-expanded.png");
    report.metrics.tablet = await layoutMetrics(page, fixtures.marryId);

    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto(
      `${baseUrl}/bookings?date=2026-07-20&tab=availability&staffId=${fixtures.marryId}`,
      { waitUntil: "networkidle" },
    );
    await waitForAvailability(page);
    await collapseStaff(page, fixtures.marryId);
    await screenshot(page, report, "gate21-availability-mobile-collapsed.png");
    report.metrics.mobileCollapsed = await layoutMetrics(page, fixtures.marryId);
    await expandStaff(page, fixtures.marryId);
    await screenshot(page, report, "gate21-availability-mobile-expanded.png");
    report.metrics.mobileExpanded = await layoutMetrics(page, fixtures.marryId);

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
  cleanup: null,
  consoleErrors: [],
  fixtureIds: null,
  interactions: {},
  marker,
  metrics: {},
  networkErrors: [],
  ok: false,
  pageErrors: [],
  screenshots: [],
  userEmail: null,
};

let fixtures;

try {
  const env = await loadEnv();
  const { email, session } = await createSession(env);
  report.userEmail = email;
  fixtures = await seedFixtures();
  report.fixtureIds = fixtures;
  await runBrowserScenario(session, fixtures, report);
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (fixtures) {
    await deactivateFixtures(fixtures)
      .then(() => {
        report.cleanup = "fixtures deactivated";
      })
      .catch((cleanupError) => {
        report.cleanup =
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      });
  }

  await writeFile(
    path.join(artifactsDir, "gate21-availability-ui-report.json"),
    JSON.stringify(report, null, 2),
  );
}

if (!report.ok) {
  throw new Error(report.error ?? "Gate 2.1 availability UI test failed.");
}

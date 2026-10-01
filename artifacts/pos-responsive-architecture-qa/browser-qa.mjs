import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";

const BASE_URL = process.env.POS_QA_BASE_URL ?? "http://localhost:3000";
const ARTIFACT_DIR = "artifacts/pos-responsive-architecture-qa";
const LEGACY_AUTH_USER_ID = "10101010-1010-4010-8010-101010101010";
const PUBLIC_USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "12121212-1212-4121-8121-121212121212";
const OWNER_ROLE_ID = "13131313-1313-4131-8131-131313131313";
const ACCOUNT_MEMBERSHIP_ID = "14141414-1414-4141-8141-141414141414";
const SALON_ID = "15151515-1515-4151-8151-151515151515";
const SALON_MEMBERSHIP_ID = "16161616-1616-4161-8161-161616161616";
const STAFF_ID = "17171717-1717-4171-8171-171717171717";
const SERVICE_ID = "18181818-1818-4181-8181-181818181818";
const SERVICE_ID_ALT = "19191919-1919-4191-8191-191919191919";
const PORTABLE_ACCESS_KEY_ID = "20202020-2020-4020-8020-202020202020";
const REALTIME_STAFF_ID = "21212121-2121-4121-8121-212121212121";
const REALTIME_STAFF_BOARD_LABEL = "Realtime";
const REALTIME_STAFF_NAME = "Realtime Stylist";
const EMAIL = "codex-pos-responsive-qa@example.test";
const PASSWORD = "CodexResponsiveQA!2026";
const ACCESS_ID = "codex-responsive-qa-pos";
const PASSCODE = "2468";
const STAFF_PASSCODE = "1234";
const PASSCODE_SALT = "codex-responsive-qa-salt";
const PASSCODE_DIGEST = createHash("sha256")
  .update(`${ACCESS_ID}:${PASSCODE}:${PASSCODE_SALT}`)
  .digest("hex");

function loadDotEnvLocal() {
  if (!existsSync(".env.local")) {
    return;
  }

  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);

    if (!match || process.env[match[1]]) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function createAuthClient() {
  loadDotEnvLocal();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required");
  assert.ok(supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required");

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function getPosWorkDate(timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return values.year && values.month && values.day
    ? `${values.year}-${values.month}-${values.day}`
    : new Date().toISOString().slice(0, 10);
}

function queryLinkedDatabase(sql) {
  const tempDir = mkdtempSync(join(tmpdir(), "kingpos-pos-qa-"));
  const sqlPath = join(tempDir, "query.sql");
  const command =
    process.platform === "win32" &&
    process.env.APPDATA &&
    existsSync(`${process.env.APPDATA}\\npm\\supabase.cmd`)
      ? `${process.env.APPDATA}\\npm\\supabase.cmd`
      : "supabase";

  writeFileSync(sqlPath, sql, "utf8");

  const result =
    process.platform === "win32"
      ? spawnSync(`"${command}" db query --linked --file "${sqlPath}"`, {
          encoding: "utf8",
          env: {
            ...process.env,
            SUPABASE_TELEMETRY_DISABLED: "1",
          },
          maxBuffer: 30 * 1024 * 1024,
          shell: true,
        })
      : spawnSync(command, ["db", "query", "--linked", "--file", sqlPath], {
          encoding: "utf8",
          env: {
            ...process.env,
            SUPABASE_TELEMETRY_DISABLED: "1",
          },
          maxBuffer: 30 * 1024 * 1024,
        });

  rmSync(tempDir, { force: true, recursive: true });

  assert.equal(
    result.status,
    0,
    `supabase db query failed: ${[
      result.error?.message,
      result.stderr,
      result.stdout,
    ]
      .filter(Boolean)
      .join("\n")}`,
  );

  return result.stdout;
}

function cleanupFixture() {
  queryLinkedDatabase(`
    delete from public.pos_ticket_audit_logs where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_payments where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_live_drafts where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_ticket_item_turn_parts where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_ticket_items where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_tickets where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.staff_passcode_attempts where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.staff_attendance_events where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.staff_workdays where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_portable_access_keys where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_settings where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.services where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.staff where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.salon_memberships where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.account_memberships where account_id = ${sqlString(ACCOUNT_ID)}::uuid;
    delete from public.roles where account_id = ${sqlString(ACCOUNT_ID)}::uuid;
    delete from public.locations where id = ${sqlString(SALON_ID)}::uuid;
    delete from public.accounts where id = ${sqlString(ACCOUNT_ID)}::uuid;
    delete from public.users where id = ${sqlString(PUBLIC_USER_ID)}::uuid
      or auth_user_id = ${sqlString(LEGACY_AUTH_USER_ID)}::uuid
      or email = ${sqlString(EMAIL)};
    delete from auth.identities where user_id = ${sqlString(LEGACY_AUTH_USER_ID)}::uuid
      or email = ${sqlString(EMAIL)};
    delete from auth.users where id = ${sqlString(LEGACY_AUTH_USER_ID)}::uuid
      or email = ${sqlString(EMAIL)};
  `);
}

async function createTemporaryAuthUser() {
  const supabase = createAuthClient();
  const signupResult = await supabase.auth.signUp({
    email: EMAIL,
    password: PASSWORD,
    options: {
      data: {
        display_name: "Codex POS QA Owner",
      },
    },
  });

  assert.ifError(signupResult.error);
  assert.ok(signupResult.data.user?.id, "temporary auth user is created");

  const authUserId = signupResult.data.user.id;

  if (!signupResult.data.session) {
    queryLinkedDatabase(`
      update auth.users
      set email_confirmed_at = now(), updated_at = now()
      where id = ${sqlString(authUserId)}::uuid;
    `);
  }

  const signinResult = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });

  assert.ifError(signinResult.error);
  assert.ok(signinResult.data.session, "temporary auth user can sign in");
  await supabase.auth.signOut();

  return authUserId;
}

function setupFixture(authUserId) {
  const workDate = getPosWorkDate();

  queryLinkedDatabase(`
    insert into public.users (
      id,
      auth_user_id,
      email,
      display_name,
      language,
      timezone,
      status,
      created_at,
      updated_at
    )
    values (
      ${sqlString(PUBLIC_USER_ID)}::uuid,
      ${sqlString(authUserId)}::uuid,
      ${sqlString(EMAIL)},
      'Codex POS QA Owner',
      'en',
      'America/Chicago',
      'active',
      now(),
      now()
    );

    insert into public.accounts (id, name, status, created_at, updated_at)
    values (
      ${sqlString(ACCOUNT_ID)}::uuid,
      'Codex POS QA Account',
      'active',
      now(),
      now()
    );

    insert into public.roles (
      id,
      account_id,
      name,
      code,
      description,
      is_system,
      created_at,
      updated_at
    )
    values (
      ${sqlString(OWNER_ROLE_ID)}::uuid,
      ${sqlString(ACCOUNT_ID)}::uuid,
      'Owner',
      'OWNER',
      'Temporary POS responsive QA owner',
      true,
      now(),
      now()
    );

    insert into public.account_memberships (
      id,
      account_id,
      user_id,
      role_id,
      status,
      joined_at,
      created_at,
      updated_at
    )
    values (
      ${sqlString(ACCOUNT_MEMBERSHIP_ID)}::uuid,
      ${sqlString(ACCOUNT_ID)}::uuid,
      ${sqlString(PUBLIC_USER_ID)}::uuid,
      ${sqlString(OWNER_ROLE_ID)}::uuid,
      'active',
      now(),
      now(),
      now()
    );

    insert into public.locations (
      id,
      account_id,
      name,
      phone,
      address_line1,
      city,
      state,
      postal_code,
      country,
      status,
      created_at,
      updated_at
    )
    values (
      ${sqlString(SALON_ID)}::uuid,
      ${sqlString(ACCOUNT_ID)}::uuid,
      'Codex POS Responsive Salon',
      '5550102026',
      '100 Responsive Way',
      'Chicago',
      'IL',
      '60601',
      'US',
      'active',
      now(),
      now()
    );

    insert into public.salon_memberships (
      id,
      account_id,
      salon_id,
      user_id,
      role_id,
      status,
      joined_at,
      created_at,
      updated_at
    )
    values (
      ${sqlString(SALON_MEMBERSHIP_ID)}::uuid,
      ${sqlString(ACCOUNT_ID)}::uuid,
      ${sqlString(SALON_ID)}::uuid,
      ${sqlString(PUBLIC_USER_ID)}::uuid,
      ${sqlString(OWNER_ROLE_ID)}::uuid,
      'active',
      now(),
      now(),
      now()
    );

    insert into public.staff (
      id,
      salon_id,
      display_name,
      first_name,
      last_name,
      job_title,
      is_active,
      pos_enabled,
      created_at,
      updated_at
    )
    values
      (
        ${sqlString(STAFF_ID)}::uuid,
        ${sqlString(SALON_ID)}::uuid,
        'Responsive Tech',
        'Responsive',
        'Tech',
        'Nail tech',
        true,
        true,
        now(),
        now()
      ),
      (
        ${sqlString(REALTIME_STAFF_ID)}::uuid,
        ${sqlString(SALON_ID)}::uuid,
        ${sqlString(REALTIME_STAFF_NAME)},
        'Realtime',
        'Stylist',
        'Nail tech',
        true,
        true,
        now(),
        now()
      );

    insert into public.staff_workdays (
      salon_id,
      staff_id,
      work_date,
      status,
      queue_turn_count,
      check_in_sequence
    )
    values (
      ${sqlString(SALON_ID)}::uuid,
      ${sqlString(STAFF_ID)}::uuid,
      ${sqlString(workDate)}::date,
      'working',
      2,
      1
    );

    insert into public.services (
      id,
      salon_id,
      name,
      category,
      base_price,
      duration_minutes,
      is_active,
      online_booking_enabled,
      created_at,
      updated_at
    )
    values
      (
        ${sqlString(SERVICE_ID)}::uuid,
        ${sqlString(SALON_ID)}::uuid,
        'Responsive Manicure',
        'Nails',
        35,
        30,
        true,
        true,
        now(),
        now()
      ),
      (
        ${sqlString(SERVICE_ID_ALT)}::uuid,
        ${sqlString(SALON_ID)}::uuid,
        'Responsive Pedicure',
        'Nails',
        45,
        40,
        true,
        true,
        now(),
        now()
      );

    insert into public.pos_settings (
      salon_id,
      staff_check_in_enabled,
      tip_suggestions,
      customer_promo_title,
      customer_promo_body,
      created_at,
      updated_at
    )
    values (
      ${sqlString(SALON_ID)}::uuid,
      true,
      array[15, 18, 20, 25]::numeric(12,2)[],
      'Codex POS Responsive Salon',
      'Responsive QA',
      now(),
      now()
    );

    insert into public.pos_portable_access_keys (
      id,
      salon_id,
      access_id,
      passcode_salt,
      passcode_digest,
      label,
      is_active,
      created_at,
      updated_at
    )
    values (
      ${sqlString(PORTABLE_ACCESS_KEY_ID)}::uuid,
      ${sqlString(SALON_ID)}::uuid,
      ${sqlString(ACCESS_ID)},
      ${sqlString(PASSCODE_SALT)},
      ${sqlString(PASSCODE_DIGEST)},
      'Codex POS Responsive QA',
      true,
      now(),
      now()
    );
  `);
}

function findChromiumExecutable() {
  const root = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "ms-playwright")
    : null;

  if (!root || !existsSync(root)) {
    return undefined;
  }

  const candidates = readdirSync(root)
    .filter((entry) => entry.startsWith("chromium_headless_shell-"))
    .sort()
    .reverse()
    .map((entry) =>
      join(root, entry, "chrome-headless-shell-win64", "chrome-headless-shell.exe"),
    );

  candidates.push(
    ...readdirSync(root)
      .filter((entry) => entry.startsWith("chromium-"))
      .sort()
      .reverse()
      .map((entry) => join(root, entry, "chrome-win64", "chrome.exe")),
  );

  return candidates.find((candidate) => existsSync(candidate));
}

async function loginOwner(page) {
  await page.goto(`${BASE_URL}/login?next=/pos`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").waitFor({ timeout: 90000 });
  await page.getByLabel("Email").fill(EMAIL);
  await page.locator("input[name='password']").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  try {
    await page
      .locator("[data-pos-owner-page]")
      .first()
      .waitFor({ state: "attached", timeout: 90000 });
  } catch (error) {
    await page.screenshot({
      fullPage: false,
      path: `${ARTIFACT_DIR}/owner-login-failure.png`,
    });
    console.error(
      JSON.stringify(
        {
          bodyText:
            (await page.locator("body").innerText().catch(() => "")).slice(0, 1500),
          title: await page.title().catch(() => ""),
          url: page.url(),
        },
        null,
        2,
      ),
    );
    throw error;
  }
}

async function loginPortable(page) {
  await page.goto(`${BASE_URL}/pos/portable`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "POS ID" }).waitFor({ timeout: 90000 });
  await page.getByRole("textbox", { name: "POS ID" }).fill(ACCESS_ID);
  await page.locator("input[name='passcode']").fill(PASSCODE);
  await page.getByRole("button", { name: "Open POS" }).click();
  await page.locator("[data-portable-pos-page='pos']").waitFor({ timeout: 90000 });
}

async function collectMetrics(page) {
  return page.evaluate(() => {
    const isElementVisible = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const visibleElement = (selector) =>
      Array.from(document.querySelectorAll(selector)).find(isElementVisible) ?? null;
    const visible = (selector) => Boolean(visibleElement(selector));
    const rectFor = (selector) => {
      const element = visibleElement(selector) ?? document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
      };
    };
    const text = document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const deskRoot =
      visibleElement("[data-pos-desk-root]") ??
      document.querySelector("[data-pos-desk-root]");
    const workspaceLinks = Array.from(
      document.querySelectorAll("[data-pos-workspace-shell] nav a"),
    ).map((link) => link.textContent?.replace(/\s+/g, " ").trim() ?? "");
    const viewport = { height: window.innerHeight, width: window.innerWidth };

    return {
      amountPanelVisible: visible("[data-pos-amount-panel]"),
      bodyIncludes: {
        book: text.includes("Book"),
        checkIn: /Check[- ]?in/i.test(text),
        currentTicket: /Current ticket/i.test(text),
        customerDisplay: text.includes("Customer Display"),
        customerPos: text.includes("Customer POS"),
        portablePos: text.includes("Portable POS"),
        posSetting: text.includes("POS Setting"),
        posTickets: text.includes("POS Tickets"),
        report: text.includes("Report"),
        ticket: text.includes("Ticket"),
      },
      desktopHeaderSearchVisible: visible(
        "[data-testid='customer-desktop-header'] form[role='search']",
      ),
      deskGridColumns: deskRoot ? getComputedStyle(deskRoot).gridTemplateColumns : null,
      horizontalOverflow:
        document.documentElement.scrollWidth > window.innerWidth + 1 ||
        document.body.scrollWidth > window.innerWidth + 1,
      ownerToolsVisible: visible("nav[aria-label='Owner POS tools']"),
      ownerWorkspaceTabsVisible: visible("[data-pos-owner-workspace-tabs]"),
      receiptPanelVisible: visible("[data-pos-receipt-panel]"),
      rapidBridgeAttached: Boolean(
        document.querySelector("[data-pos-rapid-mobile-bridge]"),
      ),
      rapidBridgeVisible: visible("[data-pos-rapid-total]"),
      rects: {
        amountPanel: rectFor("[data-pos-amount-panel]"),
        deskRoot: rectFor("[data-pos-desk-root]"),
        ownerTabs: rectFor("[data-pos-owner-workspace-tabs]"),
        ownerTools: rectFor("nav[aria-label='Owner POS tools']"),
        receiptPanel: rectFor("[data-pos-receipt-panel]"),
        rapidTotal: rectFor("[data-pos-rapid-total]"),
        workspaceShell: rectFor("[data-pos-workspace-shell]"),
      },
      serviceTileCount: document.querySelectorAll("[data-pos-service-tile]").length,
      staffBoardVisible: visible("[data-pos-staff-turn-board]"),
      surface: deskRoot?.getAttribute("data-pos-desk-surface") ?? null,
      url: location.href,
      viewport,
      workspaceLinks,
    };
  });
}

function assertOwnerDesktop(metrics) {
  assert.equal(metrics.surface, "standard");
  assert.equal(metrics.ownerToolsVisible, true);
  assert.equal(metrics.ownerWorkspaceTabsVisible, true);
  assert.equal(metrics.desktopHeaderSearchVisible, true);
  assert.equal(metrics.rapidBridgeAttached, false);
  assert.equal(metrics.rapidBridgeVisible, false);
  assert.equal(metrics.receiptPanelVisible, true);
  assert.equal(metrics.amountPanelVisible, true);
  assert.equal(metrics.staffBoardVisible, true);
  assert.equal(metrics.horizontalOverflow, false);
  assert.ok(metrics.serviceTileCount >= 2);
  assert.match(metrics.deskGridColumns ?? "", /\d+px\s+\d+px\s+\d+px/);
  assert.equal(metrics.bodyIncludes.portablePos, true);
  assert.equal(metrics.bodyIncludes.customerPos, true);
  assert.equal(metrics.bodyIncludes.posSetting, true);
  assert.equal(metrics.bodyIncludes.posTickets, true);
  assert.equal(metrics.bodyIncludes.customerDisplay, true);
}

function assertOwnerMobile(metrics) {
  assert.equal(metrics.surface, "standard");
  assert.equal(metrics.ownerToolsVisible, false);
  assert.equal(metrics.ownerWorkspaceTabsVisible, true);
  assert.equal(metrics.desktopHeaderSearchVisible, false);
  assert.equal(metrics.rapidBridgeAttached, true);
  assert.equal(metrics.rapidBridgeVisible, true);
  assert.equal(metrics.receiptPanelVisible, false);
  assert.equal(metrics.amountPanelVisible, false);
  assert.equal(metrics.staffBoardVisible, true);
  assert.equal(metrics.horizontalOverflow, false);
  assert.ok(metrics.rects.rapidTotal);
  assert.ok(metrics.rects.ownerTabs);
  assert.ok(metrics.rects.ownerTabs.right <= metrics.viewport.width + 1);
  assert.equal(metrics.bodyIncludes.currentTicket, true);
}

function assertPortableMobile(metrics) {
  assert.equal(metrics.surface, "portable");
  assert.equal(metrics.rapidBridgeAttached, true);
  assert.equal(metrics.rapidBridgeVisible, true);
  assert.equal(metrics.receiptPanelVisible, false);
  assert.equal(metrics.amountPanelVisible, false);
  assert.equal(metrics.staffBoardVisible, true);
  assert.equal(metrics.horizontalOverflow, false);
  assert.ok(metrics.rects.workspaceShell);
  assert.ok(metrics.rects.workspaceShell.right <= metrics.viewport.width + 1);
  assert.deepEqual(metrics.workspaceLinks, [
    "Ticket",
    "Book",
    "Check In",
    "Report",
  ]);
  assert.equal(metrics.bodyIncludes.ticket, true);
  assert.equal(metrics.bodyIncludes.book, true);
  assert.equal(metrics.bodyIncludes.checkIn, true);
  assert.equal(metrics.bodyIncludes.report, true);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function attachPageDiagnostics(page, label, diagnostics) {
  page.on("pageerror", (error) => {
    diagnostics.push(`${label} pageerror: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    const failureText = request.failure()?.errorText ?? "unknown";

    if (failureText === "net::ERR_ABORTED") {
      return;
    }

    diagnostics.push(
      `${label} requestfailed: ${request.method()} ${request.url()} ${failureText}`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      diagnostics.push(
        `${label} ${response.status()}: ${response.request().method()} ${response.url()}`,
      );
    }
  });
}

async function getPosStaffBoardText(page) {
  const board = page.locator("[data-pos-staff-turn-board]").first();
  await board.waitFor({ state: "attached", timeout: 90000 });
  return (await board.innerText()).replace(/\s+/g, " ").trim();
}

async function waitForPosStaffBoardState(page, staffName, shouldBePresent) {
  const deadline = Date.now() + 70000;
  let lastText = "";

  while (Date.now() < deadline) {
    lastText = await getPosStaffBoardText(page);
    const present = lastText.includes(staffName);

    if (present === shouldBePresent) {
      return Date.now();
    }

    await page.waitForTimeout(250);
  }

  assert.fail(
    `${staffName} should ${shouldBePresent ? "" : "not "}appear in POS staff board. Last board text: ${lastText}`,
  );
}

async function enterPasscode(page, passcode) {
  for (const digit of passcode) {
    await page.getByRole("button", { exact: true, name: digit }).click();
  }
}

async function submitPortableAttendance(page, expectedCurrentStatus, actionLabel) {
  await page.goto(`${BASE_URL}/pos/portable/check-in`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator("[data-portable-check-in-page]").waitFor({
    timeout: 90000,
  });
  await page
    .locator("button")
    .filter({ hasText: REALTIME_STAFF_NAME })
    .filter({ hasText: expectedCurrentStatus })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 15000 });

  if (actionLabel) {
    await dialog.getByRole("button", { exact: true, name: actionLabel }).click();
  }

  await enterPasscode(page, STAFF_PASSCODE);
  await dialog.getByRole("button", { exact: true, name: "Confirm" }).click();
  await page.getByRole("status").waitFor({ timeout: 90000 });
}

async function openRapidStaffPicker(page) {
  await page
    .locator("[data-pos-service-tile]")
    .filter({ hasText: "Responsive Manicure" })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 15000 });
  return dialog;
}

async function closeRapidDialog(dialog) {
  await dialog.locator("header button").first().click();
  await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
}

async function waitForRapidStaffPickerState(page, staffName, shouldBePresent) {
  const deadline = Date.now() + 70000;
  const staffNamePattern = new RegExp(escapeRegExp(staffName), "i");
  let lastText = "";

  while (Date.now() < deadline) {
    const dialog = await openRapidStaffPicker(page);
    lastText = (await dialog.innerText()).replace(/\s+/g, " ");
    const staffButton = dialog.getByRole("button", {
      name: staffNamePattern,
    });
    const present = (await staffButton.count()) > 0;

    if (present === shouldBePresent) {
      if (present) {
        const staffButtonText = (await staffButton.first().innerText()).replace(
          /\s+/g,
          " ",
        );
        assert.match(
          staffButtonText,
          /\d+/,
          "Mobile staff picker should show the compact turn number.",
        );
      }

      await closeRapidDialog(dialog);
      return Date.now();
    }

    await closeRapidDialog(dialog);
    await page.waitForTimeout(250);
  }

  assert.fail(
    `${staffName} should ${shouldBePresent ? "" : "not "}appear in rapid staff picker. Last dialog text: ${lastText}`,
  );
}

async function assertRealtimeAttendancePropagation(browser) {
  const diagnostics = [];
  const contexts = [];
  const realtimeMetrics = {};

  try {
    const ownerDesktopContext = await browser.newContext({
      viewport: { height: 900, width: 1440 },
    });
    contexts.push(ownerDesktopContext);
    const ownerDesktopPage = await ownerDesktopContext.newPage();
    attachPageDiagnostics(ownerDesktopPage, "realtime owner desktop", diagnostics);
    await loginOwner(ownerDesktopPage);
    await waitForPosStaffBoardState(
      ownerDesktopPage,
      REALTIME_STAFF_BOARD_LABEL,
      false,
    );

    const ownerMobileContext = await browser.newContext({
      viewport: { height: 844, width: 390 },
    });
    contexts.push(ownerMobileContext);
    const ownerMobilePage = await ownerMobileContext.newPage();
    attachPageDiagnostics(ownerMobilePage, "realtime owner mobile", diagnostics);
    await loginOwner(ownerMobilePage);
    await ownerMobilePage.locator("[data-pos-rapid-total]").first().waitFor({
      timeout: 90000,
    });
    await waitForRapidStaffPickerState(
      ownerMobilePage,
      REALTIME_STAFF_NAME,
      false,
    );

    const portableContext = await browser.newContext({
      viewport: { height: 844, width: 390 },
    });
    contexts.push(portableContext);
    const portableTicketPage = await portableContext.newPage();
    attachPageDiagnostics(portableTicketPage, "realtime portable ticket", diagnostics);
    await loginPortable(portableTicketPage);
    await portableTicketPage.locator("[data-pos-rapid-total]").first().waitFor({
      timeout: 90000,
    });
    await waitForRapidStaffPickerState(
      portableTicketPage,
      REALTIME_STAFF_NAME,
      false,
    );
    await portableTicketPage.waitForTimeout(1000);

    const portableCheckInPage = await portableContext.newPage();
    attachPageDiagnostics(
      portableCheckInPage,
      "realtime portable check-in",
      diagnostics,
    );

    const checkedInAt = Date.now();
    await submitPortableAttendance(
      portableCheckInPage,
      "Not checked in",
      "Check in",
    );
    realtimeMetrics.checkIn = {
      ownerDesktopMs:
        (await waitForPosStaffBoardState(
          ownerDesktopPage,
          REALTIME_STAFF_BOARD_LABEL,
          true,
        )) - checkedInAt,
      ownerMobileMs:
        (await waitForRapidStaffPickerState(
          ownerMobilePage,
          REALTIME_STAFF_NAME,
          true,
        )) - checkedInAt,
      portableTicketMs:
        (await waitForRapidStaffPickerState(
          portableTicketPage,
          REALTIME_STAFF_NAME,
          true,
        )) - checkedInAt,
    };

    const checkedOutAt = Date.now();
    await submitPortableAttendance(portableCheckInPage, "Working", "Check out");
    realtimeMetrics.checkOut = {
      ownerDesktopMs:
        (await waitForPosStaffBoardState(
          ownerDesktopPage,
          REALTIME_STAFF_BOARD_LABEL,
          false,
        )) - checkedOutAt,
      ownerMobileMs:
        (await waitForRapidStaffPickerState(
          ownerMobilePage,
          REALTIME_STAFF_NAME,
          false,
        )) - checkedOutAt,
      portableTicketMs:
        (await waitForRapidStaffPickerState(
          portableTicketPage,
          REALTIME_STAFF_NAME,
          false,
        )) - checkedOutAt,
    };

    assert.deepEqual(diagnostics, []);
    return realtimeMetrics;
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}

async function main() {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  let browser;
  const metrics = {};
  const diagnostics = [];

  try {
    cleanupFixture();
    const authUserId = await createTemporaryAuthUser();
    setupFixture(authUserId);

    browser = await chromium.launch({
      executablePath: findChromiumExecutable(),
      headless: true,
    });
    const ownerContext = await browser.newContext({
      viewport: { height: 900, width: 1440 },
    });
    const ownerPage = await ownerContext.newPage();
    attachPageDiagnostics(ownerPage, "owner visual", diagnostics);

    await loginOwner(ownerPage);
    metrics.ownerDesktop = await collectMetrics(ownerPage);
    assertOwnerDesktop(metrics.ownerDesktop);
    await ownerPage.screenshot({
      fullPage: false,
      path: `${ARTIFACT_DIR}/owner-desktop-1440x900.png`,
    });

    await ownerPage.setViewportSize({ height: 844, width: 390 });
    await ownerPage.reload({ waitUntil: "domcontentloaded" });
    await ownerPage
      .locator("[data-pos-owner-page]")
      .first()
      .waitFor({ state: "attached", timeout: 90000 });
    await ownerPage.locator("[data-pos-rapid-total]").first().waitFor({
      timeout: 90000,
    });
    metrics.ownerMobile = await collectMetrics(ownerPage);
    assertOwnerMobile(metrics.ownerMobile);
    await ownerPage.screenshot({
      fullPage: false,
      path: `${ARTIFACT_DIR}/owner-mobile-390x844.png`,
    });
    await ownerContext.close();

    const portableContext = await browser.newContext({
      viewport: { height: 844, width: 390 },
    });
    const portablePage = await portableContext.newPage();
    attachPageDiagnostics(portablePage, "portable visual", diagnostics);

    await loginPortable(portablePage);
    await portablePage.locator("[data-pos-rapid-total]").first().waitFor({
      timeout: 90000,
    });
    metrics.portableMobile = await collectMetrics(portablePage);
    assertPortableMobile(metrics.portableMobile);
    await portablePage.screenshot({
      fullPage: false,
      path: `${ARTIFACT_DIR}/portable-mobile-390x844.png`,
    });
    await portableContext.close();

    assert.deepEqual(diagnostics, []);
    metrics.realtime = await assertRealtimeAttendancePropagation(browser);

    writeFileSync(
      `${ARTIFACT_DIR}/metrics.json`,
      `${JSON.stringify(metrics, null, 2)}\n`,
      "utf8",
    );
    console.log(JSON.stringify(metrics, null, 2));
  } finally {
    await browser?.close();
    cleanupFixture();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

function getPosWorkDate(timeZone = "America/Chicago") {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  if (values.year && values.month && values.day) {
    return `${values.year}-${values.month}-${values.day}`;
  }

  return new Date().toISOString().slice(0, 10);
}

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ACCOUNT_ID = "55555555-5555-4555-8555-555555555555";
const SALON_ID = "66666666-6666-4666-8666-666666666666";
const STAFF_ID = "77777777-7777-4777-8777-777777777777";
const POS_WORK_DATE = getPosWorkDate();
const STAFF_TONE_FIXTURE = [
  {
    firstName: "Macy",
    id: "77777777-7777-4777-8777-777777777701",
    lastName: "Eight",
    name: "Macy Eight",
    queueTurns: 8,
  },
  {
    firstName: "Tracy",
    id: "77777777-7777-4777-8777-777777777702",
    lastName: "Ten",
    name: "Tracy Ten",
    queueTurns: 10,
  },
  {
    firstName: "Lucy",
    id: "77777777-7777-4777-8777-777777777703",
    lastName: "Eleven",
    name: "Lucy Eleven",
    queueTurns: 11,
  },
  {
    firstName: "David",
    id: "77777777-7777-4777-8777-777777777704",
    lastName: "Twelve",
    name: "David Twelve",
    queueTurns: 12,
  },
];
const SERVICE_ID = "88888888-8888-4888-8888-888888888888";
const EXTRA_SERVICES = [
  {
    category: "Nails",
    duration: 50,
    id: "88888888-8888-4888-8888-888888888001",
    name: "Full Set",
    price: 65,
  },
  {
    category: "Nails",
    duration: 35,
    id: "88888888-8888-4888-8888-888888888002",
    name: "Pedicure",
    price: 45,
  },
  {
    category: "Nails",
    duration: 30,
    id: "88888888-8888-4888-8888-888888888003",
    name: "Gel Polish",
    price: 28,
  },
  {
    category: "Nails",
    duration: 45,
    id: "88888888-8888-4888-8888-888888888004",
    name: "Dip Powder",
    price: 55,
  },
  {
    category: "Nails",
    duration: 15,
    id: "88888888-8888-4888-8888-888888888005",
    name: "French Tip",
    price: 12,
  },
  {
    category: "Nails",
    duration: 20,
    id: "88888888-8888-4888-8888-888888888006",
    name: "Nail Art",
    price: 18,
  },
  {
    category: "Nails",
    duration: 40,
    id: "88888888-8888-4888-8888-888888888007",
    name: "Acrylic Fill",
    price: 42,
  },
  {
    category: "Nails",
    duration: 10,
    id: "88888888-8888-4888-8888-888888888008",
    name: "Repair",
    price: 10,
  },
  {
    category: "Nails",
    duration: 15,
    id: "88888888-8888-4888-8888-888888888009",
    name: "Chrome",
    price: 20,
  },
  {
    category: "Spa",
    duration: 30,
    id: "88888888-8888-4888-8888-88888888800a",
    name: "Deluxe Spa",
    price: 58,
  },
  {
    category: "Care",
    duration: 15,
    id: "88888888-8888-4888-8888-88888888800b",
    name: "Cuticle Care",
    price: 16,
  },
];
const CUSTOMER_ID = "99999999-9999-4999-8999-999999999999";
const ACCESS_KEY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCESS_ID = "codex-browser-e2e-pos";
const PASSCODE = "2468";
const PASSCODE_SALT = "codex-browser-e2e-salt";
const PASSCODE_DIGEST = createHash("sha256")
  .update(`${ACCESS_ID}:${PASSCODE}:${PASSCODE_SALT}`)
  .digest("hex");
const CUSTOMER_PHONE = "5550102468";
const APP_DOWNLOAD_URL = "https://reylumi.com/app";
const DEFAULT_RECEIPT_BACKGROUND_URL =
  "/pos/customer-display-default-receipt-background.png";
const DEFAULT_PROMO_SLIDE_URL =
  "/pos/customer-display-default-promo-slide.png";
const OTHER_LIVE_DRAFT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_LIVE_DRAFT_TOKEN = "codex-isolated-display-token";
const VISUAL_ARTIFACT_DIR = "artifacts/customer-display-visual";
const REQUIRED_DISPLAY_VIEWPORTS = [
  { height: 1080, width: 1920 },
  { height: 1024, width: 1536 },
  { height: 768, width: 1366 },
  { height: 820, width: 1180 },
  { height: 768, width: 1024 },
];
const WAITING_DRAWER_QA_VIEWPORTS = [
  { height: 900, width: 1440 },
  { height: 768, width: 1024 },
  { height: 844, width: 390 },
];
const RECEIPT_VISIBLE_TARGETS = {
  "1024x768": 5,
  "1180x820": 6,
  "1366x768": 6,
  "1536x1024": 8,
  "1920x1080": 9,
};
const POS_VISIBLE_TARGETS = {
  "1024x768": 6,
  "1180x820": 7,
  "1366x768": 7,
  "1536x1024": 10,
  "1920x1080": 10,
};
const PORTABLE_NAV_POSITION_STORAGE_KEY = "kingpos-portable-nav-position";
const PORTABLE_NAV_CHILD_GAP = 14;
const PORTABLE_NAV_MAIN_GAP = 10;
const PORTABLE_NAV_OPEN_SETTLE_MS = 1400;

function queryLinkedDatabase(sql) {
  const tempDir = mkdtempSync(join(tmpdir(), "kingpos-browser-e2e-"));
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
    `supabase db query failed: ${
      result.error?.message ?? result.stderr ?? result.stdout
    }`,
  );

  const output = result.stdout.trim();
  const jsonStart = output.indexOf("{");
  const jsonEnd = output.lastIndexOf("}");

  assert.ok(jsonStart >= 0 && jsonEnd > jsonStart, "Expected JSON query output.");

  return JSON.parse(output.slice(jsonStart, jsonEnd + 1)).rows ?? [];
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function formatReceiptMoney(amount) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(amount);
}

function viewportLabel(viewport) {
  return `${viewport.width}x${viewport.height}`;
}

function makeReceiptLines(count) {
  const labels = [
    "Full-Set",
    "Full-Set",
    "Service 3",
    "Gel Polish",
    "Pedicure",
    "Nail Art",
    "Dip Powder",
    "French Tip",
    "Acrylic Fill",
    "Repair",
    "Chrome Finish",
    "Cuticle Care",
  ];
  const staffNames = [
    "David",
    "Tracy",
    "Macy",
    "Codexia Nailtech",
    "David",
    "Tracy",
    "Macy",
    "Codexia Nailtech",
    "David",
    "Tracy",
    "Macy",
    "Codexia Nailtech",
  ];
  const amounts = [30, 5050, 30, 42, 55, 18, 64, 20, 48, 12, 22, 16];

  return Array.from({ length: count }, (_, index) => {
    const amount = amounts[index % amounts.length];

    return {
      amount,
      amountInput: String(amount),
      amountParts: [amount],
      id: `receipt-e2e-line-${index + 1}`,
      label: labels[index % labels.length],
      serviceId: null,
      sortOrder: index + 1,
      staffId: STAFF_ID,
      staffName: staffNames[index % staffNames.length],
    };
  });
}

function receiptTotals(lines) {
  const subtotal = lines.reduce((sum, line) => sum + Number(line.amount), 0);

  return {
    discount: 0,
    subtotal,
    tax: 0,
    tip: 0,
    total: subtotal,
    totalBeforeTip: subtotal,
  };
}

function updateLiveDraftReceipt(liveDraftId, lines) {
  const totals = receiptTotals(lines);

  queryLinkedDatabase(`
    update public.pos_live_drafts
    set
      staff_lines = ${sqlString(JSON.stringify(lines))}::jsonb,
      subtotal = ${totals.subtotal},
      discount = ${totals.discount},
      tax = ${totals.tax},
      tip = ${totals.tip},
      total_before_tip = ${totals.totalBeforeTip},
      total = ${totals.total},
      customer_handoff_started_at = now(),
      selected_staff_id = ${sqlString(STAFF_ID)},
      status = 'draft',
      completed_at = null,
      reset_at = null,
      receipt_version = receipt_version + 1,
      version = version + 1,
      updated_at = now()
    where id = ${sqlString(liveDraftId)}::uuid;
  `);
}

function createIsolatedLiveDraft() {
  queryLinkedDatabase(`
    insert into public.pos_live_drafts (
      id,
      salon_id,
      token,
      staff_lines,
      subtotal,
      discount,
      tax,
      tip,
      total_before_tip,
      total,
      status,
      created_at,
      updated_at
    )
    values (
      ${sqlString(OTHER_LIVE_DRAFT_ID)}::uuid,
      ${sqlString(SALON_ID)}::uuid,
      ${sqlString(OTHER_LIVE_DRAFT_TOKEN)},
      '[]'::jsonb,
      0,
      0,
      0,
      0,
      0,
      0,
      'draft',
      now() - interval '1 day',
      now() - interval '1 day'
    );
  `);
}

function createWaitingOverflowFixture() {
  const rows = Array.from({ length: 18 }, (_, index) => {
    const suffix = String(index + 100).padStart(12, "0");
    const customerId = `99999999-9999-4999-8999-${suffix}`;
    const visitId = `bbbbbbbb-bbbb-4bbb-8bbb-${suffix}`;
    const service = EXTRA_SERVICES[index % EXTRA_SERVICES.length];

    return {
      customerId,
      name: `Overflow Guest ${String(index + 1).padStart(2, "0")} With Very Long Check In Name`,
      phone: `555019${String(index).padStart(4, "0")}`,
      serviceId: service.id,
      visitId,
    };
  });

  queryLinkedDatabase(`
    insert into public.customers (id, location_id, name, phone, status, source)
    values
      ${rows
        .map(
          (row) => `(
            ${sqlString(row.customerId)}::uuid,
            ${sqlString(SALON_ID)}::uuid,
            ${sqlString(row.name)},
            ${sqlString(row.phone)},
            'active',
            'manual'
          )`,
        )
        .join(",\n      ")};

    insert into public.customer_visits (
      id,
      salon_id,
      customer_id,
      source,
      status,
      checked_in_at
    )
    values
      ${rows
        .map(
          (row, index) => `(
            ${sqlString(row.visitId)}::uuid,
            ${sqlString(SALON_ID)}::uuid,
            ${sqlString(row.customerId)}::uuid,
            'walk_in',
            'waiting',
            now() + interval '${index + 1} minutes'
          )`,
        )
        .join(",\n      ")};

    insert into public.customer_visit_services (visit_id, service_id, sort_order)
    values
      ${rows
        .map(
          (row) => `(
            ${sqlString(row.visitId)}::uuid,
            ${sqlString(row.serviceId)}::uuid,
            1
          )`,
        )
        .join(",\n      ")};
  `);
}

function maskTokenUrl(value) {
  return value.replace(/([?&]token=)[^&\s]+/g, "$1<redacted>");
}

function cleanupFixture() {
  queryLinkedDatabase(`
    delete from public.pos_ticket_audit_logs where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_payments where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_ticket_item_turn_parts where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_ticket_items where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_tickets where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.customer_visits where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.customers where location_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_live_drafts where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_portable_access_keys where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.pos_settings where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.services where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.staff where salon_id = ${sqlString(SALON_ID)}::uuid;
    delete from public.locations where id = ${sqlString(SALON_ID)}::uuid;
    delete from public.accounts where id = ${sqlString(ACCOUNT_ID)}::uuid;
  `);
}

function setupFixture() {
  cleanupFixture();

  queryLinkedDatabase(`
    insert into public.accounts (id, name, status)
    values (${sqlString(ACCOUNT_ID)}::uuid, 'Codex Browser E2E Account', 'active');

    insert into public.locations (id, account_id, name, status, country)
    values (
      ${sqlString(SALON_ID)}::uuid,
      ${sqlString(ACCOUNT_ID)}::uuid,
      'Codex E2E Salon',
      'active',
      'US'
    );

    insert into public.staff (
      id,
      salon_id,
      display_name,
      first_name,
      last_name,
      job_title,
      is_active,
      pos_enabled
    )
    values (
      ${sqlString(STAFF_ID)}::uuid,
      ${sqlString(SALON_ID)}::uuid,
      'Codexia Nailtech',
      'Codexia',
      'Nailtech',
      'Nail tech',
      true,
      true
    );

    insert into public.staff (
      id,
      salon_id,
      display_name,
      first_name,
      last_name,
      job_title,
      is_active,
      pos_enabled
    )
    values
      ${STAFF_TONE_FIXTURE.map(
        (staff) => `(
          ${sqlString(staff.id)}::uuid,
          ${sqlString(SALON_ID)}::uuid,
          ${sqlString(staff.name)},
          ${sqlString(staff.firstName)},
          ${sqlString(staff.lastName)},
          'Nail tech',
          true,
          true
        )`,
      ).join(",\n      ")};

    insert into public.staff_workdays (
      salon_id,
      staff_id,
      work_date,
      status,
      queue_turn_count
    )
    values
      (
        ${sqlString(SALON_ID)}::uuid,
        ${sqlString(STAFF_ID)}::uuid,
        ${sqlString(POS_WORK_DATE)}::date,
        'not_checked_in',
        8
      ),
      ${STAFF_TONE_FIXTURE.map(
        (staff) => `(
          ${sqlString(SALON_ID)}::uuid,
          ${sqlString(staff.id)}::uuid,
          ${sqlString(POS_WORK_DATE)}::date,
          'not_checked_in',
          ${staff.queueTurns}
        )`,
      ).join(",\n      ")};

    insert into public.services (
      id,
      salon_id,
      name,
      category,
      base_price,
      duration_minutes,
      is_active,
      online_booking_enabled
    )
    values (
      ${sqlString(SERVICE_ID)}::uuid,
      ${sqlString(SALON_ID)}::uuid,
      'Codex Manicure',
      'Nails',
      50,
      30,
      true,
      true
    );

    insert into public.services (
      id,
      salon_id,
      name,
      category,
      base_price,
      duration_minutes,
      is_active,
      online_booking_enabled
    )
    values
      ${EXTRA_SERVICES.map(
        (service) => `(
          ${sqlString(service.id)}::uuid,
          ${sqlString(SALON_ID)}::uuid,
          ${sqlString(service.name)},
          ${sqlString(service.category)},
          ${service.price},
          ${service.duration},
          true,
          true
        )`,
      ).join(",\n      ")};

    insert into public.customers (id, location_id, name, phone, status, source)
    values (
      ${sqlString(CUSTOMER_ID)}::uuid,
      ${sqlString(SALON_ID)}::uuid,
      'Codex Customer',
      ${sqlString(CUSTOMER_PHONE)},
      'active',
      'manual'
    );

    insert into public.pos_settings (
      salon_id,
      tip_suggestions,
      customer_promo_title,
      customer_promo_body,
      app_download_url
    )
    values (
      ${sqlString(SALON_ID)}::uuid,
      array[15, 18, 20, 25]::numeric(12,2)[],
      'Codex E2E Salon',
      'Waiting for checkout.',
      ${sqlString(APP_DOWNLOAD_URL)}
    );

    insert into public.pos_portable_access_keys (
      id,
      salon_id,
      access_id,
      passcode_salt,
      passcode_digest,
      label,
      is_active
    )
    values (
      ${sqlString(ACCESS_KEY_ID)}::uuid,
      ${sqlString(SALON_ID)}::uuid,
      ${sqlString(ACCESS_ID)},
      ${sqlString(PASSCODE_SALT)},
      ${sqlString(PASSCODE_DIGEST)},
      'Codex Browser E2E',
      true
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

async function waitForBody(page, predicate, timeout = 12000) {
  await page.waitForFunction(predicate, undefined, { timeout });
}

async function expectDisabled(locator, expected, message) {
  assert.equal(await locator.isDisabled(), expected, message);
}

async function clickKeypadAmount(page, amount) {
  for (const char of amount) {
    await page.getByRole("button", { name: new RegExp(`^${char}$`) }).click();
  }
}

async function clickCustomerDisplayPhoneKeypad(page, phone) {
  await page.getByRole("textbox", { name: "Phone" }).click();
  await page
    .getByRole("heading", { name: "Enter your phone number" })
    .waitFor({ timeout: 12000 });

  for (const char of phone) {
    await page.getByRole("button", { name: `Digit ${char}` }).click();
  }
}

async function assertCustomerDisplayPhoneCopy(page) {
  await page
    .getByRole("heading", { name: "Enter your phone number" })
    .waitFor({ timeout: 12000 });
  assert.equal(
    await page.getByText("Enter customer phone").count(),
    0,
    "Old phone heading should be absent.",
  );
  assert.equal(
    await page.getByText("PHONE LOOKUP").count(),
    0,
    "PHONE LOOKUP eyebrow should be absent.",
  );
}

async function assertDownloadQrAbsent(page, message) {
  assert.equal(
    await page.locator("[data-customer-display-download-card]").count(),
    0,
    message,
  );
}

async function assertDownloadQrSafe(page, liveDraftToken) {
  const card = page.locator("[data-customer-display-download-card]");
  await card.waitFor({ timeout: 12000 });
  await page.locator("[data-customer-display-download-qr]").waitFor({
    timeout: 12000,
  });

  const url = await card.getAttribute("data-customer-display-download-url");
  assert.equal(url, APP_DOWNLOAD_URL, "QR destination should come from POS settings.");

  for (const forbidden of [
    CUSTOMER_PHONE,
    CUSTOMER_ID,
    SALON_ID,
    ACCESS_ID,
    PASSCODE,
    liveDraftToken,
  ]) {
    assert.equal(
      url?.includes(forbidden),
      false,
      `QR destination should not contain ${forbidden}.`,
    );
  }

  assert.equal(url?.includes("token="), false, "QR destination should not contain a token.");
  assert.equal(url?.includes("passcode"), false, "QR destination should not contain passcode text.");
  assert.equal(url?.includes("receipt"), false, "QR destination should not fake receipt access.");
}

async function assertDefaultReceiptBackground(page) {
  await page
    .locator("[data-customer-display-receipt-background]")
    .waitFor({ timeout: 12000 });

  const backgroundImage = await page
    .locator("[data-customer-display-receipt-background]")
    .evaluate((element) => window.getComputedStyle(element).backgroundImage);

  assert.ok(
    backgroundImage.includes(DEFAULT_RECEIPT_BACKGROUND_URL),
    `Receipt background should use default salon image, got ${backgroundImage}.`,
  );
  assert.equal(
    backgroundImage.includes(DEFAULT_PROMO_SLIDE_URL),
    false,
    "Receipt background should not fall back to the Reylumi promo slide.",
  );
}

async function assertCompletedScreenUsesDarkText(page) {
  const textMetrics = await page
    .locator("[data-customer-display-completed] h1")
    .evaluate((element) => {
      const color = window.getComputedStyle(element).color;
      const channels = (color.match(/\d+(\.\d+)?/g) ?? [])
        .slice(0, 3)
        .map(Number);

      return {
        color,
        luminance:
          channels.length === 3
            ? channels[0] * 0.2126 +
              channels[1] * 0.7152 +
              channels[2] * 0.0722
            : 255,
      };
    });

  assert.ok(
    textMetrics.luminance < 140,
    `Completed Customer Display text should be dark, got ${textMetrics.color}.`,
  );
}

async function assertIsolatedDisplayDoesNotReceiveDraft(context) {
  const isolatedDisplay = await context.newPage();

  try {
    await isolatedDisplay.goto(
      `${BASE_URL}/pos/customer-display?token=${encodeURIComponent(OTHER_LIVE_DRAFT_TOKEN)}`,
      { waitUntil: "networkidle" },
    );
    await isolatedDisplay.getByText("Codex E2E Salon").first().waitFor({
      timeout: 12000,
    });
    await isolatedDisplay.getByText("Enter your phone number").waitFor({
      timeout: 12000,
    });
    const bodyText = await isolatedDisplay.locator("body").innerText();

    assert.equal(
      bodyText.includes("$60.00"),
      false,
      "A different display token should not receive the active POS draft total.",
    );
    assert.equal(
      await isolatedDisplay.locator("[data-customer-display-receipt-line]").count(),
      0,
      "A different display token should not receive active POS receipt lines.",
    );
  } finally {
    await isolatedDisplay.close();
  }
}

async function assertCustomerDisplayKeypadGeometry(page, viewport) {
  const metrics = await page.evaluate(() => {
    const panel = document.querySelector("[data-customer-display-interaction-panel]");
    const keypad = document.querySelector("[data-customer-display-keypad-panel]");
    const panelRect = panel?.getBoundingClientRect();
    const keypadRect = keypad?.getBoundingClientRect();

    return {
      keypadRect: keypadRect
        ? {
            bottom: keypadRect.bottom,
            height: keypadRect.height,
            left: keypadRect.left,
            right: keypadRect.right,
            top: keypadRect.top,
            width: keypadRect.width,
          }
        : null,
      keys: Array.from(
        document.querySelectorAll("[data-customer-display-keypad-panel] button"),
      ).map((button) => {
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        const panelBounds = panelRect
          ? {
              bottom: panelRect.bottom,
              left: panelRect.left,
              right: panelRect.right,
              top: panelRect.top,
            }
          : null;

        return {
          ariaLabel: button.getAttribute("aria-label"),
          aspectRatio: style.aspectRatio,
          borderRadius: style.borderRadius,
          centerInsidePanel: panelBounds
            ? rect.left + rect.width / 2 >= panelBounds.left &&
              rect.left + rect.width / 2 <= panelBounds.right &&
              rect.top + rect.height / 2 >= panelBounds.top &&
              rect.top + rect.height / 2 <= panelBounds.bottom
            : false,
          clipped:
            rect.left < 0 ||
            rect.top < 0 ||
            rect.right > window.innerWidth ||
            rect.bottom > window.innerHeight,
          height: rect.height,
          width: rect.width,
        };
      }),
      panelRect: panelRect
        ? {
            bottom: panelRect.bottom,
            height: panelRect.height,
            left: panelRect.left,
            right: panelRect.right,
            top: panelRect.top,
            width: panelRect.width,
          }
        : null,
    };
  });

  assert.ok(metrics.panelRect, "Expected interaction panel to exist.");
  assert.ok(metrics.keypadRect, "Expected keypad panel to exist.");
  assert.equal(metrics.keys.length, 12, "Expected all phone keypad keys.");

  for (const key of metrics.keys) {
    assert.ok(
      key.width >= 72,
      `${key.ariaLabel} width should be at least 72px at ${viewport.width}x${viewport.height}; got ${key.width}.`,
    );
    assert.ok(
      key.height >= 72,
      `${key.ariaLabel} height should be at least 72px at ${viewport.width}x${viewport.height}; got ${key.height}.`,
    );
    assert.ok(
      Math.abs(key.width - key.height) <= 2,
      `${key.ariaLabel} should be circular at ${viewport.width}x${viewport.height}; got ${key.width}x${key.height}.`,
    );
    assert.equal(
      key.clipped,
      false,
      `${key.ariaLabel} should not be clipped at ${viewport.width}x${viewport.height}.`,
    );
    assert.equal(
      key.centerInsidePanel,
      true,
      `${key.ariaLabel} center should stay inside the interaction panel at ${viewport.width}x${viewport.height}.`,
    );
  }

  return metrics;
}

async function assertPhoneKeypadAcrossViewports(page, label) {
  const dimensions = [];

  mkdirSync(VISUAL_ARTIFACT_DIR, { recursive: true });

  for (const viewport of REQUIRED_DISPLAY_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(350);
    await assertCustomerDisplayPhoneCopy(page);
    const metrics = await assertCustomerDisplayKeypadGeometry(page, viewport);
    const firstKey = metrics.keys[0];

    dimensions.push({
      height: firstKey.height,
      viewport: `${viewport.width}x${viewport.height}`,
      width: firstKey.width,
    });

    await page.screenshot({
      fullPage: false,
      path: `${VISUAL_ARTIFACT_DIR}/${label}-${viewport.width}x${viewport.height}.png`,
    });
  }

  return dimensions;
}

async function waitForPosReceiptLines(page, expectedCount) {
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll("[data-pos-receipt-line]").length === count,
    expectedCount,
    { timeout: 12000 },
  );
}

async function waitForPosToast(page, expectations) {
  const toast = page.locator("[data-pos-toast]");

  await toast.waitFor({ timeout: 12000 });

  if (expectations.tone) {
    assert.equal(
      await toast.getAttribute("data-pos-toast-tone"),
      expectations.tone,
      `POS toast should use ${expectations.tone} tone.`,
    );
  }

  const text = await toast.innerText();

  if (expectations.title) {
    assert.match(text, expectations.title, "POS toast title should match.");
  }

  if (expectations.detail) {
    assert.match(text, expectations.detail, "POS toast detail should match.");
  }

  if (expectations.amount) {
    const amount = toast.locator("[data-pos-toast-amount]");
    await amount.waitFor({ timeout: 12000 });
    assert.match(
      await amount.innerText(),
      expectations.amount,
      "POS toast amount should match.",
    );
  }

  return toast;
}

async function assertPortablePosPolishBase(page) {
  await page.locator("[data-pos-current-input]").waitFor({ timeout: 12000 });
  await page.locator("[data-pos-service-tiles]").waitFor({ timeout: 12000 });
  await page
    .locator("[data-pos-service-tile]", { hasText: "Codex Manicure" })
    .waitFor({ timeout: 12000 });
  const visibleTileCount = await page.locator("[data-pos-service-tile]").count();

  assert.ok(
    visibleTileCount > 1 && visibleTileCount <= 10,
    `POS should show a compact capped service set; got ${visibleTileCount}.`,
  );
  const defaultTileMetrics = await page
    .locator("[data-pos-service-tile]", { hasText: "Full Set" })
    .first()
    .evaluate((tile) => {
      const style = window.getComputedStyle(tile);

      return {
        backgroundImage: style.backgroundImage,
        borderTopWidth: style.borderTopWidth,
        boxShadow: style.boxShadow,
        tagName: tile.tagName,
      };
    });

  assert.equal(defaultTileMetrics.tagName, "BUTTON");
  const serviceTileLayout = await page.evaluate(() => {
    const workspace = document.querySelector("[data-pos-service-workspace]");
    const tiles = Array.from(document.querySelectorAll("[data-pos-service-tile]"));
    const rects = tiles.map((tile) => tile.getBoundingClientRect());
    const firstTop = rects[0]?.top ?? 0;

    return {
      firstRowCount: rects.filter((rect) => Math.abs(rect.top - firstTop) <= 2)
        .length,
      maxHeight: Math.max(...rects.map((rect) => rect.height)),
      maxWidth: Math.max(...rects.map((rect) => rect.width)),
      minHeight: Math.min(...rects.map((rect) => rect.height)),
      texts: tiles.map((tile) => tile.textContent?.trim() ?? ""),
      workspaceText: workspace?.textContent ?? "",
    };
  });

  assert.ok(
    serviceTileLayout.firstRowCount >= 3,
    `POS service buttons should fit several per row; got ${serviceTileLayout.firstRowCount}.`,
  );
  assert.ok(
    serviceTileLayout.maxWidth <= 130,
    `POS service buttons should stay compact; max width ${serviceTileLayout.maxWidth}.`,
  );
  assert.ok(
    serviceTileLayout.minHeight >= 44 && serviceTileLayout.maxHeight <= 64,
    `POS service buttons should be touchable but compact; height range ${serviceTileLayout.minHeight}-${serviceTileLayout.maxHeight}.`,
  );
  assert.equal(
    serviceTileLayout.texts.every((text) => text.length > 0 && !text.includes("\n")),
    true,
    "POS service quick-pick buttons should show only the title.",
  );
  assert.equal(
    serviceTileLayout.workspaceText.includes("Manual amount"),
    false,
    "POS Services workspace should not show Manual amount helper text.",
  );
  assert.notEqual(
    defaultTileMetrics.backgroundImage,
    "none",
    "Default POS service tiles should have a visible surface treatment.",
  );
  assert.notEqual(
    defaultTileMetrics.borderTopWidth,
    "0px",
    "Default POS service tiles should have a visible border.",
  );
  assert.notEqual(
    defaultTileMetrics.boxShadow,
    "none",
    "Default POS service tiles should have subtle depth.",
  );
  assert.equal(
    await page.getByText(/No catalog/).count(),
    0,
    "Catalog-present POS should not show No catalog clutter.",
  );

  assert.equal(
    await page.locator("[data-pos-amount-summary]").count(),
    0,
    "Right sidebar should not show the old amount summary card.",
  );
  assert.equal(
    await page.locator("[data-pos-entered-amount-row]").count(),
    0,
    "Right sidebar should not duplicate entered amounts.",
  );
  assert.equal(
    await page.locator("[data-pos-amount-total]").count(),
    0,
    "Right sidebar should not duplicate the receipt total.",
  );
  const moreButton = page.locator("[data-pos-service-more]");
  await moreButton.waitFor({
    timeout: 12000,
  });
  await moreButton.click();
  const servicePicker = page.locator("[data-pos-service-picker]");
  await servicePicker.getByRole("heading", { name: "Select Service" }).waitFor({
    timeout: 12000,
  });
  await servicePicker.getByRole("button", { name: /Deluxe Spa/ }).waitFor({
    timeout: 12000,
  });
  await servicePicker.getByRole("button", { name: "Custom amount" }).waitFor({
    timeout: 12000,
  });
  assert.equal(
    await servicePicker.getByText(/No catalog/).count(),
    0,
    "Service catalog modal should use clean manual-entry wording.",
  );
  await servicePicker.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Submit" }).click();
  await waitForPosToast(page, {
    detail: /Add at least one service amount before submit\./,
    title: /POS action needs attention/,
    tone: "error",
  });
  await page.locator("[data-pos-toast]").waitFor({
    state: "detached",
    timeout: 7000,
  });
}

async function assertStaffToneBoardVisuals(page) {
  await page.locator("[data-pos-staff-turn-board]").waitFor({ timeout: 12000 });
  await page
    .locator("[data-pos-staff-tone][data-pos-staff-large-turns='12']")
    .waitFor({ timeout: 12000 });

  const metrics = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll("[data-pos-staff-tone]"),
    ).map((card) => {
      const style = window.getComputedStyle(card);

      return {
        ariaLabel: card.getAttribute("aria-label") ?? "",
        color: style.color,
        largeTurns: Number(card.getAttribute("data-pos-staff-large-turns")),
        text: card.textContent ?? "",
        title: card.getAttribute("title") ?? "",
        tone: Number(card.getAttribute("data-pos-staff-tone")),
      };
    });

    return { cards };
  });
  const cardsByTurns = new Map();

  for (const card of metrics.cards) {
    if (!cardsByTurns.has(card.largeTurns)) {
      cardsByTurns.set(card.largeTurns, []);
    }

    cardsByTurns.get(card.largeTurns).push(card);
  }

  for (const turnCount of [8, 10, 11, 12]) {
    assert.ok(
      cardsByTurns.has(turnCount),
      `Staff Turn Board should render a ${turnCount}-turn card.`,
    );
  }

  const eightTones = new Set(
    (cardsByTurns.get(8) ?? []).map((card) => card.tone),
  );
  assert.equal(eightTones.size, 1, "Equal 8-turn staff should share one tone.");
  assert.ok(
    cardsByTurns.get(8)[0].tone < cardsByTurns.get(10)[0].tone &&
      cardsByTurns.get(10)[0].tone < cardsByTurns.get(11)[0].tone &&
      cardsByTurns.get(11)[0].tone < cardsByTurns.get(12)[0].tone,
    `Staff tones should progress smoothly upward; got ${JSON.stringify(
      metrics.cards.map((card) => ({
        largeTurns: card.largeTurns,
        tone: card.tone,
      })),
    )}.`,
  );
  assert.equal(
    metrics.cards.every((card) => !/(^|\s)S\s+\d/.test(card.text)),
    true,
    "Staff cards should not show an S prefix before small turns.",
  );
  assert.equal(
    metrics.cards.every(
      (card) =>
        card.ariaLabel.includes("large turns") &&
        card.ariaLabel.includes("small turns") &&
        card.title.includes("large turns") &&
        card.title.includes("small turns"),
    ),
    true,
    "Staff cards should preserve accessible large/small turn semantics.",
  );
  assert.notEqual(
    cardsByTurns.get(12)[0].color,
    "rgb(255, 255, 255)",
    "Highest tone should remain readable with dark text, not a harsh dark card.",
  );
}

async function selectWaitingVisitFromPopover(page) {
  const waitingButton = page.locator("[data-pos-waiting-launcher]");

  await waitingButton.waitFor({ timeout: 12000 });
  await waitingButton.click();

  const drawer = page.locator("[data-pos-waiting-drawer]");
  await drawer.waitFor({ timeout: 12000 });

  const waitingBox = await waitingButton.boundingBox();
  const drawerBox = await drawer.boundingBox();

  assert.ok(waitingBox, "Waiting launcher should have a visible box.");
  assert.ok(drawerBox, "Waiting drawer should have a visible box.");
  assert.ok(
    drawerBox.y >= waitingBox.y + waitingBox.height - 4 &&
      drawerBox.y <= waitingBox.y + waitingBox.height + 24,
    `Waiting drawer should open below the launcher; launcher ${JSON.stringify(
      waitingBox,
    )}, drawer ${JSON.stringify(drawerBox)}.`,
  );
  assert.ok(
    Math.abs(drawerBox.x - waitingBox.x) <= 24 ||
      Math.abs(drawerBox.x + drawerBox.width - (waitingBox.x + waitingBox.width)) <=
        24,
    `Waiting drawer should stay visually anchored to the launcher; launcher ${JSON.stringify(
      waitingBox,
    )}, drawer ${JSON.stringify(drawerBox)}.`,
  );
  assert.equal(
    await drawer.getByRole("button", { exact: true, name: "Select" }).count(),
    0,
    "Waiting rows should not render a separate Select button.",
  );
  assert.equal(
    await drawer.getByRole("button", { name: "Remove from waiting" }).count(),
    0,
    "Remove should stay in the overflow action until opened.",
  );

  const rowButton = drawer
    .locator("[data-pos-waiting-row-select]", { hasText: "Display Walkin" })
    .first();
  await rowButton.waitFor({ timeout: 12000 });
  await rowButton.click();
  await drawer.waitFor({ state: "detached", timeout: 12000 });
  await page.getByText("Display Walkin").first().waitFor({ timeout: 12000 });

  const requestedTile = page
    .locator("[data-pos-service-tile][data-pos-requested-service='true']", {
      hasText: "Codex Manicure",
    })
    .first();
  await requestedTile.waitFor({ timeout: 12000 });
  assert.equal(
    await requestedTile.getAttribute("aria-pressed"),
    "true",
    "Requested service tile should be selected after choosing the waiting row.",
  );
  await requestedTile.click();
  assert.equal(
    await page.locator("[data-pos-toast]").count(),
    0,
    "Selecting a waiting row or service tile should not show a POS toast.",
  );
}

async function assertWaitingDrawerFitsViewport(page, viewport) {
  await page.setViewportSize(viewport);

  const waitingButton = page.locator("[data-pos-waiting-launcher]");
  await waitingButton.waitFor({ timeout: 12000 });
  await waitingButton.click();

  const drawer = page.locator("[data-pos-waiting-drawer]");
  await drawer.waitFor({ timeout: 12000 });

  const metrics = await page.evaluate(() => {
    const rectJson = (rect) => ({
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    });
    const drawerElement = document.querySelector("[data-pos-waiting-drawer]");
    const launcher = document.querySelector("[data-pos-waiting-launcher]");
    const portalLayer = document.querySelector("[data-pos-waiting-portal-layer]");
    const scrollRegion = document.querySelector(
      "[data-pos-waiting-drawer-scroll]",
    );
    const drawerRect = drawerElement?.getBoundingClientRect() ?? null;
    const topElement = drawerRect
      ? document.elementFromPoint(
          Math.min(drawerRect.right - 2, drawerRect.left + drawerRect.width / 2),
          Math.min(drawerRect.bottom - 2, drawerRect.top + 16),
        )
      : null;
    const doc = document.documentElement;
    const body = document.body;
    const scrollStyle = scrollRegion
      ? window.getComputedStyle(scrollRegion)
      : null;

    return {
      drawer: drawerElement
        ? rectJson(drawerElement.getBoundingClientRect())
        : null,
      horizontalOverflow:
        doc.scrollWidth > window.innerWidth + 1 ||
        body.scrollWidth > window.innerWidth + 1,
      launcher: launcher ? rectJson(launcher.getBoundingClientRect()) : null,
      placement:
        drawerElement?.getAttribute("data-pos-waiting-drawer-placement") ?? "",
      portalLayerParentIsBody: portalLayer?.parentElement === document.body,
      portalLayerPresent: Boolean(portalLayer),
      scrollRegion: scrollRegion
        ? {
            clientHeight: scrollRegion.clientHeight,
            overflowY: scrollStyle?.overflowY ?? "",
            scrollHeight: scrollRegion.scrollHeight,
        }
        : null,
      topElementInsideDrawer:
        Boolean(drawerElement && topElement && drawerElement.contains(topElement)),
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth,
      },
    };
  });
  const label = viewportLabel(viewport);

  assert.ok(metrics.drawer, `Waiting drawer should exist at ${label}.`);
  assert.ok(metrics.launcher, `Waiting launcher should exist at ${label}.`);
  assert.equal(
    metrics.portalLayerPresent,
    true,
    `Waiting drawer should render through a portal layer at ${label}.`,
  );
  assert.equal(
    metrics.portalLayerParentIsBody,
    true,
    `Waiting portal layer should be attached to document.body at ${label}.`,
  );
  assert.equal(
    metrics.topElementInsideDrawer,
    true,
    `Waiting drawer should be topmost above POS panels at ${label}.`,
  );
  assert.ok(metrics.scrollRegion, `Waiting drawer scroll region should exist at ${label}.`);
  assert.ok(
    metrics.drawer.left >= -1 &&
      metrics.drawer.top >= -1 &&
      metrics.drawer.right <= metrics.viewport.width + 1 &&
      metrics.drawer.bottom <= metrics.viewport.height + 1,
    `Waiting drawer should fit viewport at ${label}; got ${JSON.stringify(
      metrics.drawer,
    )}.`,
  );
  assert.equal(
    metrics.horizontalOverflow,
    false,
    `Waiting drawer should not create page horizontal overflow at ${label}.`,
  );
  assert.ok(
    metrics.drawer.top >= metrics.launcher.bottom - 4 ||
      metrics.drawer.bottom <= metrics.launcher.top + 4,
    `Waiting drawer should remain vertically connected to launcher at ${label}.`,
  );
  assert.ok(
    Math.abs(metrics.drawer.left - metrics.launcher.left) <= 32 ||
      Math.abs(metrics.drawer.right - metrics.launcher.right) <= 32 ||
      metrics.placement === "sheet",
    `Waiting drawer should remain horizontally connected to launcher at ${label}.`,
  );
  assert.ok(
    ["auto", "scroll"].includes(metrics.scrollRegion.overflowY),
    `Waiting drawer should scroll internally at ${label}.`,
  );
  assert.ok(
    metrics.scrollRegion.scrollHeight > metrics.scrollRegion.clientHeight,
    `Waiting long queue should overflow inside the drawer body at ${label}.`,
  );

  await drawer.getByRole("button", { name: "Close" }).click();
  await drawer.waitFor({ state: "detached", timeout: 12000 });
  await waitingButton.waitFor({ timeout: 12000 });
}

async function assertCustomerCheckInServiceGridCompact(page) {
  await page.setViewportSize({ height: 768, width: 1024 });
  await page
    .locator("[data-customer-display-service-card]")
    .first()
    .waitFor({ timeout: 12000 });

  const metrics = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll("[data-customer-display-service-card]"),
    );
    const cardRects = cards.map((card) => card.getBoundingClientRect());
    const firstTop = cardRects[0]?.top ?? 0;
    const firstCard = cards[0] ?? null;
    const firstCardStyle = firstCard ? window.getComputedStyle(firstCard) : null;
    const doc = document.documentElement;
    const body = document.body;

    return {
      cardCount: cards.length,
      firstCardBackgroundImage: firstCardStyle?.backgroundImage ?? "",
      firstCardBorderWidth: firstCardStyle?.borderTopWidth ?? "",
      firstCardShadow: firstCardStyle?.boxShadow ?? "",
      firstCardTagName: firstCard?.tagName ?? "",
      firstRowCount: cardRects.filter((rect) => Math.abs(rect.top - firstTop) <= 2)
        .length,
      maxCardHeight: Math.max(...cardRects.map((rect) => rect.height)),
      horizontalOverflow:
        doc.scrollWidth > window.innerWidth + 1 ||
        body.scrollWidth > window.innerWidth + 1,
    };
  });

  assert.ok(
    metrics.cardCount >= EXTRA_SERVICES.length + 1,
    `Check-in should render the full service catalog; got ${metrics.cardCount}.`,
  );
  assert.ok(
    metrics.firstRowCount >= 3,
    `Check-in service grid should fit at least 3 services per row on tablet; got ${metrics.firstRowCount}.`,
  );
  assert.ok(
    metrics.maxCardHeight <= 90,
    `Check-in service cards should stay compact; max height ${metrics.maxCardHeight}.`,
  );
  assert.equal(
    metrics.firstCardTagName,
    "BUTTON",
    "Check-in service cards should render as interactive buttons.",
  );
  assert.notEqual(
    metrics.firstCardBackgroundImage,
    "none",
    "Check-in service cards should have a visible surface treatment.",
  );
  assert.notEqual(
    metrics.firstCardBorderWidth,
    "0px",
    "Check-in service cards should have a visible border.",
  );
  assert.notEqual(
    metrics.firstCardShadow,
    "none",
    "Check-in service cards should have subtle depth.",
  );
  assert.equal(
    metrics.horizontalOverflow,
    false,
    "Check-in service grid should not create horizontal overflow.",
  );
}

async function applyPosReceiptFixture(page, liveDraftId, lines) {
  updateLiveDraftReceipt(liveDraftId, lines);
  await page.reload({ waitUntil: "networkidle" });
  await waitForPosReceiptLines(page, lines.length);
}

function angleDelta(from, to) {
  return ((to - from) % 360 + 360) % 360;
}

function centerOf(rect) {
  const left = rect.left ?? rect.x;
  const top = rect.top ?? rect.y;

  return {
    x: left + rect.width / 2,
    y: top + rect.height / 2,
  };
}

function distanceBetweenCenters(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

async function setPortableFloatingNavPosition(page, xRatio, yRatio) {
  await page.evaluate(
    ({ key, xRatio: nextXRatio, yRatio: nextYRatio }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          xRatio: nextXRatio,
          yRatio: nextYRatio,
        }),
      );
    },
    {
      key: PORTABLE_NAV_POSITION_STORAGE_KEY,
      xRatio,
      yRatio,
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("[data-portable-floating-nav-button]").waitFor({
    timeout: 12000,
  });
  await page.waitForTimeout(250);
}

async function disableNextDevOverlayPointerEvents(page) {
  await page.evaluate(() => {
    if (document.getElementById("portable-e2e-next-overlay-style")) {
      return;
    }

    const style = document.createElement("style");
    style.id = "portable-e2e-next-overlay-style";
    style.textContent = "nextjs-portal { pointer-events: none !important; }";
    document.head.appendChild(style);
  });
}

async function openPortableFloatingNav(page) {
  await disableNextDevOverlayPointerEvents(page);
  await page.locator("[data-portable-floating-nav-button]").click();
  await page.locator("[data-portable-floating-nav-menu]").waitFor({
    timeout: 12000,
  });
  await page.waitForTimeout(PORTABLE_NAV_OPEN_SETTLE_MS);
}

async function closePortableFloatingNavWithEscape(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => {
      const menu = document.querySelector("[data-portable-floating-nav-menu]");

      if (!menu) {
        return true;
      }

      return Array.from(
        document.querySelectorAll(
          "[data-portable-floating-nav-link], [data-portable-floating-nav-lock]",
        ),
      ).every((element) => window.getComputedStyle(element).pointerEvents === "none");
    },
    null,
    { timeout: 12000 },
  );
  await page.locator("[data-portable-floating-nav-menu]").waitFor({
    state: "detached",
    timeout: 12000,
  });
}

async function getPortableFloatingNavMetrics(page) {
  return page.evaluate(() => {
    const rectJson = (rect) => ({
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    });
    const centerJson = (rect) => ({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    const numbersFromCss = (value) =>
      (value.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const alphaFromCss = (value) => {
      const numbers = numbersFromCss(value);

      if (numbers.length < 4) {
        return value === "transparent" || value === "rgba(0, 0, 0, 0)"
          ? 0
          : 1;
      }

      return numbers[numbers.length - 1];
    };
    const luminanceFromCss = (value) => {
      const numbers = numbersFromCss(value);

      if (value.startsWith("oklch(") && numbers.length >= 1) {
        return numbers[0] * 2.55;
      }

      if (value.includes("srgb") && numbers.length >= 3) {
        return (
          numbers[0] * 255 * 0.2126 +
          numbers[1] * 255 * 0.7152 +
          numbers[2] * 255 * 0.0722
        );
      }

      if (numbers.length >= 3) {
        return (
          numbers[0] * 0.2126 +
          numbers[1] * 0.7152 +
          numbers[2] * 0.0722
        );
      }

      return 255;
    };
    const actionMetric = (element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      const isRoute = element.hasAttribute("data-portable-floating-nav-link");
      const id = isRoute
        ? element.getAttribute("data-portable-floating-nav-link")
        : "lock";
      const transitionDurations = style.transitionDuration
        .split(",")
        .map((value) => value.trim())
        .map((value) =>
          value.endsWith("ms")
            ? Number.parseFloat(value)
            : Number.parseFloat(value) * 1000,
        )
        .filter(Number.isFinite);
      const transitionDelays = style.transitionDelay
        .split(",")
        .map((value) => value.trim())
        .map((value) =>
          value.endsWith("ms")
            ? Number.parseFloat(value)
            : Number.parseFloat(value) * 1000,
        )
        .filter(Number.isFinite);

      return {
        ariaCurrent: element.getAttribute("aria-current"),
        ariaLabel: element.getAttribute("aria-label"),
        backgroundColor: style.backgroundColor,
        center: centerJson(rect),
        href: element.getAttribute("href"),
        id,
        orbit: {
          angle: Number.parseFloat(element.getAttribute("data-orbit-angle") ?? "NaN"),
          radius: Number.parseFloat(
            element.getAttribute("data-orbit-radius") ?? "NaN",
          ),
          ring: element.getAttribute("data-orbit-ring"),
        },
        pointerEvents: style.pointerEvents,
        rect: rectJson(rect),
        shape: {
          backgroundAlpha: alphaFromCss(style.backgroundColor),
          borderRadius: Number.parseFloat(style.borderTopLeftRadius),
          colorLuminance: luminanceFromCss(style.color),
          height: rect.height,
          width: rect.width,
        },
        text: element.textContent?.trim() ?? "",
        transitionDelayMs: transitionDelays.length
          ? Math.max(...transitionDelays)
          : 0,
        transitionDurationMs: transitionDurations.length
          ? Math.max(...transitionDurations)
          : 0,
      };
    };
    const menu = document.querySelector("[data-portable-floating-nav-menu]");
    const menuRect = menu?.getBoundingClientRect() ?? null;
    const menuStyle = menu ? window.getComputedStyle(menu) : null;
    const main = document.querySelector("[data-portable-floating-nav-button]");
    const mainRect = main?.getBoundingClientRect() ?? null;
    const brandIcon = main?.querySelector("[data-portable-floating-nav-brand-icon]");
    const brandRect = brandIcon?.getBoundingClientRect() ?? null;
    const brandStyle = brandIcon ? window.getComputedStyle(brandIcon) : null;
    const actions = Array.from(
      document.querySelectorAll(
        "[data-portable-floating-nav-link], [data-portable-floating-nav-lock]",
      ),
    ).map(actionMetric);

    return {
      actions,
      brandIcon: brandIcon
        ? {
            complete: Boolean(brandIcon.complete),
            currentSrc: brandIcon.currentSrc ?? "",
            naturalHeight: brandIcon.naturalHeight ?? 0,
            naturalWidth: brandIcon.naturalWidth ?? 0,
            rect: brandRect ? rectJson(brandRect) : null,
            shape: brandStyle
              ? {
                  borderRadius: Number.parseFloat(brandStyle.borderTopLeftRadius),
                  height: brandRect?.height ?? 0,
                  width: brandRect?.width ?? 0,
                }
              : null,
          }
        : null,
      links: actions.filter((action) => action.id !== "lock"),
      lock: actions.find((action) => action.id === "lock") ?? null,
      main: main
        ? {
            ariaControls: main.getAttribute("aria-controls"),
            ariaExpanded: main.getAttribute("aria-expanded"),
            ariaLabel: main.getAttribute("aria-label"),
            center: mainRect ? centerJson(mainRect) : null,
            rect: mainRect ? rectJson(mainRect) : null,
            shape: mainRect
              ? {
                  backgroundColor: window.getComputedStyle(main).backgroundColor,
                  backgroundLuminance: luminanceFromCss(
                    window.getComputedStyle(main).backgroundColor,
                  ),
                  borderRadius: Number.parseFloat(
                    window.getComputedStyle(main).borderTopLeftRadius,
                  ),
                  height: mainRect.height,
                  width: mainRect.width,
                }
              : null,
          }
        : null,
      menuInsideViewport: menuRect
        ? menuRect.left >= 0 &&
          menuRect.top >= 0 &&
          menuRect.right <= window.innerWidth &&
          menuRect.bottom <= window.innerHeight
        : false,
      menuSurface: menuStyle
        ? {
            backgroundColor: menuStyle.backgroundColor,
            borderTopWidth: menuStyle.borderTopWidth,
            pointerEvents: menuStyle.pointerEvents,
          }
        : null,
      viewport: {
        height: window.innerHeight,
        width: window.innerWidth,
      },
      storedPosition: window.localStorage.getItem("kingpos-portable-nav-position"),
    };
  });
}

function assertPortableFloatingNavGeometry(metrics, options = {}) {
  assert.ok(metrics.main?.rect, `${options.label ?? "Portable nav"} main button exists.`);
  assert.ok(
    metrics.main.shape.width >= 52 && metrics.main.shape.height >= 52,
    `${options.label ?? "Portable nav"} main button should stay at least 52px.`,
  );
  assert.ok(
    metrics.main.shape.backgroundLuminance >= 235,
    `${options.label ?? "Portable nav"} main button should use a white logo background.`,
  );
  assert.ok(
    Math.abs(metrics.main.shape.width - metrics.main.shape.height) <= 2 &&
      metrics.main.shape.borderRadius >= metrics.main.shape.width / 2 - 2,
    `${options.label ?? "Portable nav"} main button should be circular.`,
  );
  assert.ok(
    metrics.main.rect.left >= 0 &&
      metrics.main.rect.top >= 0 &&
      metrics.main.rect.right <= metrics.viewport.width &&
      metrics.main.rect.bottom <= metrics.viewport.height,
    `${options.label ?? "Portable nav"} main button should stay inside viewport.`,
  );
  assert.ok(metrics.brandIcon?.complete, "Reylumi R asset should load.");
  assert.ok(
    metrics.brandIcon.naturalWidth > 0 && metrics.brandIcon.naturalHeight > 0,
    "Reylumi R asset should have intrinsic dimensions.",
  );
  assert.ok(
    metrics.brandIcon.currentSrc.includes("portable-floating-menu-icon-gloss"),
    "Reylumi R asset should use the raised glossy icon.",
  );
  assert.ok(
    metrics.brandIcon.shape.borderRadius >= metrics.brandIcon.shape.width / 2 - 2,
    "Reylumi R asset should be masked as a circle without square corners.",
  );
  assert.equal(
    metrics.menuInsideViewport,
    true,
    `${options.label ?? "Portable nav"} overlay should stay inside viewport.`,
  );
  assert.deepEqual(
    metrics.menuSurface,
    {
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderTopWidth: "0px",
      pointerEvents: "none",
    },
    "Floating menu should not render a visible outer tray or surrounding circle.",
  );
  assert.deepEqual(
    metrics.links.map((link) => link.id),
    ["pos", "ticket", "checkIn", "book", "report"],
    `${options.label ?? "Portable nav"} should preserve Portable route order.`,
  );
  assert.equal(metrics.lock?.ariaLabel, "Lock Portable POS");
  assert.deepEqual(
    metrics.actions.map((action) => action.id),
    ["pos", "ticket", "checkIn", "book", "report", "lock"],
    `${options.label ?? "Portable nav"} should keep stable logical action order.`,
  );

  for (const action of metrics.actions) {
    assert.ok(
      action.shape.width >= 48 &&
        action.shape.height >= 48 &&
        Math.abs(action.shape.width - action.shape.height) <= 2 &&
        action.shape.borderRadius >= action.shape.width / 2 - 2,
      `${options.label ?? "Portable nav"} action ${action.id} should be a circular touch target.`,
    );
    assert.ok(
      action.rect.left >= 0 &&
        action.rect.top >= 0 &&
        action.rect.right <= metrics.viewport.width &&
        action.rect.bottom <= metrics.viewport.height,
      `${options.label ?? "Portable nav"} action ${action.id} should stay fully inside viewport.`,
    );
    assert.ok(
      action.shape.colorLuminance < 80,
      `${options.label ?? "Portable nav"} action ${action.id} icon should stay dark and legible.`,
    );
    assert.ok(
      action.shape.backgroundAlpha >= 0.45 && action.shape.backgroundAlpha <= 0.95,
      `${options.label ?? "Portable nav"} action ${action.id} should use a translucent light surface.`,
    );
    assert.ok(
      Number.isFinite(action.orbit.angle) &&
        Number.isFinite(action.orbit.radius) &&
        action.orbit.radius > 0,
      `${options.label ?? "Portable nav"} action ${action.id} should expose orbit metadata.`,
    );

    const distanceFromMain = distanceBetweenCenters(action.center, metrics.main.center);
    const minimumMainDistance =
      metrics.main.shape.width / 2 + action.shape.width / 2 + PORTABLE_NAV_MAIN_GAP;

    assert.ok(
      distanceFromMain >= minimumMainDistance - 2,
      `${options.label ?? "Portable nav"} action ${action.id} should not overlap the R button.`,
    );
    assert.ok(
      Math.abs(distanceFromMain - action.orbit.radius) <= 8,
      `${options.label ?? "Portable nav"} action ${action.id} should finish on its assigned orbit radius.`,
    );
  }

  for (let outer = 0; outer < metrics.actions.length; outer += 1) {
    for (let inner = outer + 1; inner < metrics.actions.length; inner += 1) {
      const left = metrics.actions[outer];
      const right = metrics.actions[inner];
      const minimumDistance =
        left.shape.width / 2 +
        right.shape.width / 2 +
        PORTABLE_NAV_CHILD_GAP -
        2;

      assert.ok(
        distanceBetweenCenters(left.center, right.center) >= minimumDistance,
        `${options.label ?? "Portable nav"} actions ${left.id} and ${right.id} should not overlap.`,
      );
    }
  }

  if (options.expectedSide) {
    const averageCenter = metrics.actions.reduce(
      (total, action) => ({
        x: total.x + action.center.x / metrics.actions.length,
        y: total.y + action.center.y / metrics.actions.length,
      }),
      { x: 0, y: 0 },
    );

    if (options.expectedSide === "left") {
      assert.ok(
        averageCenter.x < metrics.main.center.x,
        `${options.label} actions should fan inward to the left of the R: ${JSON.stringify(
          {
            actions: metrics.actions.map((action) => ({
              center: action.center,
              id: action.id,
              orbit: action.orbit,
            })),
            averageCenter,
            mainCenter: metrics.main.center,
            storedPosition: metrics.storedPosition,
          },
        )}`,
      );
    }

    if (options.expectedSide === "right") {
      assert.ok(
        averageCenter.x > metrics.main.center.x,
        `${options.label} actions should fan inward to the right of the R: ${JSON.stringify(
          {
            actions: metrics.actions.map((action) => ({
              center: action.center,
              id: action.id,
              orbit: action.orbit,
            })),
            averageCenter,
            mainCenter: metrics.main.center,
            storedPosition: metrics.storedPosition,
          },
        )}`,
      );
    }

    if (options.expectedSide === "up") {
      assert.ok(
        averageCenter.y < metrics.main.center.y,
        `${options.label} actions should fan inward above the R: ${JSON.stringify(
          {
            actions: metrics.actions.map((action) => ({
              center: action.center,
              id: action.id,
              orbit: action.orbit,
            })),
            averageCenter,
            mainCenter: metrics.main.center,
            storedPosition: metrics.storedPosition,
          },
        )}`,
      );
    }

    if (options.expectedSide === "down") {
      assert.ok(
        averageCenter.y > metrics.main.center.y,
        `${options.label} actions should fan inward below the R: ${JSON.stringify(
          {
            actions: metrics.actions.map((action) => ({
              center: action.center,
              id: action.id,
              orbit: action.orbit,
            })),
            averageCenter,
            mainCenter: metrics.main.center,
            storedPosition: metrics.storedPosition,
          },
        )}`,
      );
    }
  }

  if (options.expectFullOrbit) {
    const firstAngle = metrics.actions[0].orbit.angle;
    const expectedStep = 360 / metrics.actions.length;
    const rings = new Set(metrics.actions.map((action) => action.orbit.ring));

    assert.deepEqual(
      [...rings],
      ["inner"],
      `${options.label} should use one inner ring: ${JSON.stringify(
        {
          actions: metrics.actions.map((action) => ({
            angle: action.orbit.angle,
            id: action.id,
            radius: action.orbit.radius,
            ring: action.orbit.ring,
          })),
          mainCenter: metrics.main.center,
          storedPosition: metrics.storedPosition,
          viewport: metrics.viewport,
        },
      )}`,
    );

    for (let index = 0; index < metrics.actions.length; index += 1) {
      const actualDelta = angleDelta(firstAngle, metrics.actions[index].orbit.angle);

      assert.ok(
        Math.abs(actualDelta - expectedStep * index) <= 5,
        `${options.label} should keep stable clockwise order around the full orbit.`,
      );
    }
  }

  if (options.expectAdaptiveFan) {
    const rings = new Set(metrics.actions.map((action) => action.orbit.ring));

    assert.ok(
      rings.size >= 2 || !rings.has("inner"),
      `${options.label} should use a two-ring/adaptive fan instead of forcing one inner quarter orbit.`,
    );
  }

  if (options.maxTransitionDurationMs !== undefined) {
    for (const action of metrics.actions) {
      assert.ok(
        action.transitionDurationMs <= options.maxTransitionDurationMs,
        `${options.label} action ${action.id} should respect reduced-motion duration.`,
      );
      assert.ok(
        action.transitionDelayMs <= 1,
        `${options.label} action ${action.id} should remove stagger in reduced motion.`,
      );
    }
  }
}

async function assertPortableFloatingNavPlacement(page, placement) {
  await page.setViewportSize(placement.viewport);
  await setPortableFloatingNavPosition(page, placement.xRatio, placement.yRatio);
  const collapsedBox = await page
    .locator("[data-portable-floating-nav-button]")
    .boundingBox();

  await openPortableFloatingNav(page);
  const metrics = await getPortableFloatingNavMetrics(page);
  assertPortableFloatingNavGeometry(metrics, placement);
  await closePortableFloatingNavWithEscape(page);

  const closedBox = await page
    .locator("[data-portable-floating-nav-button]")
    .boundingBox();
  assert.ok(collapsedBox && closedBox, `${placement.label} should keep R geometry.`);
  assert.ok(
    Math.abs(centerOf(closedBox).x - centerOf(collapsedBox).x) <= 2 &&
      Math.abs(centerOf(closedBox).y - centerOf(collapsedBox).y) <= 2,
    `${placement.label} should not overwrite the saved collapsed R position: ${JSON.stringify(
      {
        collapsed: centerOf(collapsedBox),
        closed: centerOf(closedBox),
      },
    )}`,
  );
}

async function assertPortableFloatingNavAdaptivePlacements(page) {
  const placements = [
    {
      expectFullOrbit: true,
      label: "center 1024x768",
      viewport: { height: 768, width: 1024 },
      xRatio: 0.5,
      yRatio: 0.5,
    },
    {
      expectedSide: "right",
      label: "middle-left 1024x768",
      viewport: { height: 768, width: 1024 },
      xRatio: 0,
      yRatio: 0.5,
    },
    {
      expectedSide: "left",
      label: "middle-right 1024x768",
      viewport: { height: 768, width: 1024 },
      xRatio: 1,
      yRatio: 0.5,
    },
    {
      expectedSide: "down",
      label: "top-center 1024x768",
      viewport: { height: 768, width: 1024 },
      xRatio: 0.5,
      yRatio: 0,
    },
    {
      expectedSide: "up",
      label: "bottom-center 1024x768",
      viewport: { height: 768, width: 1024 },
      xRatio: 0.5,
      yRatio: 1,
    },
    {
      expectAdaptiveFan: true,
      label: "top-left corner 1024x768",
      viewport: { height: 768, width: 1024 },
      xRatio: 0,
      yRatio: 0,
    },
    {
      expectAdaptiveFan: true,
      label: "top-right corner 1024x768",
      viewport: { height: 768, width: 1024 },
      xRatio: 1,
      yRatio: 0,
    },
    {
      expectAdaptiveFan: true,
      label: "bottom-left corner 1024x768",
      viewport: { height: 768, width: 1024 },
      xRatio: 0,
      yRatio: 1,
    },
    {
      expectAdaptiveFan: true,
      label: "bottom-right corner 1024x768",
      viewport: { height: 768, width: 1024 },
      xRatio: 1,
      yRatio: 1,
    },
    {
      label: "white-dark keypad boundary 1180x820",
      viewport: { height: 820, width: 1180 },
      xRatio: 0.64,
      yRatio: 0.5,
    },
    {
      label: "center 1366x768",
      viewport: { height: 768, width: 1366 },
      xRatio: 0.5,
      yRatio: 0.5,
    },
    {
      expectedSide: "left",
      label: "right edge 1536x1024",
      viewport: { height: 1024, width: 1536 },
      xRatio: 1,
      yRatio: 0.5,
    },
    {
      label: "bottom-right corner 1920x1080",
      viewport: { height: 1080, width: 1920 },
      xRatio: 1,
      yRatio: 1,
    },
  ];

  for (const placement of placements) {
    await assertPortableFloatingNavPlacement(page, placement);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await assertPortableFloatingNavPlacement(page, {
    label: "reduced-motion center 1024x768",
    maxTransitionDurationMs: 100,
    viewport: { height: 768, width: 1024 },
    xRatio: 0.5,
    yRatio: 0.5,
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
}

async function assertPortableShell(page) {
  await page.locator("[data-portable-floating-nav-button]").waitFor({
    timeout: 12000,
  });

  const metrics = await page.evaluate(() => {
    const rectJson = (rect) => ({
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    });
    const rail = document.querySelector("[data-portable-pos-rail]");
    const floatingButtons = Array.from(
      document.querySelectorAll("[data-portable-floating-nav-button]"),
    );
    const floatingButton = floatingButtons[0] ?? null;
    const shell = document.querySelector("[data-portable-pos-shell]");
    const doc = document.documentElement;
    const body = document.body;

    return {
      bodyText: document.body.textContent ?? "",
      documentScroll:
        doc.scrollHeight > window.innerHeight + 1 ||
        doc.scrollWidth > window.innerWidth + 1 ||
        body.scrollHeight > window.innerHeight + 1 ||
        body.scrollWidth > window.innerWidth + 1,
      floatingButton: floatingButton
        ? {
            ariaLabel: floatingButton.getAttribute("aria-label"),
            brandIcon: Boolean(
              floatingButton.querySelector(
                "[data-portable-floating-nav-brand-icon]",
              ),
            ),
            rect: rectJson(floatingButton.getBoundingClientRect()),
          }
        : null,
      floatingButtonCount: floatingButtons.length,
      rail: rail
        ? {
            rect: rectJson(rail.getBoundingClientRect()),
          }
        : null,
      shell: shell
        ? {
            rect: rectJson(shell.getBoundingClientRect()),
          }
        : null,
    };
  });

  assert.ok(metrics.shell, "Portable POS shell should exist.");
  assert.equal(metrics.rail, null, "Portable POS should not render a permanent rail.");
  assert.equal(metrics.documentScroll, false, "Portable POS document should not scroll.");
  assert.equal(
    metrics.bodyText.includes("Portable POS /"),
    false,
    "Large Portable POS header text should be absent.",
  );
  assert.equal(metrics.floatingButtonCount, 1, "One floating nav control should exist.");
  assert.ok(metrics.floatingButton, "Floating nav button should exist.");
  assert.equal(
    metrics.floatingButton.ariaLabel,
    "Open portable navigation",
    "Floating nav button should have an accessible name.",
  );
  assert.ok(
    metrics.floatingButton.rect.width >= 52 &&
      metrics.floatingButton.rect.height >= 52,
    "Floating nav target should keep the refined 52px minimum size.",
  );
  assert.ok(
    Math.abs(metrics.floatingButton.rect.width - metrics.floatingButton.rect.height) <=
      2,
    "Floating nav target should be circular.",
  );
  assert.equal(
    metrics.floatingButton.brandIcon,
    true,
    "Floating nav should use the Reylumi brand icon.",
  );

  const beforeBox = await page
    .locator("[data-portable-pos-page='pos']")
    .boundingBox();

  await openPortableFloatingNav(page);
  await page.locator("[data-portable-floating-nav-button]").click();
  await page.locator("[data-portable-floating-nav-menu]").waitFor({
    state: "detached",
    timeout: 12000,
  });
  await openPortableFloatingNav(page);
  const menuMetrics = await getPortableFloatingNavMetrics(page);
  const afterBox = await page
    .locator("[data-portable-pos-page='pos']")
    .boundingBox();

  assertPortableFloatingNavGeometry(menuMetrics, {
    label: "default portable floating nav",
  });
  assert.equal(
    await page.locator("[data-portable-floating-nav-link='report']").count(),
    1,
    "Report should be shown by default for Portable devices.",
  );
  assert.equal(
    menuMetrics.links[0].ariaCurrent,
    "page",
    "POS should be active in the Portable menu.",
  );
  assert.deepEqual(
    beforeBox,
    afterBox,
    "Opening the floating menu should not change the POS page layout box.",
  );

  await closePortableFloatingNavWithEscape(page);

  await openPortableFloatingNav(page);
  await page.mouse.click(8, 8);
  await page.locator("[data-portable-floating-nav-menu]").waitFor({
    state: "detached",
    timeout: 12000,
  });

  await assertPortableFloatingNavAdaptivePlacements(page);
  await page.setViewportSize({ height: 900, width: 1440 });
  await setPortableFloatingNavPosition(page, 0.7, 0.7);

  const buttonBox = await page
    .locator("[data-portable-floating-nav-button]")
    .boundingBox();
  assert.ok(buttonBox, "Floating nav button should have a box before drag.");
  await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(buttonBox.x - 80, buttonBox.y - 60, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.equal(
    await page.locator("[data-portable-floating-nav-menu]").count(),
    0,
    "Dragging the floating nav should not open the menu.",
  );
  const draggedBox = await page
    .locator("[data-portable-floating-nav-button]")
    .boundingBox();
  assert.ok(draggedBox, "Floating nav button should have a box after drag.");
  assert.ok(
    Math.abs(draggedBox.x - buttonBox.x) > 20 ||
      Math.abs(draggedBox.y - buttonBox.y) > 20,
    "Dragging should move the floating nav control.",
  );

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("[data-portable-floating-nav-button]").waitFor({
    timeout: 12000,
  });
  const reloadedBox = await page
    .locator("[data-portable-floating-nav-button]")
    .boundingBox();
  assert.ok(reloadedBox, "Floating nav button should have a box after reload.");
  assert.ok(
    Math.abs(reloadedBox.x - draggedBox.x) <= 4 &&
      Math.abs(reloadedBox.y - draggedBox.y) <= 4,
    "Floating nav position should persist after reload.",
  );

  for (const routeId of ["ticket", "book", "pos"]) {
    await page.locator("[data-portable-floating-nav-button]").click();
    await page.locator(`[data-portable-floating-nav-link='${routeId}']`).click();
    await page.locator(`[data-portable-pos-page='${routeId}']`).waitFor({
      timeout: 12000,
    });
    await page.locator("[data-portable-floating-nav-button]").waitFor({
      timeout: 12000,
    });
  }
}

async function assertPortableLogout(browser) {
  const logoutContext = await browser.newContext({
    viewport: { height: 768, width: 1024 },
  });
  const page = await logoutContext.newPage();

  try {
    await page.goto(`${BASE_URL}/pos/portable`, { waitUntil: "networkidle" });
    await page.getByRole("textbox", { name: "POS ID" }).fill(ACCESS_ID);
    await page.getByLabel("Passcode").fill(PASSCODE);
    await page.getByRole("button", { name: "Open POS" }).click();
    await page.locator("[data-portable-floating-nav-button]").waitFor({
      timeout: 12000,
    });
    await page.locator("[data-portable-floating-nav-button]").click();
    await page.locator("[data-portable-floating-nav-lock]").click();
    await page.getByRole("button", { name: "Open POS" }).waitFor({
      timeout: 12000,
    });
  } finally {
    await logoutContext.close();
  }
}

async function getPortableReceiptMetrics(page) {
  return page.evaluate(() => {
    const rectJson = (rect) => ({
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    });
    const centerY = (rect) => rect.top + rect.height / 2;
    const doc = document.documentElement;
    const body = document.body;
    const lineRegion = document.querySelector("[data-pos-receipt-lines]");
    const totals = document.querySelector("[data-pos-receipt-totals]");
    const receiptHeader = document.querySelector("[data-pos-receipt-header]");
    const receiptPanel = document.querySelector("[data-pos-receipt-panel]");
    const staffBoard = document.querySelector("[data-pos-staff-turn-board]");
    const serviceWorkspace = document.querySelector("[data-pos-service-workspace]");
    const amountPanel = document.querySelector("[data-pos-amount-panel]");
    const currentInput = document.querySelector("[data-pos-current-input]");
    const regionRect = lineRegion?.getBoundingClientRect() ?? null;
    const visibleInRegion = (rect) =>
      regionRect
        ? rect.top >= regionRect.top - 1 && rect.bottom <= regionRect.bottom + 1
        : false;
    const rows = Array.from(document.querySelectorAll("[data-pos-receipt-line]")).map(
      (row, index, allRows) => {
        const rowRect = row.getBoundingClientRect();
        const staff = row.querySelector("[data-pos-receipt-line-staff]");
        const service = row.querySelector("[data-pos-receipt-line-service]");
        const price = row.querySelector("[data-pos-receipt-line-price]");
        const remove = row.querySelector("[data-pos-receipt-line-remove]");
        const staffRect = staff?.getBoundingClientRect() ?? null;
        const serviceRect = service?.getBoundingClientRect() ?? null;
        const priceRect = price?.getBoundingClientRect() ?? null;
        const previousRect =
          index > 0 ? allRows[index - 1].getBoundingClientRect() : null;

        return {
          fullyVisibleInRegion: visibleInRegion(rowRect),
          gapFromPrevious: previousRect ? rowRect.top - previousRect.bottom : 0,
          priceCenterWithinRow:
            Boolean(priceRect) &&
            centerY(priceRect) >= rowRect.top &&
            centerY(priceRect) <= rowRect.bottom,
          priceText: price?.textContent?.trim() ?? "",
          rect: rectJson(rowRect),
          removeAriaLabel: remove?.getAttribute("aria-label") ?? "",
          serviceCenterWithinRow:
            Boolean(serviceRect) &&
            centerY(serviceRect) >= rowRect.top &&
            centerY(serviceRect) <= rowRect.bottom,
          serviceText: service?.textContent?.trim() ?? "",
          staffCenterWithinRow:
            Boolean(staffRect) &&
            centerY(staffRect) >= rowRect.top &&
            centerY(staffRect) <= rowRect.bottom,
          staffText: staff?.textContent?.trim() ?? "",
        };
      },
    );
    const lineRegionStyle = lineRegion ? window.getComputedStyle(lineRegion) : null;

    return {
      bodyText: document.body.textContent ?? "",
      amountSummaryCount: document.querySelectorAll("[data-pos-amount-summary]")
        .length,
      amountTotalCount: document.querySelectorAll("[data-pos-amount-total]")
        .length,
      currentInputRect: currentInput
        ? rectJson(currentInput.getBoundingClientRect())
        : null,
      documentScroll:
        doc.scrollHeight > window.innerHeight + 1 ||
        doc.scrollWidth > window.innerWidth + 1 ||
        body.scrollHeight > window.innerHeight + 1 ||
        body.scrollWidth > window.innerWidth + 1,
      enteredAmountRowCount: document.querySelectorAll(
        "[data-pos-entered-amount-row]",
      ).length,
      lineRegion: lineRegion
        ? {
            clientHeight: lineRegion.clientHeight,
            overflowY: lineRegionStyle?.overflowY ?? "",
            rect: rectJson(lineRegion.getBoundingClientRect()),
            scrollHeight: lineRegion.scrollHeight,
            scrolls: lineRegion.scrollHeight > lineRegion.clientHeight + 1,
          }
        : null,
      receiptHeaderRect: receiptHeader
        ? rectJson(receiptHeader.getBoundingClientRect())
        : null,
      receiptPanelRect: receiptPanel ? rectJson(receiptPanel.getBoundingClientRect()) : null,
      rows,
      amountPanelRect: amountPanel
        ? rectJson(amountPanel.getBoundingClientRect())
        : null,
      requestedServiceTileCount: document.querySelectorAll(
        "[data-pos-service-tile][data-pos-requested-service='true']",
      ).length,
      serviceTileCount: document.querySelectorAll("[data-pos-service-tile]")
        .length,
      serviceWorkspaceRect: serviceWorkspace
        ? rectJson(serviceWorkspace.getBoundingClientRect())
        : null,
      staffBoardRect: staffBoard ? rectJson(staffBoard.getBoundingClientRect()) : null,
      totalsRect: totals ? rectJson(totals.getBoundingClientRect()) : null,
      totalsText: totals?.textContent ?? "",
      visibleItemCount: rows.filter((row) => row.fullyVisibleInRegion).length,
    };
  });
}

function assertPortableReceiptMetrics(metrics, expectedLines, viewport, options = {}) {
  const label = viewportLabel(viewport);

  assert.equal(metrics.documentScroll, false, `Portable POS document should not scroll at ${label}.`);
  assert.ok(metrics.receiptHeaderRect, `Portable receipt header should exist at ${label}.`);
  assert.ok(metrics.lineRegion, `Portable receipt line region should exist at ${label}.`);
  assert.ok(metrics.totalsRect, `Portable totals should exist at ${label}.`);
  assert.ok(metrics.staffBoardRect, `Staff Turn Board should exist at ${label}.`);
  assert.ok(metrics.serviceWorkspaceRect, `Service workspace should exist at ${label}.`);
  assert.ok(metrics.amountPanelRect, `Amount panel should exist at ${label}.`);
  assert.ok(metrics.currentInputRect, `Current input should exist at ${label}.`);
  assert.ok(metrics.serviceTileCount >= 1, `Service tiles should exist at ${label}.`);
  assert.equal(
    metrics.amountSummaryCount,
    0,
    `Old amount summary card should be absent at ${label}.`,
  );
  assert.equal(
    metrics.enteredAmountRowCount,
    0,
    `Entered amount rows should not be duplicated in the sidebar at ${label}.`,
  );
  assert.equal(
    metrics.amountTotalCount,
    0,
    `Sidebar total duplicate should be absent at ${label}.`,
  );
  assert.equal(metrics.rows.length, expectedLines.length, `Portable receipt row count at ${label}.`);

  expectedLines.forEach((line, index) => {
    const row = metrics.rows[index];

    assert.equal(row.serviceText, line.label, `Portable service row ${index + 1} at ${label}.`);
    assert.equal(row.staffText, line.staffName, `Portable staff row ${index + 1} at ${label}.`);
    assert.equal(row.priceText, formatReceiptMoney(line.amount), `Portable price row ${index + 1} at ${label}.`);
    assert.ok(
      row.removeAriaLabel.startsWith("Remove "),
      `Portable remove control should have aria-label at ${label}, row ${index + 1}.`,
    );
    assert.ok(
      row.rect.height <= 58,
      `Portable receipt row ${index + 1} should be at most 58px at ${label}; got ${row.rect.height}.`,
    );
    assert.equal(row.staffCenterWithinRow, true, `Staff should align in row ${index + 1} at ${label}.`);
    assert.equal(row.serviceCenterWithinRow, true, `Service should align in row ${index + 1} at ${label}.`);
    assert.equal(row.priceCenterWithinRow, true, `Price should align in row ${index + 1} at ${label}.`);

    if (index > 0) {
      assert.ok(
        row.gapFromPrevious <= 2,
        `Portable row gap should stay compact at ${label}; got ${row.gapFromPrevious}.`,
      );
    }
  });

  assert.equal(metrics.bodyText.includes("Parts:"), false, `Parts should be absent at ${label}.`);
  assert.equal(metrics.bodyText.includes("Note"), false, `Note textarea should be absent at ${label}.`);
  assert.equal(metrics.totalsText.includes("Total"), true, `Total should remain visible at ${label}.`);
  assert.equal(metrics.totalsText.includes("Gift card"), false, `Zero gift card should be absent at ${label}.`);

  if (options.expectNoAdjustments) {
    for (const labelText of ["Discount", "Tax", "Tip"]) {
      assert.equal(
        metrics.totalsText.includes(labelText),
        false,
        `Zero ${labelText} row should be absent at ${label}.`,
      );
    }
  }

  if (options.expectNoScroll) {
    assert.equal(
      metrics.lineRegion.scrolls,
      false,
      `Portable receipt should not scroll at ${label}; line region ${JSON.stringify(
        metrics.lineRegion,
      )}, row heights ${JSON.stringify(metrics.rows.map((row) => row.rect.height))}.`,
    );
    assert.equal(metrics.visibleItemCount, expectedLines.length, `All portable rows should fit at ${label}.`);
  }

  if (options.minVisibleItems) {
    assert.ok(
      metrics.visibleItemCount >= options.minVisibleItems,
      `Expected at least ${options.minVisibleItems} portable rows before scrolling at ${label}; got ${metrics.visibleItemCount}.`,
    );
  }
}

async function assertPortableReceiptAcrossViewports(page, expectedLines, label, options = {}) {
  const summaries = [];

  mkdirSync(VISUAL_ARTIFACT_DIR, { recursive: true });

  for (const viewport of REQUIRED_DISPLAY_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(350);
    await page
      .locator("[data-pos-receipt-lines]")
      .evaluate((element) => {
        element.scrollTop = 0;
      })
      .catch(() => {});
    const viewportName = viewportLabel(viewport);
    const metrics = await getPortableReceiptMetrics(page);
    const minVisibleItems = options.assertVisibleTargets
      ? POS_VISIBLE_TARGETS[viewportName]
      : undefined;

    assertPortableReceiptMetrics(metrics, expectedLines, viewport, {
      expectNoAdjustments: options.expectNoAdjustments,
      expectNoScroll: options.expectNoScroll,
      minVisibleItems,
    });

    await page.screenshot({
      fullPage: false,
      path: `${VISUAL_ARTIFACT_DIR}/portable-${label}-${viewportName}.png`,
    });

    summaries.push({
      lineRegionHeight: metrics.lineRegion.clientHeight,
      rowHeights: metrics.rows.map((row) => row.rect.height),
      scrolls: metrics.lineRegion.scrolls,
      viewport: viewportName,
      visibleItemsBeforeScroll: metrics.visibleItemCount,
    });
  }

  return summaries;
}

async function waitForPortableTotals(page, expectations, timeout = 12000) {
  await page.waitForFunction(
    ({ excludes, includes }) => {
      const text =
        document.querySelector("[data-pos-receipt-totals]")?.textContent ?? "";
      return (
        includes.every((item) => text.includes(item)) &&
        excludes.every((item) => !text.includes(item))
      );
    },
    {
      excludes: expectations.excludes ?? [],
      includes: expectations.includes ?? [],
    },
    { timeout },
  );
}

async function assertPortableAdjustmentsAppearAndClear(page) {
  await page.setViewportSize({ height: 900, width: 1440 });
  const amountPanel = page.locator("[data-pos-amount-panel]");
  const waitForKeypadMode = async (mode) => {
    await page.waitForFunction(
      (expectedMode) =>
        document
          .querySelector("[data-pos-amount-panel]")
          ?.getAttribute("data-pos-keypad-mode") === expectedMode,
      mode,
      { timeout: 12000 },
    );
  };

  await amountPanel.getByRole("button", { name: "Discount" }).click();
  await waitForKeypadMode("discount");
  await clickKeypadAmount(page, "5");
  await waitForPortableTotals(page, {
    includes: ["Discount", "$5,220.00"],
  });
  assert.equal(
    await page
      .locator('[data-pos-receipt-adjustment="discount"] input')
      .inputValue(),
    "5",
    "Portable discount input should hold the keyed value.",
  );

  await amountPanel.locator("[data-pos-keypad-clear]").click();
  await waitForPortableTotals(page, {
    excludes: ["Discount"],
    includes: ["Total", "$5,225.00"],
  });

  await amountPanel.getByRole("button", { name: "Tip" }).click();
  await waitForKeypadMode("tip");
  await clickKeypadAmount(page, "7");
  await waitForPortableTotals(page, { includes: ["Tip", "$5,232.00"] });
  assert.equal(
    await page.locator('[data-pos-receipt-adjustment="tip"] input').inputValue(),
    "7",
    "Portable tip input should hold the keyed value.",
  );

  await amountPanel.locator("[data-pos-keypad-clear]").click();
  await waitForPortableTotals(page, {
    excludes: ["Tip"],
    includes: ["Total", "$5,225.00"],
  });
}

async function waitForReceiptLines(page, expectedLines) {
  await page.waitForFunction(
    ({ amountText, count, lastLabel }) => {
      const rows = document.querySelectorAll("[data-customer-display-receipt-line]");

      return (
        rows.length === count &&
        Boolean(document.body.textContent?.includes(lastLabel)) &&
        Boolean(document.body.textContent?.includes(amountText))
      );
    },
    {
      amountText: formatReceiptMoney(expectedLines.at(-1)?.amount ?? 0),
      count: expectedLines.length,
      lastLabel: expectedLines.at(-1)?.label ?? "",
    },
    { timeout: 12000 },
  );
}

async function applyReceiptFixture(page, liveDraftId, lines) {
  updateLiveDraftReceipt(liveDraftId, lines);
  await page.reload({ waitUntil: "networkidle" });
  await waitForReceiptLines(page, lines);
}

async function getReceiptMetrics(page) {
  return page.evaluate(() => {
    const rectJson = (rect) => ({
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    });
    const centerY = (rect) => rect.top + rect.height / 2;
    const visible = (rect) =>
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < window.innerHeight &&
      rect.left < window.innerWidth;
    const doc = document.documentElement;
    const body = document.body;
    const lineRegion = document.querySelector("[data-customer-display-receipt-lines]");
    const columnHeader = document.querySelector(
      "[data-customer-display-receipt-column-header]",
    );
    const totals = document.querySelector("[data-customer-display-totals]");
    const summary = document.querySelector("[data-customer-display-summary]");
    const interactionPanel = document.querySelector(
      "[data-customer-display-interaction-panel]",
    );
    const receiptTitle = Array.from(document.querySelectorAll("h1")).find((heading) =>
      heading.textContent?.includes("Your Receipt"),
    );
    const currentTotal = Array.from(document.querySelectorAll("p")).find((paragraph) =>
      paragraph.textContent?.includes("Current total"),
    )?.parentElement;
    const footer = summary?.querySelector("footer") ?? null;
    const regionRect = lineRegion?.getBoundingClientRect() ?? null;
    const rows = Array.from(
      document.querySelectorAll("[data-customer-display-receipt-line]"),
    ).map((row, index, allRows) => {
      const rowRect = row.getBoundingClientRect();
      const item = row.querySelector("[data-customer-display-receipt-item]");
      const service = row.querySelector("[data-customer-display-receipt-service]");
      const staff = row.querySelector("[data-customer-display-receipt-staff]");
      const quantity = row.querySelector("[data-customer-display-receipt-quantity]");
      const amount = row.querySelector("[data-customer-display-receipt-amount]");
      const amountRect = amount?.getBoundingClientRect() ?? null;
      const serviceRect = service?.getBoundingClientRect() ?? null;
      const staffRect = staff?.getBoundingClientRect() ?? null;
      const previousRect =
        index > 0 ? allRows[index - 1].getBoundingClientRect() : null;

      return {
        amountCenterWithinRow:
          Boolean(amountRect) &&
          centerY(amountRect) >= rowRect.top &&
          centerY(amountRect) <= rowRect.bottom,
        amountText: amount?.textContent?.trim() ?? "",
        fullyVisibleInRegion: regionRect
          ? rowRect.top >= regionRect.top - 1 && rowRect.bottom <= regionRect.bottom + 1
          : false,
        gapFromPrevious: previousRect ? rowRect.top - previousRect.bottom : 0,
        itemText: item?.textContent?.trim() ?? "",
        quantityText: quantity?.textContent?.trim() ?? "",
        rect: rectJson(rowRect),
        serviceCenterWithinRow:
          Boolean(serviceRect) &&
          centerY(serviceRect) >= rowRect.top &&
          centerY(serviceRect) <= rowRect.bottom,
        serviceText: service?.textContent?.trim() ?? "",
        staffCenterWithinRow:
          Boolean(staffRect) &&
          centerY(staffRect) >= rowRect.top &&
          centerY(staffRect) <= rowRect.bottom,
        staffText: staff?.textContent?.trim() ?? "",
      };
    });
    const regionStyle = lineRegion ? window.getComputedStyle(lineRegion) : null;

    return {
      bodyText: document.body.textContent ?? "",
      columnHeader: columnHeader
        ? {
            rect: rectJson(columnHeader.getBoundingClientRect()),
            text: columnHeader.textContent ?? "",
          }
        : null,
      currentTotalRect: currentTotal ? rectJson(currentTotal.getBoundingClientRect()) : null,
      documentScroll:
        doc.scrollHeight > window.innerHeight + 1 ||
        doc.scrollWidth > window.innerWidth + 1 ||
        body.scrollHeight > window.innerHeight + 1 ||
        body.scrollWidth > window.innerWidth + 1,
      footerRect: footer ? rectJson(footer.getBoundingClientRect()) : null,
      lineRegion: lineRegion
        ? {
            clientHeight: lineRegion.clientHeight,
            overflowY: regionStyle?.overflowY ?? "",
            rect: rectJson(lineRegion.getBoundingClientRect()),
            scrollHeight: lineRegion.scrollHeight,
            scrolls: lineRegion.scrollHeight > lineRegion.clientHeight + 1,
            scrollTop: lineRegion.scrollTop,
          }
        : null,
      receiptTitleRect: receiptTitle
        ? rectJson(receiptTitle.getBoundingClientRect())
        : null,
      rightPanelRect: interactionPanel
        ? rectJson(interactionPanel.getBoundingClientRect())
        : null,
      rows,
      summaryRect: summary ? rectJson(summary.getBoundingClientRect()) : null,
      totalsRect: totals ? rectJson(totals.getBoundingClientRect()) : null,
      visibleItemCount: rows.filter((row) => row.fullyVisibleInRegion).length,
      visibleTitle: receiptTitle ? visible(receiptTitle.getBoundingClientRect()) : false,
      visibleTotals: totals ? visible(totals.getBoundingClientRect()) : false,
    };
  });
}

function assertRectStable(before, after, label, viewport) {
  assert.ok(before, `Expected ${label} before scroll at ${viewport}.`);
  assert.ok(after, `Expected ${label} after scroll at ${viewport}.`);

  for (const key of ["top", "bottom", "left", "right"]) {
    assert.ok(
      Math.abs(before[key] - after[key]) <= 1,
      `${label} should stay fixed while receipt lines scroll at ${viewport}; ${key} moved from ${before[key]} to ${after[key]}.`,
    );
  }
}

function assertReceiptMetrics(metrics, expectedLines, viewport, options = {}) {
  const label = viewportLabel(viewport);

  assert.equal(metrics.documentScroll, false, `Document should not scroll at ${label}.`);
  assert.ok(metrics.lineRegion, `Receipt line region should exist at ${label}.`);
  assert.ok(metrics.columnHeader, `Receipt column header should exist at ${label}.`);
  assert.ok(metrics.totalsRect, `Receipt totals should exist at ${label}.`);
  assert.ok(metrics.footerRect, `Receipt footer should exist at ${label}.`);
  assert.equal(metrics.visibleTitle, true, `Receipt title should remain visible at ${label}.`);
  assert.equal(metrics.visibleTotals, true, `Receipt totals should remain visible at ${label}.`);
  assert.equal(
    metrics.columnHeader.rect.height >= 28 && metrics.columnHeader.rect.height <= 36,
    true,
    `Receipt column header should be compact at ${label}; got ${metrics.columnHeader.rect.height}.`,
  );
  assert.equal(metrics.rows.length, expectedLines.length, `Receipt row count at ${label}.`);

  expectedLines.forEach((line, index) => {
    const row = metrics.rows[index];
    const expectedQuantity =
      line.amountParts.length > 1 ? `\u00d7${line.amountParts.length}` : "";

    assert.equal(row.serviceText, line.label, `Receipt service order at ${label}, row ${index + 1}.`);
    assert.equal(row.staffText, line.staffName, `Receipt staff order at ${label}, row ${index + 1}.`);
    assert.equal(row.quantityText, expectedQuantity, `Receipt quantity at ${label}, row ${index + 1}.`);
    assert.equal(row.amountText, formatReceiptMoney(line.amount), `Receipt amount at ${label}, row ${index + 1}.`);
    assert.ok(
      row.rect.height <= 54,
      `Receipt row ${index + 1} should be at most 54px at ${label}; got ${row.rect.height}.`,
    );
    assert.equal(
      row.serviceCenterWithinRow,
      true,
      `Receipt service should align within row ${index + 1} at ${label}.`,
    );
    assert.equal(
      row.staffCenterWithinRow,
      true,
      `Receipt staff should align within row ${index + 1} at ${label}.`,
    );
    assert.equal(
      row.amountCenterWithinRow,
      true,
      `Receipt amount should align within row ${index + 1} at ${label}.`,
    );

    if (index > 0) {
      assert.ok(
        row.gapFromPrevious <= 2,
        `Receipt row gap should stay compact at ${label}; got ${row.gapFromPrevious}.`,
      );
    }
  });

  if (expectedLines.length > 0) {
    const firstOffset = metrics.rows[0].rect.top - metrics.lineRegion.rect.top;

    assert.ok(
      firstOffset <= 2,
      `Receipt rows should begin at the top of the line region at ${label}; got ${firstOffset}.`,
    );
  }

  if (options.expectNoScroll) {
    assert.equal(
      metrics.lineRegion.scrolls,
      false,
      `Receipt should not require item scrolling at ${label}.`,
    );
    assert.equal(
      metrics.visibleItemCount,
      expectedLines.length,
      `Every receipt item should be fully visible at ${label}.`,
    );
  }

  if (options.minVisibleItems) {
    assert.ok(
      metrics.visibleItemCount >= options.minVisibleItems,
      `Expected at least ${options.minVisibleItems} visible receipt items before scrolling at ${label}; got ${metrics.visibleItemCount}.`,
    );
  }

  assert.equal(
    metrics.bodyText.includes(STAFF_ID),
    false,
    `Receipt should not expose staff UUID internals at ${label}.`,
  );
  assert.equal(
    metrics.bodyText.includes("receipt-e2e-line-"),
    false,
    `Receipt should not expose receipt line ids at ${label}.`,
  );
  assert.equal(
    metrics.bodyText.includes("Parts"),
    false,
    `Receipt should not expose Parts at ${label}.`,
  );
}

async function assertReceiptAcrossViewports(page, expectedLines, label, options = {}) {
  const summaries = [];

  mkdirSync(VISUAL_ARTIFACT_DIR, { recursive: true });

  for (const viewport of REQUIRED_DISPLAY_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(350);
    await page
      .locator("[data-customer-display-receipt-lines]")
      .evaluate((element) => {
        element.scrollTop = 0;
      })
      .catch(() => {});
    const viewportName = viewportLabel(viewport);
    const metrics = await getReceiptMetrics(page);
    const minVisibleItems = options.assertVisibleTargets
      ? RECEIPT_VISIBLE_TARGETS[viewportName]
      : undefined;

    assertReceiptMetrics(metrics, expectedLines, viewport, {
      expectNoScroll: options.expectNoScroll,
      minVisibleItems,
    });
    await page.screenshot({
      fullPage: false,
      path: `${VISUAL_ARTIFACT_DIR}/${label}-${viewportName}.png`,
    });

    summaries.push({
      lineRegionHeight: metrics.lineRegion.clientHeight,
      rowHeights: metrics.rows.map((row) => row.rect.height),
      scrolls: metrics.lineRegion.scrolls,
      viewport: viewportName,
      visibleItemsBeforeScroll: metrics.visibleItemCount,
    });
  }

  return summaries;
}

async function assertLongReceiptScrollsOnlyLineRegion(page, expectedLines) {
  const summaries = [];

  for (const viewport of REQUIRED_DISPLAY_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(350);
    await page
      .locator("[data-customer-display-receipt-lines]")
      .evaluate((element) => {
        element.scrollTop = 0;
      })
      .catch(() => {});

    const before = await getReceiptMetrics(page);
    const viewportName = viewportLabel(viewport);

    assertReceiptMetrics(before, expectedLines, viewport, {
      minVisibleItems: RECEIPT_VISIBLE_TARGETS[viewportName],
    });
    assert.equal(
      before.lineRegion.scrolls,
      true,
      `Long receipt should require line-region scrolling at ${viewportName}.`,
    );

    await page.locator("[data-customer-display-receipt-lines]").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForTimeout(150);

    const after = await getReceiptMetrics(page);
    const lastRow = after.rows.at(-1);

    assert.ok(lastRow?.fullyVisibleInRegion, `Last receipt row should be reachable at ${viewportName}.`);
    assert.ok(after.lineRegion.scrollTop > 0, `Line region should scroll at ${viewportName}.`);
    assert.equal(after.documentScroll, false, `Document should not scroll after line scroll at ${viewportName}.`);
    assertRectStable(before.receiptTitleRect, after.receiptTitleRect, "Receipt title", viewportName);
    assertRectStable(before.currentTotalRect, after.currentTotalRect, "Current total", viewportName);
    assertRectStable(before.totalsRect, after.totalsRect, "Totals summary", viewportName);
    assertRectStable(before.footerRect, after.footerRect, "Receipt footer", viewportName);
    assertRectStable(before.rightPanelRect, after.rightPanelRect, "Right interaction panel", viewportName);

    await page.screenshot({
      fullPage: false,
      path: `${VISUAL_ARTIFACT_DIR}/receipt-long-scrolled-${viewportName}.png`,
    });

    summaries.push({
      lineRegionHeight: before.lineRegion.clientHeight,
      rowHeights: before.rows.map((row) => row.rect.height),
      scrolls: before.lineRegion.scrolls,
      viewport: viewportName,
      visibleItemsBeforeScroll: before.visibleItemCount,
    });
  }

  return summaries;
}

async function captureDisplayScreenshots(page, label) {
  mkdirSync(VISUAL_ARTIFACT_DIR, { recursive: true });

  for (const viewport of REQUIRED_DISPLAY_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(350);
    await page.screenshot({
      fullPage: false,
      path: `${VISUAL_ARTIFACT_DIR}/${label}-${viewportLabel(viewport)}.png`,
    });
  }
}

async function installDisplayClock(page) {
  await page.addInitScript(() => {
    const realNow = Date.now.bind(Date);

    Object.defineProperty(window, "__kingposDisplayClockOffsetMs", {
      configurable: true,
      value: 0,
      writable: true,
    });

    Date.now = () => realNow() + window.__kingposDisplayClockOffsetMs;
  });
}

async function advanceDisplayClock(page, milliseconds) {
  await page.evaluate((offset) => {
    window.__kingposDisplayClockOffsetMs =
      (window.__kingposDisplayClockOffsetMs ?? 0) + offset;
  }, milliseconds);
  await page.waitForTimeout(1200);
}

async function assertDisplayViewportHealth(page, sizes) {
  for (const viewport of sizes) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(350);

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const candidates = Array.from(
        document.querySelectorAll(
          [
            "[data-customer-display-attract]",
            "[data-customer-display-checkin-shell]",
            "[data-customer-display-checkout]",
            "[data-customer-display-summary]",
            "[data-customer-display-interaction-panel]",
            "[data-customer-display-service-select]",
            "[data-customer-display-completed]",
          ].join(","),
        ),
      );
      const overflowing = candidates
        .filter((element) => {
          const style = window.getComputedStyle(element);
          const verticalScrollable =
            ["auto", "scroll"].includes(style.overflowY) &&
            element.scrollHeight > element.clientHeight + 1;
          const horizontalScrollable =
            ["auto", "scroll"].includes(style.overflowX) &&
            element.scrollWidth > element.clientWidth + 1;

          return verticalScrollable || horizontalScrollable;
        })
        .map((element) => element.getAttribute("data-customer-display-attract")
          ?? element.getAttribute("data-customer-display-checkout")
          ?? element.getAttribute("data-customer-display-checkin-shell")
          ?? element.getAttribute("data-customer-display-summary")
          ?? element.getAttribute("data-customer-display-interaction-panel")
          ?? element.getAttribute("data-customer-display-service-select")
          ?? element.getAttribute("data-customer-display-completed")
          ?? element.tagName);
      const panel = document.querySelector("[data-customer-display-interaction-panel]");
      const totalTextVisible = Boolean(document.body.textContent?.includes("Current total"));
      const phoneTextVisible = Boolean(
        document.body.textContent?.includes("Enter your phone number"),
      );
      const serviceSelectVisible = Boolean(
        document.body.textContent?.includes("What are you here for?"),
      );
      const attractTextVisible = Boolean(
        document.body.textContent?.includes("Touch anywhere to begin"),
      );
      const completedTextVisible = Boolean(document.body.textContent?.includes("Thank you"));
      const primaryVisible = Boolean(
        panel || phoneTextVisible || serviceSelectVisible || attractTextVisible || completedTextVisible,
      );

      return {
        documentScroll:
          doc.scrollHeight > window.innerHeight + 1 ||
          doc.scrollWidth > window.innerWidth + 1 ||
          body.scrollHeight > window.innerHeight + 1 ||
          body.scrollWidth > window.innerWidth + 1,
        overflowing,
        primaryVisible,
        totalOrStateVisible:
          totalTextVisible ||
          phoneTextVisible ||
          serviceSelectVisible ||
          attractTextVisible ||
          completedTextVisible,
      };
    });

    assert.equal(
      metrics.documentScroll,
      false,
      `Expected no document scroll at ${viewport.width}x${viewport.height}.`,
    );
    assert.deepEqual(
      metrics.overflowing,
      [],
      `Expected no primary internal scrollbars at ${viewport.width}x${viewport.height}.`,
    );
    assert.equal(
      metrics.primaryVisible,
      true,
      `Expected a primary display state at ${viewport.width}x${viewport.height}.`,
    );
    assert.equal(
      metrics.totalOrStateVisible,
      true,
      `Expected total or state prompt to remain visible at ${viewport.width}x${viewport.height}.`,
    );
  }
}

async function main() {
  setupFixture();

  const browser = await chromium.launch({
    executablePath: findChromiumExecutable(),
    headless: true,
  });
  const context = await browser.newContext({ viewport: { height: 900, width: 1440 } });
  const pos = await context.newPage();
  const display = await context.newPage();
  const consoleErrors = [];
  const interestingResponses = [];
  const networkErrors = [];
  const marks = [];
  const mark = (label) => marks.push(`${Date.now()} ${label}`);
  let keypadDimensions = [];
  let portableReceiptGeometry = {};
  let receiptGeometry = {};
  let liveDraftId = null;
  let liveDraftToken = null;

  for (const page of [pos, display]) {
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(error.message);
    });
    page.on("response", (response) => {
      const url = response.url();
      const request = response.request();

      if (
        request.method() !== "GET" &&
        !url.includes("/_next/static/")
      ) {
        interestingResponses.push(
          `${request.method()} ${response.status()} ${maskTokenUrl(url)}`,
        );
      }

      if (
        response.status() >= 400 &&
        !url.includes("/_next/static/") &&
        !url.includes("/brand/")
      ) {
        networkErrors.push(`${response.status()} ${url}`);
      }
    });
  }

  try {
    await pos.goto(`${BASE_URL}/pos/portable`, { waitUntil: "networkidle" });
    await pos.getByRole("textbox", { name: "POS ID" }).fill(ACCESS_ID);
    await pos.getByLabel("Passcode").fill(PASSCODE);
    await pos.getByRole("button", { name: "Open POS" }).click();
    await pos.getByText("Codex E2E Salon").first().waitFor({ timeout: 12000 });
    await assertPortableShell(pos);
    await assertPortablePosPolishBase(pos);
    await assertStaffToneBoardVisuals(pos);

    const setupContext = await browser.newContext({
      viewport: { height: 1024, width: 768 },
    });
    const setupDisplay = await setupContext.newPage();
    await setupDisplay.goto(`${BASE_URL}/pos/customer-display/setup`, {
      waitUntil: "networkidle",
    });
    await setupDisplay.getByRole("textbox", { name: "POS ID" }).fill(ACCESS_ID);
    await setupDisplay.getByLabel("Passcode").fill(PASSCODE);
    await setupDisplay.getByRole("button", { name: "Pair Display" }).click();
    await setupDisplay
      .getByText("Codex E2E Salon")
      .first()
      .waitFor({ timeout: 12000 });
    assert.ok(
      !setupDisplay.url().includes("token="),
      "Customer Display setup should not expose the live draft token in the URL.",
    );
    await setupContext.close();

    const liveDraftRows = queryLinkedDatabase(`
      select id, token
      from public.pos_live_drafts
      where salon_id = ${sqlString(SALON_ID)}::uuid
      order by updated_at desc
      limit 1;
    `);
    assert.equal(liveDraftRows.length, 1);
    liveDraftId = liveDraftRows[0].id;
    liveDraftToken = liveDraftRows[0].token;
    createIsolatedLiveDraft();

    const sessionDisplay = await context.newPage();
    await sessionDisplay.goto(`${BASE_URL}/pos/customer-display`, {
      waitUntil: "networkidle",
    });
    await sessionDisplay
      .getByText("Codex E2E Salon")
      .first()
      .waitFor({ timeout: 12000 });
    assert.ok(
      !(await sessionDisplay.locator("body").innerText()).includes("Your salon"),
      "Customer Display without an explicit token should use the POS session salon.",
    );
    await sessionDisplay.close();

    await installDisplayClock(display);
    await display.goto(
      `${BASE_URL}/pos/customer-display?token=${encodeURIComponent(liveDraftToken)}`,
      { waitUntil: "networkidle" },
    );
    await display.getByText("Codex E2E Salon").first().waitFor({ timeout: 12000 });
    await assertCustomerDisplayPhoneCopy(display);
    await assertDownloadQrAbsent(display, "QR should be absent before phone confirmation.");
    assert.ok(
      !(await display.locator("body").innerText()).includes("Welcome back"),
      "Pre-lookup Customer Display should not say Welcome back.",
    );
    assert.equal(
      await display.getByText("Waiting for services").count(),
      0,
      "Idle check-in should not show an empty receipt message.",
    );
    assert.equal(
      await display.locator("[data-customer-display-summary]").count(),
      0,
      "Idle check-in should not render the receipt summary.",
    );
    await assertDisplayViewportHealth(display, REQUIRED_DISPLAY_VIEWPORTS);
    await captureDisplayScreenshots(display, "idle-checkin");
    keypadDimensions = await assertPhoneKeypadAcrossViewports(display, "phone-initial");
    await display.setViewportSize({ height: 900, width: 1440 });
    const confirmPhone = display.getByRole("button", {
      name: "Confirm phone number",
    });
    await expectDisabled(confirmPhone, true, "Confirm should start disabled.");
    const phoneTextbox = display.getByRole("textbox", { name: "Phone" });
    await display.getByRole("button", { name: "Digit 1" }).click();
    await display.getByRole("button", { name: "Digit 2" }).click();
    assert.equal(await phoneTextbox.inputValue(), "(12");
    await expectDisabled(confirmPhone, true, "Confirm should stay disabled before 4 digits.");
    await display.getByRole("button", { name: "Digit 3" }).click();
    await display.getByRole("button", { name: "Digit 4" }).click();
    await expectDisabled(confirmPhone, false, "Confirm should enable at 4 digits.");
    await display.getByRole("button", { name: "Clear" }).click();
    assert.equal(await phoneTextbox.inputValue(), "");
    await expectDisabled(confirmPhone, true, "Confirm should be disabled after clear.");
    await display.getByRole("button", { name: "Digit 5" }).click();
    await display.getByRole("button", { name: "Digit 6" }).click();
    await display.getByRole("button", { name: "Backspace" }).click();
    assert.equal(await phoneTextbox.inputValue(), "(5");
    await display.getByRole("button", { name: "Clear" }).click();

    await clickCustomerDisplayPhoneKeypad(display, "5550107777");
    await display
      .getByRole("heading", { name: "Enter customer name" })
      .waitFor({ timeout: 12000 });
    await display.getByLabel("Customer name").fill("Display Walkin");
    await display.getByRole("button", { name: "Continue" }).click();
    await display
      .getByRole("heading", { name: "What are you here for?" })
      .waitFor({ timeout: 12000 });
    assert.equal(
      await display.locator("[data-customer-display-summary]").count(),
      0,
      "Check-in service selection should not render a receipt summary.",
    );
    await assertCustomerCheckInServiceGridCompact(display);
    await display.setViewportSize({ height: 900, width: 1440 });
    await display.getByRole("button", { name: /Codex Manicure/ }).click();
    await display.getByRole("button", { name: "Check in" }).click();
    await display
      .getByRole("heading", { name: "You are checked in" })
      .waitFor({ timeout: 12000 });
    await display.getByText("Codex Manicure").waitFor({ timeout: 12000 });
    const selectedServiceRows = queryLinkedDatabase(`
      select services.id as service_id
      from public.customer_visits visits
      join public.customers customers
        on customers.id = visits.customer_id
       and customers.location_id = visits.salon_id
      join public.customer_visit_services visit_services
        on visit_services.visit_id = visits.id
      join public.services services
        on services.id = visit_services.service_id
      where visits.salon_id = ${sqlString(SALON_ID)}::uuid
        and public.normalize_customer_claim_phone(customers.phone) = public.normalize_customer_claim_phone('5550107777')
      order by visit_services.sort_order;
    `);

    assert.deepEqual(
      selectedServiceRows.map((row) => row.service_id),
      [SERVICE_ID],
    );
    await waitForBody(
      display,
      () =>
        !document.body.textContent?.includes("Display Walkin") &&
        Boolean(document.body.textContent?.includes("Enter your phone number")),
      12000,
    );
    createWaitingOverflowFixture();
    await pos.reload({ waitUntil: "networkidle" });
    await pos.getByText("Codex E2E Salon").first().waitFor({ timeout: 12000 });
    for (const viewport of WAITING_DRAWER_QA_VIEWPORTS) {
      await assertWaitingDrawerFitsViewport(pos, viewport);
    }
    await pos.setViewportSize({ height: 900, width: 1440 });
    await selectWaitingVisitFromPopover(pos);

    await advanceDisplayClock(display, 121000);
    await assertCustomerDisplayPhoneCopy(display);
    assert.equal(
      await display.locator("[data-customer-display-summary]").count(),
      0,
      "Idle timeout should keep the check-in canvas receipt-free.",
    );
    await assertDisplayViewportHealth(display, REQUIRED_DISPLAY_VIEWPORTS);
    await display.setViewportSize({ height: 900, width: 1440 });

    await advanceDisplayClock(display, 121000);
    await pos.getByRole("button", { name: /Codexia/ }).click();
    await assertCustomerDisplayPhoneCopy(display);
    mark("staff selection woke display");

    await clickKeypadAmount(pos, "50");
    await waitForBody(
      display,
      () =>
        Boolean(document.body.textContent?.includes("$50.00")) &&
        Boolean(document.body.textContent?.includes("Codex Manicure")),
    );
    assert.equal(
      await display.locator("[data-customer-display-receipt-line]").count(),
      1,
      "Customer Display should show an itemized receipt line.",
    );

    await pos.getByRole("button", { name: "Clear" }).click();
    await clickKeypadAmount(pos, "60");
    await waitForBody(
      display,
      () => Boolean(document.body.textContent?.includes("$60.00")),
    );
    await pos.getByRole("button", { name: "Change" }).click();
    await waitForBody(
      display,
      () =>
        Boolean(document.body.textContent?.includes("$60.00")) &&
        !document.body.textContent?.includes("Welcome back, Display"),
    );
    assert.equal(
      await pos.locator("[data-pos-toast]").count(),
      0,
      "Clearing a selected customer should not show a POS toast.",
    );

    const threeReceiptLines = makeReceiptLines(3);
    await applyReceiptFixture(display, liveDraftId, threeReceiptLines);
    receiptGeometry = {
      ...receiptGeometry,
      threeItems: await assertReceiptAcrossViewports(
        display,
        threeReceiptLines,
        "receipt-three",
        { expectNoScroll: true },
      ),
    };

    const sixReceiptLines = makeReceiptLines(6);
    await applyReceiptFixture(display, liveDraftId, sixReceiptLines);
    receiptGeometry = {
      ...receiptGeometry,
      sixItems: await assertReceiptAcrossViewports(
        display,
        sixReceiptLines,
        "receipt-six",
      ),
    };

    const longReceiptLines = makeReceiptLines(18);
    await applyReceiptFixture(display, liveDraftId, longReceiptLines);
    const longReceiptTopGeometry = await assertReceiptAcrossViewports(
      display,
      longReceiptLines,
      "receipt-long",
      { assertVisibleTargets: true },
    );
    receiptGeometry = {
      ...receiptGeometry,
      longItems: longReceiptTopGeometry,
      longItemsScrolled: await assertLongReceiptScrollsOnlyLineRegion(
        display,
        longReceiptLines,
      ),
    };

    const portableSixReceiptLines = sixReceiptLines.map((line) => ({
      ...line,
      staffName: "Codexia Nailtech",
    }));
    const portableLongReceiptLines = longReceiptLines.map((line) => ({
      ...line,
      staffName: "Codexia Nailtech",
    }));

    await applyPosReceiptFixture(pos, liveDraftId, portableSixReceiptLines);
    portableReceiptGeometry = {
      ...portableReceiptGeometry,
      sixItems: await assertPortableReceiptAcrossViewports(
        pos,
        portableSixReceiptLines,
        "receipt-six",
        { expectNoAdjustments: true, expectNoScroll: true },
      ),
    };
    await assertPortableAdjustmentsAppearAndClear(pos);

    await applyPosReceiptFixture(pos, liveDraftId, portableLongReceiptLines);
    portableReceiptGeometry = {
      ...portableReceiptGeometry,
      longItems: await assertPortableReceiptAcrossViewports(
        pos,
        portableLongReceiptLines,
        "receipt-long",
        { assertVisibleTargets: true, expectNoAdjustments: true },
      ),
    };

    const restoredReceiptLines = [
      {
        amount: 60,
        amountInput: "60",
        amountParts: [60],
        id: "receipt-e2e-restored-line-1",
        label: "Service 1",
        serviceId: null,
        sortOrder: 1,
        staffId: STAFF_ID,
        staffName: "Codexia Nailtech",
      },
    ];
    await applyReceiptFixture(display, liveDraftId, restoredReceiptLines);
    await pos.reload({ waitUntil: "networkidle" });
    await pos.getByText("$60.00").first().waitFor({ timeout: 12000 });
    await display.setViewportSize({ height: 900, width: 1440 });

    await advanceDisplayClock(display, 121000);
    await waitForBody(
      display,
      () =>
        Boolean(document.body.textContent?.includes("$60.00")) &&
        !document.body.textContent?.includes("Touch anywhere to begin"),
    );

    await display.getByRole("button", { name: "Tip" }).click();
    await display
      .getByRole("heading", { name: "Welcome, Guest" })
      .waitFor({ timeout: 12000 });
    await assertDefaultReceiptBackground(display);
    await display.getByRole("button", { name: "Change" }).click();
    await assertCustomerDisplayPhoneCopy(display);

    await clickCustomerDisplayPhoneKeypad(display, CUSTOMER_PHONE);
    await pos.getByText("Codex Customer").first().waitFor({ timeout: 12000 });
    await display
      .getByRole("heading", { name: "Welcome back, Codex" })
      .waitFor({ timeout: 12000 });
    await display.getByText("***-***-2468").waitFor({ timeout: 12000 });
    await assertDownloadQrSafe(display, liveDraftToken);
    await display.screenshot({
      fullPage: false,
      path: `${VISUAL_ARTIFACT_DIR}/receipt-confirmed-qr-1440x900.png`,
    });
    assert.ok(
      (await pos.locator("[data-pos-receipt-total]").innerText()).includes("$60.00"),
      "Portable POS canonical total should be $60.00 before customer tip.",
    );
    assert.ok(
      (await display.locator("[data-customer-display-totals]").innerText()).includes("$60.00"),
      "Customer Display total should match the active POS draft.",
    );
    await display
      .getByRole("button", { name: /15%\s+\$9\.00/ })
      .waitFor({ timeout: 12000 });
    await assertIsolatedDisplayDoesNotReceiveDraft(context);
    await assertDisplayViewportHealth(display, REQUIRED_DISPLAY_VIEWPORTS);
    await display.setViewportSize({ height: 900, width: 1440 });

    const fifteenPercentTip = display.getByRole("button", { name: /15%/ }).first();
    await fifteenPercentTip.click();
    await pos.getByText("$69.00").first().waitFor({ timeout: 12000 });
    await waitForBody(
      display,
      () => Boolean(document.body.textContent?.includes("$69.00")),
    );

    const tipRows = queryLinkedDatabase(`
      select tip::text, total::text
      from public.pos_live_drafts
      where id = ${sqlString(liveDraftId)}::uuid;
    `);
    assert.equal(Number(tipRows[0].tip), 9);
    assert.equal(Number(tipRows[0].total), 69);

    await pos.getByRole("button", { name: "Submit" }).click();
    mark("first submit clicked");
    const firstSubmitToast = await waitForPosToast(pos, {
      amount: /\$69\.00/,
      detail: /Codex Customer/,
      title: /Ticket .* submitted/,
      tone: "success",
    });
    await firstSubmitToast.locator("[data-pos-toast-close]").click();
    await firstSubmitToast.waitFor({ state: "detached", timeout: 12000 });
    await display.getByText(/Thank you, Codex!/).waitFor({ timeout: 15000 });
    await assertCompletedScreenUsesDarkText(display);
    mark("first thank you visible");
    marks.push(
      `${Date.now()} first reset text ${await display
        .getByText(/Resetting in/)
        .first()
        .innerText()
        .catch(() => "<none>")}`,
    );
    const completedRows = queryLinkedDatabase(`
      select
        reset_at,
        status,
        extract(epoch from (reset_at - now()))::int as reset_seconds_remaining
      from public.pos_live_drafts
      where id = ${sqlString(liveDraftId)}::uuid;
    `);
    assert.equal(completedRows[0].status, "closed");
    assert.ok(
      Number(completedRows[0].reset_seconds_remaining) >= 20,
      `expected a 30 second reset window, got ${completedRows[0].reset_seconds_remaining}s`,
    );
    assert.ok(
      Number(completedRows[0].reset_seconds_remaining) <= 30,
      `expected reset window to be no more than 30s, got ${completedRows[0].reset_seconds_remaining}s`,
    );
    const firstResetAt = completedRows[0].reset_at;

    await display.reload({ waitUntil: "networkidle" });
    await display.getByText(/Thank you, Codex!/).waitFor({ timeout: 15000 });
    const reloadedCompletedRows = queryLinkedDatabase(`
      select reset_at
      from public.pos_live_drafts
      where id = ${sqlString(liveDraftId)}::uuid;
    `);
    assert.equal(
      Date.parse(reloadedCompletedRows[0].reset_at),
      Date.parse(firstResetAt),
      "Refreshing the Customer Display should not restart reset_at.",
    );
    await assertDisplayViewportHealth(display, REQUIRED_DISPLAY_VIEWPORTS);
    await display.setViewportSize({ height: 900, width: 1440 });
    await display.locator("[data-customer-display-completed]").click({
      position: { x: 40, y: 40 },
    });
    await assertCustomerDisplayPhoneCopy(display);
    const touchResetRows = queryLinkedDatabase(`
      select
        customer,
        reset_at,
        status,
        total::text,
        tip::text
      from public.pos_live_drafts
      where id = ${sqlString(liveDraftId)}::uuid;
    `);

    assert.equal(touchResetRows[0].customer, null);
    assert.equal(touchResetRows[0].reset_at, null);
    assert.equal(touchResetRows[0].status, "draft");
    assert.equal(Number(touchResetRows[0].total), 0);
    assert.equal(Number(touchResetRows[0].tip), 0);

    await pos.getByRole("button", { name: /Codexia/ }).click();
    mark("new staff clicked");
    await clickKeypadAmount(pos, "30");
    mark("new amount entered");
    await waitForBody(
      display,
      () =>
        !document.body.textContent?.includes("Thank you") &&
        Boolean(document.body.textContent?.includes("$30.00")),
    );

    await clickCustomerDisplayPhoneKeypad(display, "5550109999");
    await display
      .getByRole("heading", { name: "Enter customer name" })
      .waitFor({ timeout: 12000 });
    await assertDownloadQrAbsent(
      display,
      "QR should be absent before a new customer profile is confirmed.",
    );
    await display.setViewportSize({ height: 620, width: 1024 });
    await assertDisplayViewportHealth(display, [{ height: 620, width: 1024 }]);
    await display.screenshot({
      fullPage: false,
      path: `${VISUAL_ARTIFACT_DIR}/profile-reduced-height-1024x620.png`,
    });
    await display.setViewportSize({ height: 900, width: 1440 });
    await display.getByLabel("Customer name").fill("Display New Customer");
    await display.getByRole("button", { name: "Continue" }).click();
    await display
      .getByRole("heading", { name: "Welcome, Display" })
      .waitFor({ timeout: 12000 });
    await display.getByText("***-***-9999").waitFor({ timeout: 12000 });
    await assertDownloadQrSafe(display, liveDraftToken);

    await pos.getByRole("button", { name: "Submit" }).click();
    await waitForPosToast(pos, {
      amount: /\$30\.00/,
      detail: /Display New Customer/,
      title: /Ticket .* submitted/,
      tone: "success",
    });
    await pos.locator("[data-pos-toast]").waitFor({
      state: "detached",
      timeout: 7000,
    });
    await display.getByText("Thank you").waitFor({ timeout: 15000 });
    queryLinkedDatabase(`
      update public.pos_live_drafts
      set reset_at = now() - interval '1 second'
      where id = ${sqlString(liveDraftId)}::uuid;
    `);
    await display.reload({ waitUntil: "networkidle" });
    await waitForBody(
      display,
      () =>
        !document.body.textContent?.includes("Thank you") &&
        Boolean(document.body.textContent?.includes("Enter your phone number")),
      12000,
    );
    await advanceDisplayClock(display, 121000);
    await assertCustomerDisplayPhoneCopy(display);

    const resetRows = queryLinkedDatabase(`
      select status, total::text, tip::text
      from public.get_pos_live_draft_by_token(${sqlString(liveDraftToken)});
    `);
    assert.equal(resetRows[0].status, "draft");
    assert.equal(Number(resetRows[0].total), 0);
    assert.equal(Number(resetRows[0].tip), 0);

    await assertPortableLogout(browser);

    assert.deepEqual(networkErrors, []);
    assert.deepEqual(consoleErrors, []);
  } catch (error) {
    const [posText, displayText] = await Promise.all([
      pos.locator("body").innerText().catch(() => "<unavailable>"),
      display.locator("body").innerText().catch(() => "<unavailable>"),
    ]);
    const liveDraftRows = queryLinkedDatabase(`
      select
        id,
        token,
        status,
        subtotal::text,
        tip::text,
        total::text,
        total_before_tip::text,
        completed_at is not null as completed,
        reset_at is not null as has_reset_at,
        version,
        receipt_version,
        staff_lines
      from public.pos_live_drafts
      where ${
        liveDraftId
          ? `id = ${sqlString(liveDraftId)}::uuid`
          : `salon_id = ${sqlString(SALON_ID)}::uuid order by updated_at desc limit 3`
      };
    `);

    console.error(
      JSON.stringify(
        {
          consoleErrors,
          displayText: displayText.slice(0, 1500),
          interestingResponses: interestingResponses.slice(-30),
          keypadDimensions,
          liveDraftRows,
          marks,
          networkErrors,
          portableReceiptGeometry,
          posText: posText.slice(0, 1500),
          receiptGeometry,
        },
        null,
        2,
      ),
    );

    throw error;
  } finally {
    await browser.close();
    cleanupFixture();
  }

  console.log(
    JSON.stringify(
      {
        keypadDimensions,
        portableReceiptGeometry,
        receiptGeometry,
      },
      null,
      2,
    ),
  );
  console.log("POS Customer Display browser e2e verification passed.");
}

main().catch((error) => {
  console.error(error);

  try {
    cleanupFixture();
  } catch {
    // Best effort cleanup after a browser failure.
  }

  process.exitCode = 1;
});

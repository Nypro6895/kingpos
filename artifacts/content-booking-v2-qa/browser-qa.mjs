import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const artifactsDir = path.resolve("artifacts/content-booking-v2-qa");
const baseUrl = process.env.CONTENT_BOOKING_V2_BASE_URL ?? "http://127.0.0.1:3000";
const quickHref = process.env.CONTENT_BOOKING_V2_QUICK_HREF;
const invalidHref = process.env.CONTENT_BOOKING_V2_INVALID_HREF;
const updateHref = process.env.CONTENT_BOOKING_V2_UPDATE_HREF;
const bookingDate = process.env.CONTENT_BOOKING_V2_DATE;
const quickStaffId = process.env.CONTENT_BOOKING_V2_QUICK_STAFF_ID;
const quickServiceName = process.env.CONTENT_BOOKING_V2_QUICK_SERVICE_NAME ?? "";
const invalidServiceName = process.env.CONTENT_BOOKING_V2_INVALID_SERVICE_NAME ?? "";
const marker = "codex-content-booking-v2-browser-qa";

if (!quickHref || !invalidHref || !updateHref || !bookingDate || !quickStaffId) {
  throw new Error(
    "CONTENT_BOOKING_V2_QUICK_HREF, CONTENT_BOOKING_V2_INVALID_HREF, CONTENT_BOOKING_V2_UPDATE_HREF, CONTENT_BOOKING_V2_DATE, and CONTENT_BOOKING_V2_QUICK_STAFF_ID are required.",
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

function absoluteUrl(href) {
  return new URL(href, baseUrl).toString();
}

function bookingUrl(href) {
  const parsed = new URL(href, baseUrl);

  if (bookingDate && !parsed.searchParams.has("date")) {
    parsed.searchParams.set("date", bookingDate);
  }

  return parsed.toString();
}

function normalizeHref(href) {
  if (!href) {
    return "";
  }

  const parsed = new URL(href, baseUrl);
  return `${parsed.pathname}${parsed.search}`;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function inspirationIdFromHref(href) {
  return new URL(href, baseUrl).searchParams.get("inspiration");
}

function isBookingServerAction(request) {
  return request.method() === "POST" && request.url().startsWith(`${baseUrl}/book/`);
}

function recordPageErrors(page, report) {
  page.on("console", (message) => {
    if (message.type() === "error") {
      report.consoleErrors.push(message.text());
    }
  });

  page.on("pageerror", (error) => {
    report.pageErrors.push(error.message);
  });

  page.on("requestfailed", (request) => {
    const failure = request.failure();
    const url = request.url();

    if (!failure || url.startsWith("data:")) {
      return;
    }

    const expected = report.expectedAbortUrls.some((expectedUrl) =>
      url.startsWith(expectedUrl),
    );

    (expected ? report.expectedRequestFailures : report.requestFailures).push({
      errorText: failure.errorText,
      url,
    });
  });
}

async function waitForServer() {
  let lastError;

  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/explore`);

      if (response.ok) {
        return;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw lastError ?? new Error("Server did not respond.");
}

async function runSql(name, sql) {
  const filePath = path.join(artifactsDir, name);
  await writeFile(filePath, `${sql.trim()}\n`);
  await runSqlFile(filePath);
}

async function runSqlFile(filePath) {
  const cliFilePath = path.relative(process.cwd(), filePath).replaceAll("\\", "/");
  const command =
    process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npx";
  const args =
    process.platform === "win32"
      ? [
          "/d",
          "/s",
          "/c",
          `npx supabase db query --linked --file ${cliFilePath}`,
        ]
      : ["supabase", "db", "query", "--linked", "--file", cliFilePath];
  await execFileAsync(
    command,
    args,
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SUPABASE_TELEMETRY_DISABLED: "1",
      },
      windowsHide: true,
    },
  );
}

async function seedSignedInCustomer({ authUserId, email, password }) {
  await runSql(
    "q8-signed-user-seed.sql",
    `
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
      ${sqlLiteral(authUserId)}::uuid,
      coalesce(
        (select instance_id from auth.users where instance_id is not null limit 1),
        '00000000-0000-0000-0000-000000000000'::uuid
      ),
      false,
      false,
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object(
        'display_name', 'Codex Signed Customer',
        'email', ${sqlLiteral(email)},
        'email_verified', true,
        'phone_verified', false,
        'sub', ${sqlLiteral(authUserId)}
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
        'sub', ${sqlLiteral(authUserId)},
        'email', ${sqlLiteral(email)},
        'email_verified', true,
        'phone_verified', false
      ),
      now(),
      'email',
      ${sqlLiteral(authUserId)},
      ${sqlLiteral(authUserId)}::uuid,
      now()
    );

    update public.users
    set
      display_name = 'Codex Signed Customer',
      email = ${sqlLiteral(email)},
      phone = '5553334444',
      language = 'en',
      status = 'active',
      timezone = 'America/Chicago'
    where auth_user_id = ${sqlLiteral(authUserId)}::uuid;

    select count(*) as signed_user_count
    from public.users
    where auth_user_id = ${sqlLiteral(authUserId)}::uuid
      and email = ${sqlLiteral(email)}
      and phone = '5553334444';
    `,
  );
}

async function copyAuthCookiesFromResponse(context, response) {
  const authCookies = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value)
    .map((value) => value.split(";")[0])
    .map((pair) => {
      const separatorIndex = pair.indexOf("=");

      if (separatorIndex <= 0) {
        return null;
      }

      return {
        name: pair.slice(0, separatorIndex),
        value: pair.slice(separatorIndex + 1),
      };
    })
    .filter(
      (cookie) =>
        cookie &&
        (cookie.name === "sb-access-token" || cookie.name === "sb-refresh-token"),
    );

  if (authCookies.length === 0) {
    return;
  }

  await context.addCookies(
    authCookies.map((cookie) => ({
      httpOnly: true,
      name: cookie.name,
      sameSite: "Lax",
      secure: false,
      url: baseUrl,
      value: cookie.value,
    })),
  );
}

async function findExploreFixtureLink(page, { captionText, linkName }) {
  await page.goto(`${baseUrl}/explore`, { waitUntil: "networkidle" });
  const cards = page.locator('[data-inspiration-card="true"]');
  await cards.first().waitFor({ timeout: 30000 });
  const cardCount = await cards.count();

  for (let index = 0; index < Math.min(cardCount, 30); index += 1) {
    await cards.nth(index).click();
    const dialog = page.getByRole("dialog").first();
    try {
      await dialog.waitFor({ timeout: 5000 });
    } catch {
      continue;
    }

    const text = await dialog.innerText();

    if (text.includes(captionText)) {
      const link = dialog.getByRole("link", { name: linkName }).first();
      await link.waitFor({ timeout: 5000 });
      return await link.getAttribute("href");
    }

    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }

  throw new Error(`Explore fixture link not found for ${captionText}.`);
}

async function checkNoHorizontalOverflow(page) {
  return await page.evaluate(() => {
    const documentWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;

    return {
      documentWidth,
      hasOverflow: scrollWidth > documentWidth + 2,
      scrollWidth,
    };
  });
}

async function waitForFlowState(page, states) {
  const accepted = Array.isArray(states) ? states : [states];
  await page.waitForFunction(
    (expected) =>
      expected.includes(
        document
          .querySelector('[data-testid="public-booking-root"]')
          ?.getAttribute("data-booking-flow-state"),
      ),
    accepted,
    { timeout: 30000 },
  );
}

async function bodyText(page) {
  return await page.locator("body").innerText();
}

async function assertBodyDoesNotInclude(page, text, message) {
  const textContent = await bodyText(page);

  if (textContent.includes(text)) {
    throw new Error(message ?? `Unexpected text found: ${text}`);
  }
}

async function assertNoTerminalFailure(page) {
  await assertBodyDoesNotInclude(
    page,
    "Booking not submitted",
    "Terminal failure UI rendered.",
  );
}

async function clickPrimary(page) {
  await page.locator('[data-testid="public-booking-primary-action"]').click();
}

async function clickEnabledPrimary(page) {
  await page.waitForFunction(
    () => {
      const button = document.querySelector(
        '[data-testid="public-booking-primary-action"]',
      );

      return button && !button.disabled;
    },
    null,
    { timeout: 30000 },
  );
  await clickPrimary(page);
}

async function chooseCanonicalService(page) {
  const namedServiceCard = quickServiceName
    ? page
        .locator('[data-testid="public-booking-service-card"]')
        .filter({ hasText: quickServiceName })
    : page.locator('[data-testid="public-booking-service-card"]').filter({
        hasText: "__never__",
      });
  const serviceCard =
    (await namedServiceCard.count()) > 0
      ? namedServiceCard.first()
      : page.locator('[data-testid="public-booking-service-card"]').first();
  await serviceCard.waitFor({ timeout: 30000 });
  await serviceCard.click();
}

async function completeInspirationOnlySelectionToDetails(page) {
  await chooseCanonicalService(page);
  await waitForFlowState(page, ["ready_for_slot", "identity_required"]);
  await clickEnabledPrimary(page);
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        text.includes("Choose your professional") ||
        text.includes("Find a time") ||
        text.includes("Choose a time")
      );
    },
    null,
    { timeout: 30000 },
  );

  const professionalHeading = page.getByRole("heading", {
    name: "Choose your professional",
  });

  if (await professionalHeading.isVisible().catch(() => false)) {
    await professionalHeading.waitFor({ timeout: 30000 });
    const firstProfessional = page
      .locator('input[name="public-booking-professional"]')
      .first();

    if ((await firstProfessional.count()) > 0) {
      await firstProfessional.check({ force: true });
    }

    await clickEnabledPrimary(page);
  }

  await page
    .getByRole("heading", { name: /Find a time|Choose a time/ })
    .waitFor({ timeout: 30000 });
  const slot = page.locator('[data-testid="public-booking-slot"]').first();
  await slot.waitFor({ timeout: 30000 });
  await slot.click();
  await waitForFlowState(page, "identity_required");
  await clickEnabledPrimary(page);
  await page.locator('[data-testid="public-booking-details-sheet"]').waitFor({
    timeout: 30000,
  });
}

function phoneForSuffix(suffix) {
  const hash = Array.from(suffix).reduce(
    (current, char) => (current * 31 + char.charCodeAt(0)) % 7000000,
    0,
  );

  return `555${String(2000000 + hash).padStart(7, "0")}`;
}

async function fillGuestDetails(page, suffix) {
  await page.locator('[data-testid="public-booking-guest-first-name"]').fill("Codex");
  await page.locator('[data-testid="public-booking-guest-last-name"]').fill("Guest");
  await page.locator('[data-testid="public-booking-guest-phone"]').fill(phoneForSuffix(suffix));
  await page
    .locator('[data-testid="public-booking-guest-email"]')
    .fill(`codex-content-v2-browser-${suffix}@example.invalid`);
  await page
    .locator('[data-testid="public-booking-guest-notes"]')
    .fill(`${marker} ${suffix}`);
}

async function completeGuestDetailsToReview(page, suffix) {
  await fillGuestDetails(page, suffix);
  await page
    .locator('[data-testid="public-booking-details-sheet"]')
    .getByRole("button", { name: "Continue to review" })
    .click();
  await page.getByRole("heading", { name: "Review your visit" }).waitFor({
    timeout: 30000,
  });
  await waitForFlowState(page, "ready_to_submit");
}

async function submitAndExpectConfirmation(page) {
  await clickPrimary(page);
  await waitForFlowState(page, "confirmed");
  await page
    .getByRole("heading", { name: /Booking confirmed|Request received/ })
    .waitFor({ timeout: 30000 });

  const manageLinks = await page.locator('a[href*="/booking/manage/"], a[href*="/my-bookings/"]').count();

  if (manageLinks === 0) {
    throw new Error("Confirmation rendered without a manage/account booking link.");
  }

  await assertNoTerminalFailure(page);
}

async function submitUpdateAndExpectConfirmation(page) {
  try {
    await submitAndExpectConfirmation(page);
  } catch (error) {
    const textContent = await bodyText(page).catch(() => "");

    if (textContent.includes("Booking source context is not available")) {
      throw new Error(
        "Profile update Quick Book was rejected by create_public_booking source validation.",
      );
    }

    throw error;
  }
}

async function verifyUpdateBookingSnapshot(updateInspirationId) {
  await runSql(
    "q8-update-booking-verify.sql",
    `
    select 1 / case when exists (
      select 1
      from public.bookings bookings
      join public.booking_inspirations inspirations
        on inspirations.booking_id = bookings.id
      where bookings.public_notes = '${marker} update-success'
        and bookings.source = 'explore'
        and bookings.source_reference_type = 'salon_profile_update'
        and bookings.source_reference_id = ${sqlLiteral(updateInspirationId)}::uuid
        and inspirations.source_type = 'salon_profile_update'
        and inspirations.source_content_id = ${sqlLiteral(updateInspirationId)}::uuid
        and inspirations.source_title_snapshot = 'Codex V2 QA Inspiration Update'
        and inspirations.source_caption_snapshot = '${marker} inspiration-only'
        and inspirations.source_media_path is not null
        and inspirations.service_id is null
        and inspirations.credited_staff_id is null
        and jsonb_array_length(inspirations.metadata -> 'final_booking_lines') >= 1
        and exists (
          select 1
          from jsonb_array_elements(inspirations.metadata -> 'final_booking_lines') as line(value)
          where nullif(line.value ->> 'service_name', '') is not null
            and nullif(line.value ->> 'assigned_staff_id', '') is not null
        )
    ) then 1 else 0 end as update_booking_snapshot_ok;
    `,
  );
}

async function run() {
  await mkdir(artifactsDir, { recursive: true });
  await waitForServer();

  const report = {
    baseUrl,
    checks: {},
    consoleErrors: [],
    expectedAbortUrls: [],
    expectedRequestFailures: [],
    fixture: {
      bookingDate,
      invalidHref,
      quickHref,
      updateHref,
    },
    pageErrors: [],
    requestFailures: [],
    screenshots: {},
  };
  let browser;
  let pendingError = null;

  try {
    browser = await launchBrowser();
    const desktop = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    recordPageErrors(desktop, report);

    const exploreQuickHref = await findExploreFixtureLink(desktop, {
      captionText: `${marker} quick-ready`,
      linkName: "Book this look",
    });
    report.checks.exploreQuickLink =
      normalizeHref(exploreQuickHref) === normalizeHref(quickHref);
    await desktop.keyboard.press("Escape");

    const exploreUpdateHref = await findExploreFixtureLink(desktop, {
      captionText: `${marker} inspiration-only`,
      linkName: "Book with this inspiration",
    });
    report.checks.exploreUpdateLink =
      normalizeHref(exploreUpdateHref) === normalizeHref(updateHref);
    await desktop.keyboard.press("Escape");

    if (!report.checks.exploreQuickLink || !report.checks.exploreUpdateLink) {
      throw new Error("Explore links did not match hosted fixture URLs.");
    }

    await desktop.goto(bookingUrl(invalidHref), { waitUntil: "networkidle" });
    await waitForFlowState(desktop, "selection_incomplete");
    const invalidCard = desktop.locator('[data-testid="booking-inspiration-card"]').first();
    await invalidCard.waitFor({ timeout: 30000 });
    const invalidText = (await desktop.locator("body").innerText()).toLowerCase();
    const primary = desktop.locator('[data-testid="public-booking-primary-action"]');
    report.checks.invalidOriginalCopy = invalidText.includes(
      "the original service for this look is no longer available. choose another service to continue.",
    );
    report.checks.invalidOriginalNotCurrent =
      !invalidText.includes(`booking this look as ${invalidServiceName.toLowerCase()}`) &&
      !invalidText.includes(`booking as ${invalidServiceName.toLowerCase()}`);
    report.checks.nextDisabledWithoutService =
      (await primary.isDisabled()) &&
      (await primary.innerText()).includes("Choose a service to continue");
    report.checks.zeroTotalStillDisabled =
      invalidText.includes("0 min") &&
      invalidText.includes("$0") &&
      (await primary.isDisabled());
    report.checks.noTechnicalQuickReadyLabel = !invalidText.includes("quick book ready");

    if (
      !report.checks.invalidOriginalCopy ||
      !report.checks.invalidOriginalNotCurrent ||
      !report.checks.nextDisabledWithoutService ||
      !report.checks.zeroTotalStillDisabled ||
      !report.checks.noTechnicalQuickReadyLabel
    ) {
      throw new Error("Invalid original service assertions failed.");
    }

    const invalidScreenshot = path.join(
      artifactsDir,
      "q8-invalid-original-before-replacement-desktop.png",
    );
    await desktop.screenshot({ fullPage: true, path: invalidScreenshot });
    report.screenshots.invalidOriginalDesktop = invalidScreenshot;

    const namedReplacementCard = quickServiceName
      ? desktop
          .locator('[data-testid="public-booking-service-card"]')
          .filter({ hasText: quickServiceName })
      : desktop.locator('[data-testid="public-booking-service-card"]').filter({
          hasText: "__never__",
        });
    const replacementCard =
      (await namedReplacementCard.count()) > 0
        ? namedReplacementCard.first()
        : desktop.locator('[data-testid="public-booking-service-card"]').first();
    await replacementCard.click();
    await waitForFlowState(desktop, ["ready_for_slot", "identity_required"]);
    const replacementText = (await desktop.locator("body").innerText()).toLowerCase();
    report.checks.replacementCurrentSelection =
      replacementText.includes("you're booking") &&
      !replacementText.includes(`booking as ${invalidServiceName.toLowerCase()}`);

    if (!report.checks.replacementCurrentSelection) {
      throw new Error("Replacement selection assertions failed.");
    }

    const replacementScreenshot = path.join(
      artifactsDir,
      "q8-valid-replacement-state-desktop.png",
    );
    await desktop.screenshot({ fullPage: true, path: replacementScreenshot });
    report.screenshots.validReplacementDesktop = replacementScreenshot;

    await desktop.goto(bookingUrl(quickHref), { waitUntil: "networkidle" });
    await waitForFlowState(desktop, "identity_required");
    await desktop.getByRole("heading", { name: "Choose a time" }).waitFor({
      timeout: 30000,
    });
    await assertBodyDoesNotInclude(
      desktop,
      "Book this look / Quick Book ready",
      "Visible technical Quick Book label leaked.",
    );
    let submitRequestsBeforeDetails = 0;
    desktop.on("request", (request) => {
      if (isBookingServerAction(request)) {
        submitRequestsBeforeDetails += 1;
      }
    });
    await clickPrimary(desktop);
    await desktop.locator('[data-testid="public-booking-details-sheet"]').waitFor({
      timeout: 30000,
    });
    await desktop.waitForTimeout(500);
    report.checks.noSubmitBeforeGuestDetails = submitRequestsBeforeDetails === 0;

    if (!report.checks.noSubmitBeforeGuestDetails) {
      throw new Error("Guest submit request was sent before details were valid.");
    }

    const guestSheetDesktop = path.join(
      artifactsDir,
      "q8-guest-details-sheet-desktop.png",
    );
    await desktop.screenshot({ fullPage: true, path: guestSheetDesktop });
    report.screenshots.guestDetailsDesktop = guestSheetDesktop;

    await desktop
      .locator('[data-testid="public-booking-details-sheet"]')
      .getByRole("button", { name: "Continue to review" })
      .click();
    await desktop.locator('[data-testid="public-booking-field-error"]').first().waitFor({
      timeout: 30000,
    });
    await desktop.waitForTimeout(500);
    report.checks.guestValidationNoSubmit = submitRequestsBeforeDetails === 0;

    if (!report.checks.guestValidationNoSubmit) {
      throw new Error("Guest validation submitted before fields were valid.");
    }

    const guestValidationScreenshot = path.join(
      artifactsDir,
      "q8-guest-field-validation-desktop.png",
    );
    await desktop.screenshot({ fullPage: true, path: guestValidationScreenshot });
    report.screenshots.guestValidationDesktop = guestValidationScreenshot;

    await completeGuestDetailsToReview(desktop, "guest-success");
    await submitAndExpectConfirmation(desktop);
    const guestConfirmationScreenshot = path.join(
      artifactsDir,
      "q8-guest-success-confirmation-desktop.png",
    );
    await desktop.screenshot({ fullPage: true, path: guestConfirmationScreenshot });
    report.screenshots.guestConfirmationDesktop = guestConfirmationScreenshot;
    report.checks.guestSuccess = true;

    const updateInspirationId = inspirationIdFromHref(updateHref);

    if (!updateInspirationId) {
      throw new Error("CONTENT_BOOKING_V2_UPDATE_HREF is missing an inspiration id.");
    }

    const updateContext = await browser.newContext({
      viewport: { height: 900, width: 1440 },
    });
    const updatePage = await updateContext.newPage();
    recordPageErrors(updatePage, report);
    await updatePage.goto(bookingUrl(updateHref), { waitUntil: "networkidle" });
    await waitForFlowState(updatePage, "selection_incomplete");
    const updateInspirationCard = updatePage
      .locator('[data-testid="booking-inspiration-card"]')
      .first();
    await updateInspirationCard.waitFor({ timeout: 30000 });
    const updateInitialText = await bodyText(updatePage);
    report.checks.updateInspirationUi =
      updateInitialText.includes("BOOK WITH THIS INSPIRATION") &&
      updateInitialText.includes("Codex V2 QA Inspiration Update") &&
      updateInitialText.includes(
        "Choose services and a professional. We'll keep this inspiration attached",
      );

    if (!report.checks.updateInspirationUi) {
      throw new Error("Update inspiration UI assertions failed.");
    }

    await completeInspirationOnlySelectionToDetails(updatePage);
    await completeGuestDetailsToReview(updatePage, "update-success");
    await submitUpdateAndExpectConfirmation(updatePage);
    const updateConfirmationScreenshot = path.join(
      artifactsDir,
      "q8-update-success-confirmation-desktop.png",
    );
    await updatePage.screenshot({
      fullPage: true,
      path: updateConfirmationScreenshot,
    });
    report.screenshots.updateConfirmationDesktop = updateConfirmationScreenshot;

    const updateManageHref = await updatePage
      .locator('a[href*="/booking/manage/"]')
      .first()
      .getAttribute("href");

    if (!updateManageHref) {
      throw new Error("Update guest confirmation did not expose a manage link.");
    }

    await updatePage.goto(absoluteUrl(updateManageHref), { waitUntil: "networkidle" });
    await updatePage.locator('[data-testid="manage-booking-root"]').waitFor({
      timeout: 30000,
    });
    const updateManageText = await bodyText(updatePage);
    const updateManageScreenshot = path.join(
      artifactsDir,
      "q8-update-guest-manage-desktop.png",
    );
    await updatePage.screenshot({
      fullPage: true,
      path: updateManageScreenshot,
    });
    report.screenshots.updateGuestManageDesktop = updateManageScreenshot;
    report.updateGuestManageTextExcerpt = updateManageText.slice(0, 1200);
    const normalizedUpdateManageText = updateManageText.toLowerCase();
    report.checks.updateGuestManageInspiration =
      normalizedUpdateManageText.includes("your inspiration") &&
      updateManageText.includes("Codex V2 QA Inspiration Update");

    if (!report.checks.updateGuestManageInspiration) {
      throw new Error("Update guest manage inspiration assertions failed.");
    }

    await verifyUpdateBookingSnapshot(updateInspirationId);
    report.checks.updateBookingSnapshot = true;
    report.checks.updateSubmitSuccess = true;
    await updateContext.close();

    const signedContext = await browser.newContext({
      viewport: { height: 900, width: 1440 },
    });
    const signedPage = await signedContext.newPage();
    recordPageErrors(signedPage, report);
    const signedAuthUserId = randomUUID();
    const signedEmail = `codex-content-v2-browser-signed-${Date.now()}@example.com`;
    const signedPassword = `Codex-Q8-${randomUUID()}!`;
    await seedSignedInCustomer({
      authUserId: signedAuthUserId,
      email: signedEmail,
      password: signedPassword,
    });
    const login = await signedContext.request.post(`${baseUrl}/api/auth/login`, {
      multipart: {
        email: signedEmail,
        next: "/account",
        password: signedPassword,
      },
    });

    if (!login.ok()) {
      throw new Error(`Signed-in fixture login failed with HTTP ${login.status()}.`);
    }

    await copyAuthCookiesFromResponse(signedContext, login);
    const cookies = await signedContext.cookies(baseUrl);
    const hasSessionCookie = cookies.some((cookie) => cookie.name === "sb-access-token");

    if (!hasSessionCookie) {
      throw new Error("Signed-in fixture did not receive an auth session.");
    }

    await signedPage.goto(`${baseUrl}/account`, { waitUntil: "networkidle" });
    await signedPage.goto(bookingUrl(quickHref), { waitUntil: "networkidle" });
    await waitForFlowState(signedPage, "ready_to_submit");
    await clickPrimary(signedPage);
    await signedPage.getByRole("heading", { name: "Review your visit" }).waitFor({
      timeout: 30000,
    });
    await submitAndExpectConfirmation(signedPage);
    const signedConfirmationScreenshot = path.join(
      artifactsDir,
      "q8-signed-in-success-confirmation-desktop.png",
    );
    await signedPage.screenshot({ fullPage: true, path: signedConfirmationScreenshot });
    report.screenshots.signedInConfirmationDesktop = signedConfirmationScreenshot;
    report.checks.signedInSuccess = true;
    await signedContext.close();

    const unexpected = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    recordPageErrors(unexpected, report);
    await unexpected.goto(bookingUrl(quickHref), { waitUntil: "networkidle" });
    await waitForFlowState(unexpected, "identity_required");
    await clickPrimary(unexpected);
    await unexpected.locator('[data-testid="public-booking-details-sheet"]').waitFor({
      timeout: 30000,
    });
    await completeGuestDetailsToReview(unexpected, "unexpected-retry");
    const quickAbsolute = bookingUrl(quickHref);
    let abortedOnce = false;
    report.expectedAbortUrls.push(quickAbsolute);
    await unexpected.route("**/book/**", async (route, request) => {
      if (!abortedOnce && isBookingServerAction(request)) {
        abortedOnce = true;
        await route.abort("failed");
        return;
      }

      await route.continue();
    });
    await clickPrimary(unexpected);
    await waitForFlowState(unexpected, "recoverable_error");
    await assertNoTerminalFailure(unexpected);
    report.checks.unexpectedErrorRecoverable = true;
    await unexpected.unroute("**/book/**");
    await submitAndExpectConfirmation(unexpected);
    report.checks.retryAfterUnexpectedError = true;
    await unexpected.close();

    const mobile = await browser.newPage({ viewport: { height: 844, width: 390 } });
    recordPageErrors(mobile, report);
    await mobile.goto(bookingUrl(quickHref), { waitUntil: "networkidle" });
    await waitForFlowState(mobile, "identity_required");
    await clickPrimary(mobile);
    await mobile.locator('[data-testid="public-booking-details-sheet"]').waitFor({
      timeout: 30000,
    });
    const mobileOverflow = await checkNoHorizontalOverflow(mobile);
    report.checks.mobileDetailsNoOverflow = !mobileOverflow.hasOverflow;

    if (!report.checks.mobileDetailsNoOverflow) {
      throw new Error("Mobile details sheet overflow assertion failed.");
    }

    const guestSheetMobile = path.join(
      artifactsDir,
      "q8-guest-details-sheet-mobile.png",
    );
    await mobile.screenshot({ fullPage: true, path: guestSheetMobile });
    report.screenshots.guestDetailsMobile = guestSheetMobile;
    await mobile.close();

    const race = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    recordPageErrors(race, report);
    await race.goto(bookingUrl(quickHref), { waitUntil: "networkidle" });
    await waitForFlowState(race, "identity_required");
    await clickPrimary(race);
    await race.locator('[data-testid="public-booking-details-sheet"]').waitFor({
      timeout: 30000,
    });
    await completeGuestDetailsToReview(race, "slot-race");
    await runSql(
      "q8-disable-fixture-availability.sql",
      `insert into public.staff_time_blocks (
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
         staff.organization_id,
         staff.salon_id,
         staff.id,
         'blocked',
         (${sqlLiteral(bookingDate)}::date::timestamp at time zone 'America/Chicago'),
         ((${sqlLiteral(bookingDate)}::date + 1)::timestamp at time zone 'America/Chicago'),
         'America/Chicago',
         '${marker} slot race',
         true
       from public.staff
       where staff.id = ${sqlLiteral(quickStaffId)}::uuid;

       delete from public.staff_availability_rules rules
       where rules.starts_at_local = '08:07:00'::time
         and rules.ends_at_local = '19:07:00'::time
         and rules.effective_start_date = current_date - 1
         and rules.effective_end_date = current_date + 45;`,
    );
    await clickPrimary(race);
    await waitForFlowState(race, "recoverable_error");
    const raceText = (await race.locator("body").innerText()).toLowerCase();
    report.checks.slotRaceRecoverable =
      raceText.includes("that time is no longer available. choose another time.") &&
      !raceText.includes("booking not submitted");

    if (!report.checks.slotRaceRecoverable) {
      throw new Error("Slot race did not remain recoverable.");
    }

    const raceScreenshot = path.join(
      artifactsDir,
      "q8-slot-race-recoverable-desktop.png",
    );
    await race.screenshot({ fullPage: true, path: raceScreenshot });
    report.screenshots.slotRaceDesktop = raceScreenshot;
    await race.close();

    await assertNoTerminalFailure(desktop);
    await desktop.close();
  } catch (error) {
    pendingError = error;
  } finally {
    if (browser) {
      await browser.close();
    }

    try {
      await runSqlFile(path.join(artifactsDir, "browser-fixture-cleanup.sql"));
      report.checks.fixtureCleanup = true;
    } catch (error) {
      report.checks.fixtureCleanup = false;
      report.cleanupError = {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      };
      pendingError ??= error;
    }
  }

  await writeFile(
    path.join(artifactsDir, "browser-qa-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (pendingError) {
    throw pendingError;
  }

  const relevantFailures = report.requestFailures.filter(
    (failure) =>
      !failure.url.includes("favicon") &&
      failure.errorText !== "net::ERR_ABORTED",
  );

  const hasExpectedFailedAbort = report.expectedRequestFailures.some(
    (failure) => failure.errorText === "net::ERR_FAILED",
  );
  const relevantConsoleErrors = report.consoleErrors.filter(
    (message) =>
      !(hasExpectedFailedAbort && message === "Failed to load resource: net::ERR_FAILED"),
  );

  if (
    relevantConsoleErrors.length > 0 ||
    report.pageErrors.length > 0 ||
    relevantFailures.length > 0
  ) {
    throw new Error("Browser QA recorded page, console, or network errors.");
  }
}

run().catch(async (error) => {
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(
    path.join(artifactsDir, "browser-qa-error.json"),
    `${JSON.stringify(
      {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : null,
      },
      null,
      2,
    )}\n`,
  );
  console.error(error);
  process.exitCode = 1;
});

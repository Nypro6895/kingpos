import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const artifactsDir = path.resolve("artifacts/booking-browser-test");
const baseUrl = process.env.IDENTITY_QA_BASE_URL ?? "http://127.0.0.1:3393";
const salonId =
  process.env.IDENTITY_QA_SALON_ID ?? "7f599bc8-a806-4a68-be86-c149c21709e2";
const slotDate =
  process.env.IDENTITY_QA_DATE ??
  new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const runStartedAt = new Date().toISOString();
const marker = `Identity QA ${new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, "")
  .slice(0, 14)}`;
const emailSlug = marker.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const accountEmail = `${emailSlug}+account@example.test`;
const signupEmail = `${emailSlug}+signup@example.test`;
const accountPassword = "KingPOS-Identity-QA-12345!";
const guestPhone = "+1555071899";
const accountPhoneForBooking = "+1555071802";

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

function dateDayOfWeek(dateKey) {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

function redactManageToken(href) {
  return href.replace(/\/booking\/manage\/[a-f0-9]{64}/i, "/booking/manage/<token>");
}

function manageTokenFromHref(href) {
  return href.match(/\/booking\/manage\/([a-f0-9]{64})/i)?.[1] ?? null;
}

function manageTokenHash(rawToken) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function draftStorageKey() {
  return `kingpos.publicBookingDraft.${salonId}`;
}

async function waitForPublicUser(admin, authUserId, email) {
  for (let index = 0; index < 10; index += 1) {
    const { data, error } = await admin
      .from("users")
      .select("id, auth_user_id, email, phone, display_name")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (data) {
      return data;
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
        display_name: `${marker} Account`,
        email,
        status: "active",
      })
      .select("id, auth_user_id, email, phone, display_name")
      .single(),
    "create public user fallback",
  );
}

async function createAuthFixture(admin, report) {
  const created = assertOk(
    await admin.auth.admin.createUser({
      email: accountEmail,
      email_confirm: true,
      password: accountPassword,
      user_metadata: {
        display_name: `${marker} Account`,
        first_name: "Identity",
        last_name: "Member",
      },
    }),
    "create auth fixture",
  );

  const publicUser = await waitForPublicUser(admin, created.user.id, accountEmail);
  const updatedPublicUser = assertOk(
    await admin
      .from("users")
      .update({
        display_name: `${marker} Account`,
        email: accountEmail,
        first_name: "Identity",
        last_name: "Member",
        phone: null,
      })
      .eq("id", publicUser.id)
      .select("id, auth_user_id, email, phone, display_name")
      .single(),
    "normalize public auth fixture",
  );

  report.authFixture = {
    publicUserId: updatedPublicUser.id,
    authUserId: created.user.id,
    email: accountEmail,
  };

  return {
    authUser: created.user,
    publicUser: updatedPublicUser,
  };
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
      .select("id, name")
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
    .like("display_name", "Identity QA %");
  await admin
    .from("services")
    .update({ is_active: false, online_booking_enabled: false })
    .eq("salon_id", salon.id)
    .like("name", "Identity QA %");

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

  const staff = assertOk(
    await admin
      .from("staff")
      .insert({
        display_name: `${marker} Taylor Reed`,
        email: `${emailSlug}+staff@example.test`,
        first_name: "Taylor",
        is_active: true,
        job_title: "Booking identity stylist",
        last_name: "Reed",
        online_booking_enabled: true,
        organization_id: organization.id,
        owner_public_enabled: true,
        phone: "+1555071801",
        profile_display_order: -9001,
        public_bio: "Fixture staff for customer booking identity QA.",
        public_profile_visible: true,
        salon_id: salon.id,
        salon_profile_content_posting_enabled: true,
        specialties: ["Identity QA"],
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
        base_price: 47,
        category: "Identity QA",
        description: `${marker} customer booking identity smoke service.`,
        duration_minutes: 45,
        is_active: true,
        name: `${marker} Booking Identity Service`,
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
    "create staff assignment",
  );
  const availability = assertOk(
    await admin
      .from("staff_availability_rules")
      .insert({
        day_of_week: dateDayOfWeek(slotDate),
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
      })
      .select("id")
      .single(),
    "create availability",
  );

  report.fixtureIds = {
    assignment: assignment.id,
    availability: availability.id,
    service: service.id,
    staff: staff.id,
  };

  return { assignment, availability, service, staff };
}

async function cleanup(admin, fixtures, authFixture) {
  const customers = assertOk(
    await admin
      .from("customers")
      .select("id")
      .eq("location_id", salonId)
      .in("email", [accountEmail, signupEmail]),
    "load QA customers",
  );
  const customerIds = customers.map((customer) => customer.id);

  if (customerIds.length > 0) {
    await admin
      .from("bookings")
      .update({
        cancellation_reason: "Customer booking identity QA cleanup",
        cancelled_at: new Date().toISOString(),
        confirmation_status: "cancelled",
        status: "cancelled",
      })
      .in("customer_id", customerIds);
  }

  if (fixtures) {
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
  }

  if (authFixture?.authUser?.id) {
    await admin.auth.admin.deleteUser(authFixture.authUser.id).catch(() => {});
  }

  const signupPublicUser = assertOk(
    await admin
      .from("users")
      .select("auth_user_id")
      .eq("email", signupEmail)
      .maybeSingle(),
    "load signup auth user",
  );

  if (signupPublicUser?.auth_user_id) {
    await admin.auth.admin.deleteUser(signupPublicUser.auth_user_id).catch(() => {});
  }
}

async function waitPrimaryEnabled(page) {
  await page.waitForFunction(
    () => {
      const action = document.querySelector("[data-testid='public-booking-primary-action']");
      return action && !action.hasAttribute("disabled");
    },
    null,
    { timeout: 30000 },
  );
}

async function openDetails(page, fixtures) {
  await page.goto(
    `${baseUrl}/book/${salonId}?serviceId=${fixtures.service.id}&date=${slotDate}`,
    { waitUntil: "networkidle" },
  );
  await page.getByRole("heading", { name: "Choose your services" }).waitFor({
    timeout: 20000,
  });
  await page.getByTestId("public-booking-primary-action").click();
  await page.getByRole("heading", { name: "Choose your professional" }).waitFor({
    timeout: 20000,
  });
  await page.getByTestId("public-booking-primary-action").click();
  await page.getByRole("heading", { name: "Find a time" }).waitFor({
    timeout: 20000,
  });
  await waitPrimaryEnabled(page);
  await page.getByTestId("public-booking-primary-action").click();
  await page.getByRole("heading", { name: "Tell us who is coming" }).waitFor({
    timeout: 20000,
  });
}

async function fillGuestForm(page) {
  await page.locator("#public-booking-first-name").fill("Identity");
  await page.locator("#public-booking-last-name").fill("Guest");
  await page.locator("#public-booking-phone").fill(guestPhone);
  await page.locator("#public-booking-email").fill(accountEmail);
}

async function latestBookingForCustomerUser(admin, customerUserId) {
  const bookings = assertOk(
    await admin
      .from("bookings")
      .select("id, customer_id, customer_user_id, created_at, status")
      .eq("salon_id", salonId)
      .eq("customer_user_id", customerUserId)
      .gte("created_at", runStartedAt)
      .order("created_at", { ascending: false })
      .limit(1),
    "load bookings for signed-in customer user",
  );

  return bookings[0] ?? null;
}

async function bookingByManageHref(admin, href) {
  const rawToken = manageTokenFromHref(href);

  if (!rawToken) {
    return null;
  }

  const bookings = assertOk(
    await admin
      .from("bookings")
      .select("id, customer_id, customer_user_id, created_at, status")
      .eq("salon_id", salonId)
      .eq("customer_cancellation_token_hash", manageTokenHash(rawToken))
      .gte("created_at", runStartedAt)
      .limit(1),
    "load booking by guest manage token",
  );

  return bookings[0] ?? null;
}

async function runSignedOutGuestFlow(browser, admin, fixtures, report) {
  const context = await browser.newContext({ viewport: { height: 900, width: 1440 } });
  const page = await context.newPage();
  recordPageErrors(page, report);

  try {
    await openDetails(page, fixtures);
    await page.getByText("How would you like to continue?").waitFor();

    report.signedOutInitialNoGuestForm =
      (await page.locator("#public-booking-first-name").count()) === 0 &&
      (await page.locator("#public-booking-email").count()) === 0;
    report.signedOutPrimaryDisabled = await page
      .getByTestId("public-booking-primary-action")
      .isDisabled();
    report.accountEnumerationCopyHidden =
      !(await page.getByText(/email already has an account/i).count()) &&
      !(await page.getByText(/phone already has an account/i).count()) &&
      !(await page.getByText(/account found for this contact/i).count());
    report.clientSpoofUserIdFieldPresent =
      (await page.locator("[name='customer_user_id'], #customer_user_id").count()) > 0;
    await screenshot(page, report, "identity-details-choice-signed-out-desktop.png");

    await page.getByRole("button", { name: "Continue as guest" }).click();
    await page.getByRole("heading", { name: "Continue as guest" }).waitFor();
    report.continueGuestOpensForm =
      (await page.locator("#public-booking-first-name").count()) === 1 &&
      (await page.locator("#public-booking-email").count()) === 1;
    await screenshot(page, report, "identity-details-guest-form-desktop.png");

    await page.getByRole("button", { name: "Back to account options" }).click();
    await page.getByText("How would you like to continue?").waitFor();
    report.guestCanReturnToChoice =
      (await page.locator("#public-booking-first-name").count()) === 0;

    await page.getByRole("button", { name: "Continue as guest" }).click();
    await fillGuestForm(page);
    await page.getByTestId("public-booking-primary-action").click();
    await page.getByRole("heading", { name: "Review your visit" }).waitFor();
    await page.getByTestId("public-booking-primary-action").click();
    await page.getByText("Already have an account? Sign in for faster future bookings.").waitFor({
      timeout: 30000,
    });
    const signInHref = await page.getByRole("link", { name: "Sign in" }).getAttribute("href");
    report.guestConfirmationAuthSuggestionIsGeneric =
      Boolean(signInHref?.includes("/login")) && !signInHref.includes("claim%3D1");
    await screenshot(page, report, "identity-confirmation-guest-generic-auth.png");

    const manageHref = await page.getByRole("link", { name: "Manage this booking" }).getAttribute("href");
    if (!manageHref) {
      throw new Error("Guest confirmation did not expose manage-token link.");
    }
    report.manageHrefHasToken = /\/booking\/manage\/[a-f0-9]{64}/i.test(manageHref);
    report.manageHrefRedacted = redactManageToken(manageHref);

    const guestBooking = await bookingByManageHref(admin, manageHref);
    report.guestBookingNotAttached = Boolean(guestBooking && !guestBooking.customer_user_id);
    report.guestBookingId = guestBooking?.id ?? null;

    await page.goto(new URL(manageHref, baseUrl).toString(), { waitUntil: "networkidle" });
    await page.getByText("Booking management").waitFor({ timeout: 20000 });
    await page.getByText("Save this booking").waitFor({ timeout: 20000 });
    report.guestManageFlowWorks = true;
    report.claimUiOnlyOnExplicitManage = true;
    await screenshot(page, report, "identity-manage-token-explicit-claim.png");
  } finally {
    await context.close();
  }
}

async function runSignInPreserveAndAttachFlow(browser, admin, fixtures, authFixture, report) {
  const context = await browser.newContext({ viewport: { height: 900, width: 1440 } });
  const page = await context.newPage();
  recordPageErrors(page, report);

  try {
    await openDetails(page, fixtures);
    await page.getByRole("link", { name: "Sign in" }).click();
    await page.getByRole("heading", { name: "Login" }).waitFor({ timeout: 20000 });
    report.signInDraftStored = await page.evaluate(
      (key) => Boolean(window.sessionStorage.getItem(key)),
      draftStorageKey(),
    );
    const currentUrl = new URL(page.url());
    report.signInReturnUrlSafe =
      currentUrl.pathname === "/login" &&
      currentUrl.searchParams.get("next") === `/book/${salonId}`;

    await page.getByLabel("Email").fill(accountEmail);
    await page.getByLabel("Password").fill(accountPassword);
    await page.getByRole("button", { name: "Login" }).click();
    await page.getByRole("heading", { name: "Tell us who is coming" }).waitFor({
      timeout: 30000,
    });
    await page.getByText(`${marker} Account`).waitFor({ timeout: 20000 });
    report.signInReturnedToBookingDetails = true;
    report.signedInNoBlankContactForm =
      (await page.locator("#public-booking-first-name").count()) === 0 &&
      (await page.locator("#public-booking-last-name").count()) === 0 &&
      (await page.locator("#public-booking-email").count()) === 0;
    report.missingProfileFieldHandling =
      (await page.locator("#public-booking-phone").count()) === 1;
    await screenshot(page, report, "identity-signed-in-account-card.png");

    await page.locator("#public-booking-phone").fill(accountPhoneForBooking);
    await page.getByTestId("public-booking-primary-action").click();
    await page.getByRole("heading", { name: "Review your visit" }).waitFor();
    await page.getByTestId("public-booking-primary-action").click();
    await page.getByText("This booking is saved to your KingPOS account.").waitFor({
      timeout: 30000,
    });
    report.signedInConfirmationSaved = true;
    await screenshot(page, report, "identity-confirmation-signed-in-saved.png");

    const booking = await latestBookingForCustomerUser(admin, authFixture.publicUser.id);
    report.signedInBookingAttachedToSessionUser =
      booking?.customer_user_id === authFixture.publicUser.id;
    report.signedInBookingId = booking?.id ?? null;
  } finally {
    await context.close();
  }
}

async function runSignupPreserveFlow(browser, fixtures, report) {
  const context = await browser.newContext({ viewport: { height: 900, width: 1440 } });
  const page = await context.newPage();
  recordPageErrors(page, report);

  try {
    await openDetails(page, fixtures);
    await page.getByRole("link", { name: "Create account" }).click();
    await page.getByRole("heading", { name: "Create account" }).waitFor({
      timeout: 20000,
    });
    report.signupDraftStored = await page.evaluate(
      (key) => Boolean(window.sessionStorage.getItem(key)),
      draftStorageKey(),
    );
    const currentUrl = new URL(page.url());
    report.signupReturnUrlSafe =
      currentUrl.pathname === "/signup" &&
      currentUrl.searchParams.get("next") === `/book/${salonId}`;

    report.signupHandoffPreservesDraft =
      report.signupDraftStored && report.signupReturnUrlSafe;
    await screenshot(page, report, "identity-signup-handoff.png");
  } finally {
    await context.close();
  }
}

async function runMobileChoiceSmoke(browser, fixtures, report) {
  const context = await browser.newContext({ viewport: { height: 844, width: 390 } });
  const page = await context.newPage();
  recordPageErrors(page, report);

  try {
    await openDetails(page, fixtures);
    await page.getByText("How would you like to continue?").waitFor();
    await screenshot(page, report, "identity-details-choice-mobile.png");
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
  accountEnumerationCopyHidden: false,
  authFixture: null,
  baseUrl,
  claimUiOnlyOnExplicitManage: false,
  clientSpoofUserIdFieldPresent: false,
  consoleErrors: [],
  continueGuestOpensForm: false,
  fixtureIds: null,
  guestBookingId: null,
  guestBookingNotAttached: false,
  guestCanReturnToChoice: false,
  guestConfirmationAuthSuggestionIsGeneric: false,
  guestManageFlowWorks: false,
  manageHrefHasToken: false,
  manageHrefRedacted: null,
  marker,
  missingProfileFieldHandling: false,
  mobileUiFacts: null,
  networkErrors: [],
  ok: false,
  pageErrors: [],
  screenshots: [],
  signInDraftStored: false,
  signInReturnUrlSafe: false,
  signInReturnedToBookingDetails: false,
  signedInBookingAttachedToSessionUser: false,
  signedInBookingId: null,
  signedInConfirmationSaved: false,
  signedInNoBlankContactForm: false,
  signedOutInitialNoGuestForm: false,
  signedOutPrimaryDisabled: false,
  signupDraftStored: false,
  signupHandoffPreservesDraft: false,
  signupRequiresEmailConfirmation: false,
  signupReturnUrlSafe: false,
};

let admin;
let authFixture;
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
  authFixture = await createAuthFixture(admin, report);
  fixtures = await seedFixtures(admin, report);

  const browser = await launchBrowser();
  try {
    await runSignedOutGuestFlow(browser, admin, fixtures, report);
    await runSignInPreserveAndAttachFlow(browser, admin, fixtures, authFixture, report);
    await runSignupPreserveFlow(browser, fixtures, report);
    await runMobileChoiceSmoke(browser, fixtures, report);
  } finally {
    await browser.close();
  }

  report.ok =
    report.consoleErrors.length === 0 &&
    report.pageErrors.length === 0 &&
    report.networkErrors.length === 0 &&
    report.signedOutInitialNoGuestForm &&
    report.signedOutPrimaryDisabled &&
    report.continueGuestOpensForm &&
    report.guestCanReturnToChoice &&
    report.signInDraftStored &&
    report.signInReturnUrlSafe &&
    report.signInReturnedToBookingDetails &&
    report.signupDraftStored &&
    report.signupReturnUrlSafe &&
    report.signupHandoffPreservesDraft &&
    report.signedInNoBlankContactForm &&
    report.signedInBookingAttachedToSessionUser &&
    !report.clientSpoofUserIdFieldPresent &&
    report.guestBookingNotAttached &&
    report.accountEnumerationCopyHidden &&
    report.guestManageFlowWorks &&
    report.claimUiOnlyOnExplicitManage &&
    report.missingProfileFieldHandling &&
    report.guestConfirmationAuthSuggestionIsGeneric &&
    report.manageHrefHasToken &&
    report.mobileUiFacts?.documentScrollWidth <= report.mobileUiFacts?.innerWidth + 2 &&
    report.mobileUiFacts?.bodyScrollWidth <= report.mobileUiFacts?.innerWidth + 2;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (admin) {
    await cleanup(admin, fixtures, authFixture).catch((error) => {
      report.cleanupError = error instanceof Error ? error.message : String(error);
    });
  }

  await writeFile(
    path.join(artifactsDir, "customer-booking-identity-qa-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

if (!report.ok) {
  process.exitCode = 1;
}

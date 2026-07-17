import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const artifactsDir = path.resolve("artifacts/booking-browser-test");
const baseUrl = process.env.GATEBD_BASE_URL ?? "http://127.0.0.1:3352";
const salonId = process.env.GATEBD_SALON_ID ?? "7f599bc8-a806-4a68-be86-c149c21709e2";
const slotDate = process.env.GATEBD_DATE ?? "2026-07-20";
const marker = `GateBD ${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
const customerEmail = `${marker.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@example.test`;
const staffEmail = customerEmail.replace("@", "+staff@");

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
    if (response.url().includes(".css")) {
      report.cssResponses.push({
        ok: response.ok(),
        status: response.status(),
        url: response.url().replace(/\?.*$/, ""),
      });
    }

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

async function screenshotViewport(page, report, name) {
  await page.screenshot({
    fullPage: false,
    path: path.join(artifactsDir, name),
  });
  report.screenshots.push(name);
}

async function captureMobilePublic(page, report, name) {
  const previousViewport = page.viewportSize();
  await page.setViewportSize({ height: 844, width: 390 });
  await page.waitForTimeout(150);
  await screenshot(page, report, name);
  const overflow = await page.evaluate(() => {
    const selectors = [
      "[data-testid='public-booking-stepper']",
      "[data-testid='public-booking-content']",
      "[data-testid='public-booking-summary']",
      "[data-testid='public-booking-primary-action']",
    ];
    const outsideViewport = selectors.flatMap((selector) =>
      Array.from(document.querySelectorAll(selector)).map((element) => {
        const rect = element.getBoundingClientRect();

        return {
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          selector,
          top: rect.top,
          viewportWidth: window.innerWidth,
          width: rect.width,
        };
      }).filter((item) => item.left < -1 || item.right > item.viewportWidth + 1),
    );

    return {
      bodyScrollWidth: document.body.scrollWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      outsideViewport,
    };
  });
  report.mobileOverflowChecks.push({ name, ...overflow });

  if (previousViewport) {
    await page.setViewportSize(previousViewport);
    await page.waitForTimeout(150);
  }
}

function near(value, target, tolerance) {
  return Math.abs(value - target) <= tolerance;
}

function px(value) {
  return Number.parseFloat(String(value ?? "0")) || 0;
}

async function collectPublicStyleFacts(page) {
  return page.evaluate(() => {
    function read(selector) {
      const element = document.querySelector(selector);

      if (!element) {
        return null;
      }

      const computed = getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return {
        className:
          typeof element.className === "string"
            ? element.className
            : String(element.className),
        rect: {
          bottom: rect.bottom,
          height: rect.height,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
          x: rect.x,
          y: rect.y,
        },
        style: {
          backgroundColor: computed.backgroundColor,
          backgroundImage: computed.backgroundImage,
          borderColor: computed.borderTopColor,
          borderRadius: computed.borderTopLeftRadius,
          boxShadow: computed.boxShadow,
          color: computed.color,
          display: computed.display,
          fontFamily: computed.fontFamily,
          gridTemplateColumns: computed.gridTemplateColumns,
          maxWidth: computed.maxWidth,
          minHeight: computed.minHeight,
          opacity: computed.opacity,
          position: computed.position,
          top: computed.top,
          width: computed.width,
        },
        text: element.textContent?.trim().slice(0, 120) ?? "",
      };
    }

    const summary = document.querySelector("[data-testid='public-booking-summary']");
    const cta = document.querySelector("[data-testid='public-booking-primary-action']");
    const addonInput = document.querySelector(
      "[data-testid='public-booking-addon-panel'] input[type='checkbox']",
    );

    return {
      addonCard: read("[data-testid='public-booking-addon-panel'] label"),
      addonInput: read("[data-testid='public-booking-addon-panel'] input[type='checkbox']"),
      addonPanel: read("[data-testid='public-booking-addon-panel']"),
      addonVisual: read("[data-testid='public-booking-addon-panel'] .public-booking-checkbox-visual"),
      body: {
        bodyScrollWidth: document.body.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
      },
      content: read("[data-testid='public-booking-content']"),
      cta: read("[data-testid='public-booking-primary-action']"),
      ctaInsideSummary: Boolean(summary && cta && summary.contains(cta)),
      editorial: read("[data-testid='public-booking-editorial']"),
      editorialImage: read("[data-testid='public-booking-editorial'] .public-booking-editorial-image"),
      hiddenCheckbox:
        addonInput instanceof HTMLInputElement
          ? {
              checked: addonInput.checked,
              opacity: getComputedStyle(addonInput).opacity,
              type: addonInput.type,
            }
          : null,
      root: read("[data-testid='public-booking-root']"),
      serviceCard: read("[data-testid='public-booking-service-card']"),
      serviceIcon: read("[data-testid='public-booking-service-card'] .public-booking-service-icon"),
      shell: read("[data-testid='public-booking-shell']"),
      stepper: read("[data-testid='public-booking-stepper']"),
      summary: read("[data-testid='public-booking-summary']"),
    };
  });
}

async function assertPublicStyleContract(page, report) {
  const facts = await collectPublicStyleFacts(page);
  const assertions = [];
  const add = (label, passed, actual) => assertions.push({ actual, label, passed });
  const gridColumns = (value) => String(value ?? "").split(/\s+/).filter(Boolean);

  add("root has warm canvas", facts.root?.style.backgroundColor === "rgb(251, 249, 247)", facts.root?.style.backgroundColor);
  add("root uses Manrope", /Manrope/.test(facts.root?.style.fontFamily ?? ""), facts.root?.style.fontFamily);
  add(
    "desktop has no horizontal overflow",
    facts.body.documentScrollWidth <= facts.body.clientWidth + 1 &&
      facts.body.bodyScrollWidth <= facts.body.clientWidth + 1,
    facts.body,
  );
  add(
    "stepper is five-column grid near 820px",
    facts.stepper?.style.display === "grid" &&
      gridColumns(facts.stepper?.style.gridTemplateColumns).length === 5 &&
      near(facts.stepper?.rect.width ?? 0, 820, 6),
    facts.stepper,
  );
  add(
    "shell is desktop three-column grid",
    facts.shell?.style.display === "grid" &&
      gridColumns(facts.shell?.style.gridTemplateColumns).length === 3 &&
      near(facts.shell?.rect.width ?? 0, 1370, 8),
    facts.shell,
  );
  add(
    "editorial rail visible with rounded image",
    facts.editorial?.rect.width &&
      near(facts.editorial.rect.width, 168, 8) &&
      px(facts.editorialImage?.style.borderRadius) >= 17,
    { editorial: facts.editorial, image: facts.editorialImage },
  );
  add(
    "service card has card treatment",
    facts.serviceCard?.style.display === "grid" &&
      (facts.serviceCard.style.backgroundColor === "rgb(255, 255, 255)" ||
        facts.serviceCard.style.backgroundColor === "rgba(100, 42, 86, 0.035)") &&
      px(facts.serviceCard.style.borderRadius) >= 14 &&
      (facts.serviceCard.rect.height ?? 0) >= 106,
    facts.serviceCard,
  );
  add(
    "service icon tile is styled",
    facts.serviceIcon?.style.backgroundColor === "rgb(239, 232, 243)" &&
      near(facts.serviceIcon.rect.width ?? 0, 54, 2),
    facts.serviceIcon,
  );
  add(
    "add-on panel and cards are styled",
    facts.addonPanel?.style.display === "block" &&
      px(facts.addonPanel.style.borderRadius) >= 15 &&
      facts.addonCard?.style.display === "grid" &&
      px(facts.addonCard.style.borderRadius) >= 12,
    { card: facts.addonCard, panel: facts.addonPanel },
  );
  add(
    "native checkbox is visually replaced",
    facts.hiddenCheckbox?.opacity === "0" &&
      facts.addonVisual?.style.borderRadius === "6px",
    { input: facts.hiddenCheckbox, visual: facts.addonVisual },
  );
  add(
    "summary is sticky 400px card",
    facts.summary?.style.position === "sticky" &&
      near(facts.summary.rect.width ?? 0, 400, 18) &&
      px(facts.summary.style.borderRadius) >= 16 &&
      facts.summary.style.boxShadow !== "none",
    facts.summary,
  );
  add(
    "primary action lives in sticky summary",
    facts.ctaInsideSummary &&
      facts.cta?.style.color === "rgb(255, 255, 255)" &&
      px(facts.cta.style.minHeight) >= 50 &&
      facts.cta.style.backgroundColor === "rgb(100, 42, 86)" &&
      facts.cta.style.backgroundImage.includes("gradient"),
    { cta: facts.cta, ctaInsideSummary: facts.ctaInsideSummary },
  );

  report.publicStyleFacts = facts;
  report.publicStyleAssertions = assertions;
}

async function seedFixtures(admin) {
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
      .select("email")
      .eq("id", organization.owner_user_id)
      .single(),
    "load owner",
  );

  const staff = assertOk(
    await admin
      .from("staff")
      .insert({
        display_name: "Sofia Rivera",
        email: staffEmail,
        first_name: "Sofia",
        is_active: true,
        job_title: "Senior nail artist",
        last_name: "Rivera",
        online_booking_enabled: true,
        organization_id: organization.id,
        owner_public_enabled: true,
        phone: "+1555010700",
        profile_display_order: -7300,
        public_bio: "Detail-focused nail care with calm, polished service.",
        public_profile_visible: true,
        salon_id: salon.id,
        salon_profile_content_posting_enabled: true,
        specialties: ["Gel", "Pedicure"],
        staff_public_consent_status: "granted",
      })
      .select("id")
      .single(),
    "create staff",
  );
  const services = assertOk(
    await admin
      .from("services")
      .insert([
        {
          base_price: 48,
          category: "Manicure",
          description: "Long-lasting gel color with a glossy finish.",
          duration_minutes: 45,
          is_active: true,
          name: "Luna Gel Manicure",
          organization_id: organization.id,
          salon_id: salon.id,
        },
        {
          base_price: 32,
          category: "Manicure",
          description: "Nail shaping, cuticle care, hand massage, and polish.",
          duration_minutes: 35,
          is_active: true,
          name: "Signature Manicure",
          organization_id: organization.id,
          salon_id: salon.id,
        },
        {
          base_price: 62,
          category: "Manicure",
          description: "Added strength and structure for a flawless natural finish.",
          duration_minutes: 60,
          is_active: true,
          name: "Builder Gel Overlay",
          organization_id: organization.id,
          salon_id: salon.id,
        },
        {
          base_price: 64,
          category: "Pedicure",
          description: "Soak, shaping, cuticle care, massage, and polish.",
          duration_minutes: 50,
          is_active: true,
          name: "Luna Spa Pedicure",
          organization_id: organization.id,
          salon_id: salon.id,
        },
        {
          base_price: 12,
          category: "Add-ons",
          description: "A clean French finish for your manicure.",
          duration_minutes: 15,
          is_active: true,
          name: "French finish",
          organization_id: organization.id,
          salon_id: salon.id,
        },
      ])
      .select("id, name"),
    "create services",
  );
  const serviceByName = new Map(services.map((service) => [service.name, service]));
  const gel = serviceByName.get("Luna Gel Manicure");
  const pedicure = serviceByName.get("Luna Spa Pedicure");
  const french = serviceByName.get("French finish");

  if (!gel || !pedicure || !french) {
    throw new Error("Temporary services were not created.");
  }

  await assertOk(
    await admin.from("staff_service_assignments").insert(
      services.map((service) => service.id).map((serviceId) => ({
        is_active: true,
        online_bookable: true,
        organization_id: organization.id,
        salon_id: salon.id,
        service_id: serviceId,
        staff_id: staff.id,
      })),
    ),
    "create assignments",
  );
  const addOnLink = assertOk(
    await admin
      .from("service_add_on_links")
      .insert({
        add_on_service_id: french.id,
        display_order: -7300,
        is_active: true,
        organization_id: organization.id,
        parent_service_id: gel.id,
        salon_id: salon.id,
      })
      .select("id")
      .single(),
    "create add-on link",
  );
  const rule = assertOk(
    await admin
      .from("staff_availability_rules")
      .insert({
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
      })
      .select("id")
      .single(),
    "create availability rule",
  );

  return {
    addOnLinkId: addOnLink.id,
    frenchId: french.id,
    gelId: gel.id,
    organization,
    owner,
    pedicureId: pedicure.id,
    ruleId: rule.id,
    salon,
    serviceIds: services.map((service) => service.id),
    staffId: staff.id,
  };
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

async function runPublicFlow(fixtures, report) {
  const browser = await launchBrowser();

  try {
    const context = await browser.newContext({
      viewport: { height: 891, width: 1652 },
    });
    const page = await context.newPage();
    recordPageErrors(page, report);

    await page.goto(
      `${baseUrl}/book/${salonId}?serviceId=${fixtures.gelId}&date=${slotDate}`,
      { waitUntil: "networkidle" },
    );
    await page.getByRole("heading", { name: "Choose your services" }).waitFor({
      timeout: 20000,
    });
    const french = page.getByLabel(/French finish/).first();
    if (!(await french.isChecked())) {
      await page
        .locator("[data-testid='public-booking-addon-panel'] label")
        .filter({ hasText: /French finish/ })
        .first()
        .click();
    }
    await assertPublicStyleContract(page, report);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    await screenshotViewport(page, report, "gateD-public-services-reference-desktop.png");

    await page.getByRole("button", { name: /Pedicure/ }).click();
    await page.getByRole("button", { name: /Luna Spa Pedicure/ }).click();
    if (!(await french.isChecked())) {
      await page
        .locator("[data-testid='public-booking-addon-panel'] label")
        .filter({ hasText: /French finish/ })
        .first()
        .click();
    }
    await assertPublicStyleContract(page, report);
    await screenshot(page, report, "gateD-public-services-multi-primary.png");
    await captureMobilePublic(page, report, "gateD-public-services-mobile.png");

    await page.getByRole("button", { name: "Next: Choose professional" }).click();
    await page.getByRole("heading", { name: "Choose your professional" }).waitFor();
    await screenshot(page, report, "gateD-public-professional.png");

    await page.getByRole("button", { name: "Next: Date & time" }).click();
    await page.getByRole("heading", { name: "Find a time" }).waitFor();
    await screenshot(page, report, "gateD-public-date-time.png");
    const slotButton = page
      .locator("button")
      .filter({ hasText: /\d{1,2}:\d{2}\s?(AM|PM)/ })
      .first();
    await slotButton.click({ timeout: 20000 });

    await page.getByRole("button", { name: "Next: Your details" }).click();
    await page.getByRole("heading", { name: "Tell us who is coming" }).waitFor();
    await page.getByLabel("First name").fill("Ava");
    await page.getByLabel("Last name").fill("Johnson");
    await page.getByLabel("Phone").fill("+1555010730");
    await page.getByLabel("Email").fill(customerEmail);
    await page.getByLabel("Notes for the salon").fill(`${marker} browser public notes`);
    await screenshot(page, report, "gateD-public-details.png");

    await page.getByRole("button", { name: "Next: Review" }).click();
    await page.getByRole("heading", { name: "Review your visit" }).waitFor();
    await page.getByText("Luna Gel Manicure").waitFor();
    await page.getByText("Luna Spa Pedicure").waitFor();
    await page.getByText("French finish").waitFor();
    await screenshot(page, report, "gateD-public-review.png");
    await captureMobilePublic(page, report, "gateD-public-review-mobile.png");

    const submit = page
      .getByRole("button", { name: "Confirm booking" })
      .or(page.getByRole("button", { name: "Request appointment" }));
    await submit.click();
    await page
      .getByRole("heading", { name: /Booking confirmed|Request received/ })
      .waitFor({ timeout: 30000 });
    await screenshot(page, report, "gateD-public-confirmation.png");
    await captureMobilePublic(page, report, "gateD-public-confirmation-mobile.png");

    const manageHref = await page
      .getByRole("link", { name: "Manage booking" })
      .getAttribute("href")
      .catch(() => null);
    if (manageHref) {
      await page.goto(new URL(manageHref, baseUrl).toString(), { waitUntil: "networkidle" });
      await page.getByText("Luna Gel Manicure").waitFor({ timeout: 20000 });
      await page.getByText("Luna Spa Pedicure").waitFor();
      await screenshot(page, report, "gateE-manage-multi-line.png");
    }
  } finally {
    await browser.close();
  }
}

async function customerIdsForEmail(admin, email) {
  const customers = assertOk(
    await admin
      .from("customers")
      .select("id")
      .eq("location_id", salonId)
      .eq("email", email)
      .limit(20),
    "load public test customers",
  );

  return customers.map((customer) => customer.id);
}

async function bookingIdsForFixtureServices(admin, fixtures) {
  const lines = assertOk(
    await admin
      .from("booking_lines")
      .select("booking_id")
      .eq("salon_id", salonId)
      .in("service_id", fixtures.serviceIds)
      .limit(50),
    "load fixture booking lines",
  );

  return [...new Set(lines.map((line) => line.booking_id).filter(Boolean))];
}

async function lookupCreatedBooking(admin, fixtures) {
  const bookingIds = await bookingIdsForFixtureServices(admin, fixtures);

  if (bookingIds.length === 0) {
    throw new Error("No public test booking lines were created.");
  }

  return assertOk(
    await admin
      .from("bookings")
      .select("id, status, confirmation_status, booking_lines(id, line_type, service_name_snapshot, service_id, parent_booking_line_id)")
      .eq("salon_id", salonId)
      .in("id", bookingIds)
      .order("created_at", { ascending: false })
      .limit(1)
      .single(),
    "load public test booking",
  );
}

async function runOwnerFlow(fixtures, booking, session, report) {
  const browser = await launchBrowser();

  try {
    const context = await browser.newContext({
      viewport: { height: 941, width: 1610 },
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
        value: `manage:${fixtures.salon.id}`,
      },
      {
        name: "kingpos-current-organization-id",
        sameSite: "Lax",
        url: baseUrl,
        value: fixtures.organization.id,
      },
      {
        name: "kingpos-current-manage-salon-id",
        sameSite: "Lax",
        url: baseUrl,
        value: fixtures.salon.id,
      },
      {
        name: "kingpos-current-salon-id",
        sameSite: "Lax",
        url: baseUrl,
        value: fixtures.salon.id,
      },
    ]);

    const page = await context.newPage();
    recordPageErrors(page, report);
    await page.goto(
      `${baseUrl}/bookings?date=${slotDate}&view=list&bookingId=${booking.id}`,
      { waitUntil: "networkidle" },
    );
    await page.getByRole("heading", { name: "Booking" }).waitFor({ timeout: 20000 });
    await page.getByText("Ava Johnson").first().waitFor({ timeout: 20000 });
    await screenshot(page, report, "gateB-owner-list-detail.png");

    await page.getByPlaceholder("Search customer or service").fill("Ava");
    await page.keyboard.press("Enter");
    await page.getByText("Ava Johnson").first().waitFor();
    await screenshot(page, report, "gateB-owner-search.png");

    await page.goto(`${baseUrl}/bookings?date=${slotDate}&view=day`, {
      waitUntil: "networkidle",
    });
    await page.getByTestId("booking-owner-view-selector").click();
    await page.getByRole("link", { name: "Week" }).click();
    await page.waitForURL(/view=week/);
    await screenshot(page, report, "gateB-owner-week.png");
    await page.goBack({ waitUntil: "networkidle" });
    if (!page.url().includes("view=day")) {
      throw new Error("Owner view selector browser history did not return to day view.");
    }

    await page.getByRole("link", { exact: true, name: "Booking page" }).click();
    await page.getByText("Customer preview").waitFor({ timeout: 20000 });
    const previewFrame = page.frameLocator('iframe[title="Public booking preview"]');
    await previewFrame.getByTestId("public-booking-root").waitFor({ timeout: 20000 });
    report.ownerBookingPagePreview = await previewFrame
      .getByTestId("public-booking-root")
      .evaluate((element) => {
        const computed = getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return {
          backgroundColor: computed.backgroundColor,
          height: rect.height,
          text: element.textContent?.slice(0, 120) ?? "",
          width: rect.width,
        };
      });
    await screenshot(page, report, "gateB-owner-booking-page.png");

    await page.getByRole("link", { exact: true, name: "Availability" }).click();
    await page.getByText("Weekly hours").first().waitFor({ timeout: 20000 }).catch(() => {});
    await screenshot(page, report, "gateB-owner-availability.png");

    await page.getByRole("link", { exact: true, name: "Settings" }).click();
    await page.getByText("Confirmation mode").first().waitFor({ timeout: 20000 });
    await screenshot(page, report, "gateB-owner-settings.png");

    await page.getByRole("button", { name: "New appointment" }).click();
    await page.getByRole("heading", { name: "New appointment" }).waitFor({
      timeout: 20000,
    });
    await screenshot(page, report, "gateB-owner-new-appointment.png");
  } finally {
    await browser.close();
  }
}

async function cleanup(admin, fixtures, bookingId) {
  if (bookingId) {
    await admin
      .from("bookings")
      .update({
        cancellation_reason: "GateBD public owner browser cleanup",
        cancelled_at: new Date().toISOString(),
        confirmation_status: "cancelled",
        status: "cancelled",
      })
      .eq("id", bookingId)
      .eq("salon_id", salonId);
  } else {
    const customerIds = await customerIdsForEmail(admin, customerEmail).catch(() => []);
    const bookingIds = fixtures
      ? await bookingIdsForFixtureServices(admin, fixtures).catch(() => [])
      : [];

    if (customerIds.length > 0) {
      await admin
        .from("bookings")
        .update({
          cancellation_reason: "GateBD public owner browser cleanup by customer email",
          cancelled_at: new Date().toISOString(),
          confirmation_status: "cancelled",
          status: "cancelled",
        })
        .eq("salon_id", salonId)
        .in("customer_id", customerIds);
    }

    if (bookingIds.length > 0) {
      await admin
        .from("bookings")
        .update({
          cancellation_reason: "GateBD public owner browser cleanup by fixture lines",
          cancelled_at: new Date().toISOString(),
          confirmation_status: "cancelled",
          status: "cancelled",
        })
        .eq("salon_id", salonId)
        .in("id", bookingIds);
    }
  }

  if (!fixtures) {
    await admin
      .from("staff")
      .update({
        is_active: false,
        online_booking_enabled: false,
        owner_public_enabled: false,
        public_profile_visible: false,
      })
      .eq("email", staffEmail)
      .eq("salon_id", salonId);
    return;
  }

  await admin
    .from("staff_availability_rules")
    .update({ is_active: false })
    .eq("id", fixtures.ruleId);
  await admin
    .from("service_add_on_links")
    .update({ is_active: false })
    .eq("id", fixtures.addOnLinkId);
  await admin
    .from("staff_service_assignments")
    .update({ is_active: false, online_bookable: false })
    .eq("staff_id", fixtures.staffId)
    .eq("salon_id", salonId);
  await admin
    .from("services")
    .update({ is_active: false })
    .in("id", fixtures.serviceIds);
  await admin
    .from("staff")
    .update({
      is_active: false,
      online_booking_enabled: false,
      owner_public_enabled: false,
      public_profile_visible: false,
    })
    .eq("id", fixtures.staffId)
    .eq("salon_id", salonId);
}

const report = {
  activeTestBookingCount: null,
  baseUrl,
  bookingId: null,
  consoleErrors: [],
  cssResponses: [],
  customerEmail,
  fixtureIds: null,
  lineVerification: null,
  marker,
  mobileOverflowChecks: [],
  networkErrors: [],
  ok: false,
  pageErrors: [],
  publicStyleAssertions: [],
  publicStyleFacts: null,
  screenshots: [],
};

let fixtures = null;
let createdBooking = null;

try {
  await mkdir(artifactsDir, { recursive: true });
  const env = await loadEnv();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? (await loadLinkedServiceRoleKey());

  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Supabase browser gate environment is missing.");
  }

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  fixtures = await seedFixtures(admin);
  report.fixtureIds = {
    addOnLink: fixtures.addOnLinkId,
    services: fixtures.serviceIds,
    staff: fixtures.staffId,
    staffAvailabilityRule: fixtures.ruleId,
  };

  await runPublicFlow(fixtures, report);
  createdBooking = await lookupCreatedBooking(admin, fixtures);
  report.bookingId = createdBooking.id;
  report.lineVerification = {
    addOnLines: createdBooking.booking_lines.filter((line) => line.line_type === "add_on").length,
    serviceLines: createdBooking.booking_lines.filter((line) => line.line_type === "service").length,
    snapshots: createdBooking.booking_lines.map((line) => line.service_name_snapshot),
  };

  const session = await createOwnerSession(env, serviceRoleKey, fixtures.owner.email);
  await runOwnerFlow(fixtures, createdBooking, session, report);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  if (fixtures) {
    const env = await loadEnv();
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? (await loadLinkedServiceRoleKey());
    const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await cleanup(admin, fixtures, createdBooking?.id ?? null).catch((error) => {
      report.cleanupError = error instanceof Error ? error.message : String(error);
    });

    const bookingIds = await bookingIdsForFixtureServices(admin, fixtures).catch(() => []);
    const remaining =
      bookingIds.length > 0
        ? await admin
            .from("bookings")
            .select("id", { count: "exact", head: true })
            .eq("salon_id", salonId)
            .in("id", bookingIds)
            .not("status", "in", "(cancelled,no_show)")
        : { count: 0 };
    report.activeTestBookingCount = remaining.count ?? 0;
  }

  report.ok =
    !report.error &&
    !report.cleanupError &&
    report.cssResponses.every((response) => response.ok) &&
    report.publicStyleAssertions.every((assertion) => assertion.passed) &&
    report.consoleErrors.length === 0 &&
    report.pageErrors.length === 0 &&
    report.networkErrors.length === 0 &&
    report.mobileOverflowChecks.every(
      (check) =>
        check.bodyScrollWidth <= check.innerWidth + 2 &&
        check.documentScrollWidth <= check.innerWidth + 2 &&
        check.outsideViewport.length === 0,
    ) &&
    report.lineVerification?.serviceLines === 2 &&
    report.lineVerification?.addOnLines === 1 &&
    report.activeTestBookingCount === 0;

  await writeFile(
    path.join(artifactsDir, "gateBD-public-owner-e2e-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (!report.ok) {
    process.exitCode = 1;
  }
}

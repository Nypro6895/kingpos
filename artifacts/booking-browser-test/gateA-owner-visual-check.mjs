import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const artifactsDir = path.resolve("artifacts/booking-browser-test");
const baseUrl = process.env.GATEA_BASE_URL ?? "http://127.0.0.1:3351";
const salonId = process.env.GATEA_SALON_ID ?? "7f599bc8-a806-4a68-be86-c149c21709e2";
const date = process.env.GATEA_DATE ?? "2026-07-15";
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

function parseRgb(value) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

  if (!match) {
    return null;
  }

  return match.slice(1, 4).map(Number);
}

function colorNear(value, target, tolerance = 4) {
  const rgb = parseRgb(value);

  if (!rgb) {
    return false;
  }

  return rgb.every((channel, index) => Math.abs(channel - target[index]) <= tolerance);
}

function numberValue(value) {
  return Number.parseFloat(String(value).replace("px", ""));
}

function between(value, min, max) {
  const numeric = typeof value === "number" ? value : numberValue(value);

  return Number.isFinite(numeric) && numeric >= min && numeric <= max;
}

function columnsCount(value) {
  if (!value || value === "none") {
    return 0;
  }

  return value.split(" ").filter(Boolean).length;
}

function addAssertion(assertions, label, passed, details = {}) {
  assertions.push({ details, label, passed: Boolean(passed) });
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
    "load owner salon",
  );
  const organization = assertOk(
    await admin
      .from("organizations")
      .select("id, name, owner_user_id")
      .eq("id", salon.organization_id)
      .single(),
    "load owner organization",
  );
  const owner = assertOk(
    await admin
      .from("users")
      .select("email")
      .eq("id", organization.owner_user_id)
      .single(),
    "load owner user",
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

async function collectComputedStyles(page) {
  return page.evaluate(() => {
    function pickStyle(element, props) {
      if (!element) {
        return null;
      }

      const computed = getComputedStyle(element);
      return Object.fromEntries(props.map((prop) => [prop, computed.getPropertyValue(prop)]));
    }

    function rect(element) {
      if (!element) {
        return null;
      }

      const box = element.getBoundingClientRect();
      return {
        bottom: box.bottom,
        height: box.height,
        left: box.left,
        right: box.right,
        top: box.top,
        width: box.width,
      };
    }

    function byTestId(id) {
      return document.querySelector(`[data-testid="${id}"]`);
    }

    function activeTab(tabs) {
      return tabs?.querySelector("[aria-current='page']");
    }

    const ownerCanvas = byTestId("booking-owner-root");
    const heading = byTestId("booking-owner-heading");
    const headingTitle = heading?.querySelector("h1") ?? null;
    const eyebrow = heading?.querySelector("p") ?? null;
    const cta = byTestId("booking-owner-new-appointment");
    const tabs = byTestId("booking-owner-tabs");
    const tab = activeTab(tabs);
    const tabBadge = tabs?.querySelector("span") ?? null;
    const kpiWrapper = byTestId("booking-owner-kpi-grid");
    const kpiCard = byTestId("booking-owner-kpi-card");
    const kpiIcons = Array.from(
      document.querySelectorAll('[data-testid="booking-owner-kpi-icon"]'),
    );
    const board = byTestId("booking-owner-board");
    const toolbar = byTestId("booking-owner-toolbar");
    const statusRow = byTestId("booking-owner-status-filters");
    const statusChip = statusRow?.querySelector("a") ?? null;
    const emptyState = document.querySelector(".booking-empty-state");
    const ownerContent = document.querySelector(".booking-owner-content");
    const datePicker = document.querySelector(".booking-date-picker");
    const nativeDateInput = document.querySelector(".booking-date-picker__native");
    const searchInput = document.querySelector(".booking-search-input");
    const viewSelector = byTestId("booking-owner-view-selector");
    const filterButton = document.querySelector(".booking-filter-details summary");
    const readinessBanner = byTestId("booking-owner-readiness-banner");

    return {
      classAttributes: {
        cta: cta?.getAttribute("class") ?? null,
        emptyState: emptyState?.getAttribute("class") ?? null,
        heading: heading?.getAttribute("class") ?? null,
        kpiWrapper: kpiWrapper?.getAttribute("class") ?? null,
        ownerCanvas: ownerCanvas?.getAttribute("class") ?? null,
        ownerContent: ownerContent?.getAttribute("class") ?? null,
        tabs: tabs?.getAttribute("class") ?? null,
        workspace: board?.getAttribute("class") ?? null,
      },
      computed: {
        board: pickStyle(board, ["background-color", "border-top-color", "border-radius", "overflow"]),
        cta: pickStyle(cta, ["background-color", "color", "border-radius", "font-family", "height", "min-height"]),
        emptyState: pickStyle(emptyState, ["background-color", "border-top-style", "border-top-color", "border-radius"]),
        eyebrow: pickStyle(eyebrow, ["color", "font-size", "font-weight", "letter-spacing", "text-transform"]),
        headingTitle: pickStyle(headingTitle, ["color", "font-size", "font-weight"]),
        kpiCard: pickStyle(kpiCard, ["background-color", "border-top-color", "border-radius", "min-height"]),
        kpiIcons: kpiIcons.map((icon) => ({
          tone: icon.getAttribute("data-kpi-tone"),
          style: pickStyle(icon, [
            "background-color",
            "border-radius",
            "color",
            "height",
            "width",
          ]),
        })),
        kpiWrapper: pickStyle(kpiWrapper, ["display", "gap", "grid-template-columns"]),
        datePicker: pickStyle(datePicker, ["display", "min-height", "opacity", "width"]),
        filterButton: pickStyle(filterButton, ["display", "gap", "height"]),
        nativeDateInput: pickStyle(nativeDateInput, ["opacity", "position"]),
        ownerCanvas: pickStyle(ownerCanvas, ["background-color", "font-family"]),
        ownerContent: pickStyle(ownerContent, ["padding-left", "padding-right"]),
        searchInput: pickStyle(searchInput, ["width"]),
        statusChip: pickStyle(statusChip, ["background-color", "border-radius", "display"]),
        statusRow: pickStyle(statusRow, ["display", "gap"]),
        tab: pickStyle(tab, ["border-bottom-color", "border-bottom-width", "color"]),
        tabBadge: pickStyle(tabBadge, ["background-color", "border-radius"]),
        tabs: pickStyle(tabs, ["border-bottom-color", "display", "gap", "height"]),
        toolbar: pickStyle(toolbar, ["display", "gap", "grid-template-columns"]),
        viewSelector: pickStyle(viewSelector, ["display", "height", "min-width"]),
      },
      dom: {
        bodyOverflowX: getComputedStyle(document.body).overflowX,
        currentUrl: window.location.href,
        datePickerText: datePicker?.textContent?.trim() ?? null,
        ownerCanvasFound: Boolean(ownerCanvas),
        readinessBannerFound: Boolean(readinessBanner),
        title: document.title,
        viewSelectorText: viewSelector?.textContent?.trim() ?? null,
      },
      rects: {
        board: rect(board),
        cta: rect(cta),
        datePicker: rect(datePicker),
        filterButton: rect(filterButton),
        kpiCard: rect(kpiCard),
        kpiIcons: kpiIcons.map(rect),
        kpiWrapper: rect(kpiWrapper),
        ownerCanvas: rect(ownerCanvas),
        ownerContent: rect(ownerContent),
        searchInput: rect(searchInput),
        statusChip: rect(statusChip),
        tabs: rect(tabs),
        toolbar: rect(toolbar),
        viewSelector: rect(viewSelector),
      },
      stylesheets: Array.from(document.styleSheets).map((sheet) => {
        try {
          return { href: sheet.href, rules: sheet.cssRules.length };
        } catch {
          return { href: sheet.href, rules: null };
        }
      }),
    };
  });
}

function evaluateOwnerAssertions(styleFacts) {
  const assertions = [];
  const computed = styleFacts.computed;
  const rects = styleFacts.rects;

  addAssertion(assertions, "owner root is present", styleFacts.dom.ownerCanvasFound);
  addAssertion(
    assertions,
    "owner root background is booking canvas",
    colorNear(computed.ownerCanvas?.["background-color"] ?? "", [247, 247, 248]),
    { actual: computed.ownerCanvas?.["background-color"] },
  );
  addAssertion(
    assertions,
    "owner root font family is Manrope",
    /Manrope/i.test(computed.ownerCanvas?.["font-family"] ?? ""),
    { actual: computed.ownerCanvas?.["font-family"] },
  );
  addAssertion(
    assertions,
    "owner content horizontal padding is designed",
    between(computed.ownerContent?.["padding-left"], 24, 31) &&
      between(computed.ownerContent?.["padding-right"], 24, 31),
    {
      left: computed.ownerContent?.["padding-left"],
      right: computed.ownerContent?.["padding-right"],
    },
  );
  addAssertion(
    assertions,
    "heading eyebrow is uppercase and tracked",
    computed.eyebrow?.["text-transform"] === "uppercase" &&
      numberValue(computed.eyebrow?.["letter-spacing"]) >= 1,
    computed.eyebrow ?? {},
  );
  addAssertion(
    assertions,
    "heading title has owner scale",
    between(computed.headingTitle?.["font-size"], 29, 34),
    { actual: computed.headingTitle?.["font-size"] },
  );
  addAssertion(
    assertions,
    "new appointment CTA is plum",
    colorNear(computed.cta?.["background-color"] ?? "", [100, 42, 86]),
    { actual: computed.cta?.["background-color"] },
  );
  addAssertion(
    assertions,
    "new appointment CTA text is white",
    colorNear(computed.cta?.color ?? "", [255, 255, 255]),
    { actual: computed.cta?.color },
  );
  addAssertion(
    assertions,
    "new appointment CTA has designed radius and height",
    between(computed.cta?.["border-radius"], 9, 11) && between(rects.cta?.height, 43, 46),
    { height: rects.cta?.height, radius: computed.cta?.["border-radius"] },
  );
  addAssertion(
    assertions,
    "appointments tab has no large readiness banner",
    !styleFacts.dom.readinessBannerFound,
    { readinessBannerFound: styleFacts.dom.readinessBannerFound },
  );
  addAssertion(
    assertions,
    "tabs are a flex underline row",
    computed.tabs?.display === "flex" &&
      between(computed.tabs?.gap, 24, 28) &&
      between(rects.tabs?.height, 42, 56),
    { height: rects.tabs?.height, ...computed.tabs },
  );
  addAssertion(
    assertions,
    "active tab has plum underline",
    numberValue(computed.tab?.["border-bottom-width"]) >= 2 &&
      colorNear(computed.tab?.["border-bottom-color"] ?? "", [100, 42, 86], 16),
    computed.tab ?? {},
  );
  addAssertion(
    assertions,
    "tab badge is a lilac pill",
    colorNear(computed.tabBadge?.["background-color"] ?? "", [239, 232, 243], 8) &&
      numberValue(computed.tabBadge?.["border-radius"]) >= 10,
    computed.tabBadge ?? {},
  );
  addAssertion(
    assertions,
    "KPI wrapper is desktop grid with four tracks",
    computed.kpiWrapper?.display === "grid" &&
      columnsCount(computed.kpiWrapper?.["grid-template-columns"]) === 4 &&
      between(computed.kpiWrapper?.gap, 10, 14),
    computed.kpiWrapper ?? {},
  );
  addAssertion(
    assertions,
    "KPI card is a white rounded surface",
    colorNear(computed.kpiCard?.["background-color"] ?? "", [255, 255, 255]) &&
      colorNear(computed.kpiCard?.["border-top-color"] ?? "", [231, 223, 229], 8) &&
      between(computed.kpiCard?.["border-radius"], 12, 15) &&
      between(rects.kpiCard?.height, 108, 116),
    { rect: rects.kpiCard, style: computed.kpiCard },
  );
  const iconFacts = computed.kpiIcons ?? [];
  const byTone = Object.fromEntries(iconFacts.map((item) => [item.tone, item.style]));
  addAssertion(
    assertions,
    "KPI icon tiles match draft tones",
    iconFacts.length === 4 &&
      colorNear(byTone.plum?.["background-color"] ?? "", [239, 232, 243], 8) &&
      colorNear(byTone.plum?.color ?? "", [100, 42, 86], 8) &&
      colorNear(byTone.green?.["background-color"] ?? "", [232, 246, 237], 8) &&
      colorNear(byTone.green?.color ?? "", [47, 138, 87], 8) &&
      colorNear(byTone.amber?.["background-color"] ?? "", [255, 242, 216], 8) &&
      colorNear(byTone.amber?.color ?? "", [215, 149, 25], 8) &&
      colorNear(byTone.revenue?.["background-color"] ?? "", [100, 42, 86], 8) &&
      colorNear(byTone.revenue?.color ?? "", [255, 255, 255], 8) &&
      iconFacts.every((item) => between(item.style?.["border-radius"], 9, 11)) &&
      rects.kpiIcons.every((item) => between(item?.height, 36, 42) && between(item?.width, 36, 42)),
    { iconFacts, iconRects: rects.kpiIcons },
  );
  addAssertion(
    assertions,
    "appointment board is a contained card",
    colorNear(computed.board?.["background-color"] ?? "", [255, 255, 255]) &&
      colorNear(computed.board?.["border-top-color"] ?? "", [231, 223, 229], 8) &&
      between(computed.board?.["border-radius"], 12, 15) &&
      computed.board?.overflow === "hidden",
    computed.board ?? {},
  );
  addAssertion(
    assertions,
    "toolbar is an organized layout",
    ["grid", "flex"].includes(computed.toolbar?.display) &&
      between(computed.toolbar?.gap, 10, 18) &&
      (rects.toolbar?.height ?? 0) >= 64,
    { rect: rects.toolbar, style: computed.toolbar },
  );
  addAssertion(
    assertions,
    "toolbar uses human date surface instead of native date primary",
    /[A-Za-z]+,\s+[A-Za-z]+\s+\d+/.test(styleFacts.dom.datePickerText ?? "") &&
      computed.nativeDateInput?.opacity === "0" &&
      computed.nativeDateInput?.position === "absolute" &&
      between(rects.datePicker?.height, 40, 46),
    {
      datePickerText: styleFacts.dom.datePickerText,
      nativeDateInput: computed.nativeDateInput,
      rect: rects.datePicker,
    },
  );
  addAssertion(
    assertions,
    "toolbar search and view selector are compact",
    between(rects.searchInput?.width, 220, 250) &&
      styleFacts.dom.viewSelectorText?.includes("List") &&
      between(rects.viewSelector?.height, 40, 46) &&
      between(rects.filterButton?.height, 40, 46),
    {
      filterButton: { rect: rects.filterButton, style: computed.filterButton },
      searchRect: rects.searchInput,
      viewSelectorText: styleFacts.dom.viewSelectorText,
      viewSelector: { rect: rects.viewSelector, style: computed.viewSelector },
    },
  );
  addAssertion(
    assertions,
    "status filters are separate pills",
    computed.statusRow?.display === "flex" &&
      between(computed.statusRow?.gap, 6, 10) &&
      ["flex", "inline-flex"].includes(computed.statusChip?.display) &&
      numberValue(computed.statusChip?.["border-radius"]) >= 16,
    { chipRect: rects.statusChip, chipStyle: computed.statusChip, rowStyle: computed.statusRow },
  );

  if (computed.emptyState) {
    addAssertion(
      assertions,
      "empty state is not dashed",
      computed.emptyState["border-top-style"] !== "dashed",
      computed.emptyState,
    );
  }

  return assertions;
}

const report = {
  baseUrl,
  consoleErrors: [],
  cssResponses: [],
  date,
  networkErrors: [],
  ok: false,
  pageErrors: [],
  salonId,
  screenshots: [],
  styleAssertions: [],
  styleFacts: null,
};

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

  if (
    !env.NEXT_PUBLIC_SUPABASE_URL ||
    !env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    !env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    throw new Error("Supabase owner visual environment is missing.");
  }

  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { organization, owner, salon } = await loadOwnerContext(admin);
  const session = await createOwnerSession(
    env,
    env.SUPABASE_SERVICE_ROLE_KEY,
    owner.email,
  );

  report.organizationId = organization.id;
  report.organizationName = organization.name;
  report.salonName = salon.name;

  browser = await launchBrowser();
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
      value: `manage:${salon.id}`,
    },
    {
      name: "kingpos-current-organization-id",
      sameSite: "Lax",
      url: baseUrl,
      value: organization.id,
    },
    {
      name: "kingpos-current-manage-salon-id",
      sameSite: "Lax",
      url: baseUrl,
      value: salon.id,
    },
    {
      name: "kingpos-current-salon-id",
      sameSite: "Lax",
      url: baseUrl,
      value: salon.id,
    },
  ]);

  const page = await context.newPage();
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

  await page.goto(`${baseUrl}/bookings?date=${date}&view=list`, {
    waitUntil: "networkidle",
  });
  await page.getByTestId("booking-owner-heading").waitFor({ timeout: 15000 });
  await page.screenshot({
    fullPage: true,
    path: path.join(artifactsDir, "gateA-owner-appointments-1610x941.png"),
  });
  report.screenshots.push("gateA-owner-appointments-1610x941.png");

  report.styleFacts = await collectComputedStyles(page);
  report.styleAssertions = evaluateOwnerAssertions(report.styleFacts);
  report.ok =
    report.consoleErrors.length === 0 &&
    report.pageErrors.length === 0 &&
    report.networkErrors.length === 0 &&
    report.cssResponses.every((response) => response.ok) &&
    report.styleAssertions.every((assertion) => assertion.passed);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  if (browser) {
    const page = browser.contexts().flatMap((context) => context.pages())[0];

    if (page) {
      const failurePath = path.join(artifactsDir, "gateA-owner-visual-failure.png");
      await page.screenshot({ fullPage: true, path: failurePath }).catch(() => {});
      report.screenshots.push("gateA-owner-visual-failure.png");
      report.failureUrl = page.url();
    }
  }
} finally {
  if (browser) {
    await browser.close();
  }

  await writeFile(
    path.join(artifactsDir, "gateA-owner-visual-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (!report.ok) {
    process.exitCode = 1;
  }
}

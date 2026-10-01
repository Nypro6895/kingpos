import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const artifactsDir = path.resolve("artifacts/customer-desktop-shell-qa");
const baseUrl = process.env.CUSTOMER_QA_BASE_URL ?? "http://127.0.0.1:3002";
const email = process.env.CUSTOMER_QA_EMAIL;
const password = process.env.CUSTOMER_QA_PASSWORD;
const storageState = process.env.CUSTOMER_QA_STORAGE_STATE;

const customerRoutes = [
  { activeLabel: "Explore", expectUtility: true, route: "/explore" },
  { activeLabel: "Bookings", expectUtility: false, route: "/my-bookings" },
  { activeLabel: "Beauty", expectUtility: false, route: "/beauty" },
  { activeLabel: "Notifications", expectUtility: false, route: "/notifications" },
  { activeLabel: "More", expectUtility: false, route: "/more" },
  { activeLabel: "More", expectUtility: false, route: "/more/reports" },
  { activeLabel: null, expectUtility: false, route: "/settings" },
];

const viewports = [
  { height: 900, label: "1280x900", width: 1280 },
  { height: 900, label: "1440x900", width: 1440 },
  { height: 1000, label: "1600x1000", width: 1600 },
  { height: 1080, label: "1920x1080", width: 1920 },
];

function absoluteUrl(href) {
  return new URL(href, baseUrl).toString();
}

function routeSlug(route) {
  return route.replace(/^\//, "").replaceAll("/", "-") || "home";
}

function isExpectedWorkspaceSwitchAbort(request, failure) {
  if (failure.errorText !== "net::ERR_ABORTED" || request.method() !== "POST") {
    return false;
  }

  const requestUrl = new URL(request.url());
  const appUrl = new URL(baseUrl);

  return requestUrl.origin === appUrl.origin && requestUrl.pathname === "/explore";
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

async function waitForServer() {
  let lastError;

  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      const response = await fetch(absoluteUrl("/explore"));

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

function recordPageSignals(page, report) {
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

    if (!failure || request.url().startsWith("data:")) {
      return;
    }

    if (
      failure.errorText === "net::ERR_ABORTED" &&
      request.url().includes("_rsc=")
    ) {
      return;
    }

    if (isExpectedWorkspaceSwitchAbort(request, failure)) {
      report.expectedRequestFailures.push({
        errorText: failure.errorText,
        method: request.method(),
        reason: "Next server action workspace switch navigated away from /explore.",
        url: request.url(),
      });
      return;
    }

    report.requestFailures.push({
      errorText: failure.errorText,
      method: request.method(),
      url: request.url(),
    });
  });

  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();

    if (status >= 400 && !url.startsWith("data:")) {
      report.httpErrors.push({ status, url });
    }
  });
}

async function createAuthenticatedContext(browser) {
  const contextOptions = { baseURL: baseUrl };

  if (storageState) {
    contextOptions.storageState = storageState;
  }

  const context = await browser.newContext(contextOptions);

  if (!storageState) {
    if (!email || !password) {
      throw new Error(
        "Set CUSTOMER_QA_EMAIL/CUSTOMER_QA_PASSWORD or CUSTOMER_QA_STORAGE_STATE for authenticated QA.",
      );
    }

    const response = await context.request.post("/api/auth/login", {
      multipart: {
        email,
        next: "/explore",
        password,
      },
    });

    if (!response.ok()) {
      throw new Error(`Login failed with HTTP ${response.status()}: ${await response.text()}`);
    }
  }

  await context.addCookies([
    {
      httpOnly: true,
      name: "kingpos-selected-workspace",
      sameSite: "Lax",
      secure: baseUrl.startsWith("https://"),
      url: baseUrl,
      value: "personal",
    },
  ]);

  return context;
}

async function isVisible(locator) {
  const count = await locator.count().catch(() => 0);

  if (count === 0) {
    return false;
  }

  return locator
    .first()
    .evaluate((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    })
    .catch(() => false);
}

async function assertNoHorizontalOverflow(page) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  if (overflow.scrollWidth > overflow.clientWidth + 2) {
    throw new Error(
      `Horizontal overflow: scrollWidth=${overflow.scrollWidth}, clientWidth=${overflow.clientWidth}`,
    );
  }
}

async function assertExploreCarouselsHideNativeScrollbars(page) {
  const offenders = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="customer-desktop-shell"]');
    const sections = ["top-rated-salons", "trending-designs"];

    return sections.flatMap((testId) => {
      const section = root?.querySelector(`[data-testid="${testId}"]`);

      if (!section) {
        return [`${testId}: missing section`];
      }

      const scrollers = Array.from(section.querySelectorAll(".no-scrollbar"));

      if (scrollers.length === 0) {
        return [`${testId}: missing no-scrollbar scroller`];
      }

      return scrollers.flatMap((scroller, index) => {
        const style = window.getComputedStyle(scroller);
        const hasHorizontalOverflow =
          scroller.scrollWidth > scroller.clientWidth + 2;

        if (!hasHorizontalOverflow) {
          return [];
        }

        return style.scrollbarWidth === "none" ||
          scroller.classList.contains("no-scrollbar")
          ? []
          : [`${testId}:${index}`];
      });
    });
  });

  if (offenders.length > 0) {
    throw new Error(
      `Explore carousel native scrollbar guard failed: ${offenders.join(", ")}`,
    );
  }
}

async function assertExploreUtilityDoesNotOverlapContent(page) {
  const layout = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="customer-desktop-shell"]');
    const main = shell?.querySelector('[data-testid="explore-main-column"]');
    const utility = shell?.querySelector('[data-testid="customer-desktop-utility"]');
    const sectionIds = [
      "explore-top-section",
      "top-rated-salons",
      "trending-designs",
      "popular-services",
      "recommended-for-you",
      "quick-actions",
    ];

    if (!main || !utility) {
      return null;
    }

    const mainRect = main.getBoundingClientRect();
    const utilityRect = utility.getBoundingClientRect();
    const sectionRects = sectionIds.map((testId) => {
      const element = main.querySelector(`[data-testid="${testId}"]`);
      const rect = element?.getBoundingClientRect();

      return rect
        ? {
            bottom: rect.bottom,
            right: rect.right,
            testId,
            top: rect.top,
          }
        : null;
    });
    const scrollerRects = Array.from(main.querySelectorAll(".no-scrollbar")).map(
      (element, index) => {
        const rect = element.getBoundingClientRect();

        return {
          bottom: rect.bottom,
          index,
          right: rect.right,
          top: rect.top,
        };
      },
    );

    return {
      mainRight: mainRect.right,
      scrollers: scrollerRects,
      sections: sectionRects,
      utilityLeft: utilityRect.left,
    };
  });

  if (!layout) {
    throw new Error("Could not measure Explore main/utility grid.");
  }

  if (layout.mainRight > layout.utilityLeft + 1) {
    throw new Error(
      `Explore main column overlaps utility: mainRight=${layout.mainRight}, utilityLeft=${layout.utilityLeft}`,
    );
  }

  const offenders = [
    ...layout.sections.filter(Boolean).filter(
      (rect) => rect.right > layout.utilityLeft + 1,
    ),
    ...layout.scrollers.filter((rect) => rect.right > layout.utilityLeft + 1),
  ];

  if (offenders.length > 0) {
    throw new Error(
      `Explore content extends into utility column: ${JSON.stringify(offenders)}`,
    );
  }
}

async function assertCustomerDesktopRouteLayout(page, expectUtility) {
  const layout = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="customer-desktop-shell"]');
    const content = document.querySelector(".customer-desktop-content");
    const utility = document.querySelector('[data-testid="customer-desktop-utility"]');

    if (!shell || !content) {
      return null;
    }

    const style = window.getComputedStyle(shell);
    const shellRect = shell.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const visibleUtility = utility
      ? (() => {
          const utilityStyle = window.getComputedStyle(utility);
          const utilityRect = utility.getBoundingClientRect();

          return (
            utilityStyle.display !== "none" &&
            utilityStyle.visibility !== "hidden" &&
            utilityRect.width > 0 &&
            utilityRect.height > 0
          );
        })()
      : false;

    return {
      contentRightGap: Math.round(shellRect.right - contentRect.right),
      shellGridColumns: style.gridTemplateColumns
        .trim()
        .split(/\s+/)
        .filter(Boolean).length,
      utilityInsideRouteContent: utility
        ? Boolean(utility.closest(".customer-desktop-content"))
        : false,
      visibleUtility,
    };
  });

  if (!layout) {
    throw new Error("Customer desktop shell/content layout could not be measured.");
  }

  if (layout.shellGridColumns !== 2) {
    throw new Error(
      `Customer desktop shell should have 2 grid columns, found ${layout.shellGridColumns}.`,
    );
  }

  if (Math.abs(layout.contentRightGap) > 3) {
    throw new Error(
      `Customer desktop content does not span shell width: right gap=${layout.contentRightGap}px.`,
    );
  }

  if (expectUtility && !layout.utilityInsideRouteContent) {
    throw new Error("Customer utility panel is not owned by route content.");
  }

  if (!expectUtility && layout.visibleUtility) {
    throw new Error("Customer utility panel is visible outside /explore.");
  }
}

async function assertCustomerUtility(page, expectUtility) {
  const utility = page.getByTestId("customer-desktop-utility");
  const utilityVisible = await isVisible(utility);

  if (!expectUtility) {
    if (utilityVisible) {
      throw new Error("Customer desktop utility should not be visible on this route.");
    }

    return;
  }

  if (!utilityVisible) {
    throw new Error("Customer desktop utility is not visible on /explore.");
  }

  for (const label of [
    "Upcoming Booking",
    "Recent Notifications",
    "Refer & Earn",
  ]) {
    if (!(await utility.getByText(label).first().isVisible())) {
      throw new Error(`Missing utility panel section: ${label}`);
    }
  }
}

async function assertExploreLanding(page, report) {
  const desktopShell = page.getByTestId("customer-desktop-shell");
  const topSection = desktopShell.getByTestId("explore-top-section");
  const hero = desktopShell.getByTestId("explore-hero");
  const topRated = desktopShell.getByTestId("top-rated-salons");
  const trending = desktopShell.getByTestId("trending-designs");
  const recommended = desktopShell.getByTestId("recommended-for-you");
  const popularServices = desktopShell.getByTestId("popular-services");
  const quickActions = desktopShell.getByTestId("quick-actions");
  const categoryNav = desktopShell.getByRole("navigation", {
    name: "Explore categories",
  });

  for (const [name, locator] of [
    ["Explore top section", topSection],
    ["Explore hero", hero],
    ["Top rated salons", topRated],
    ["Trending designs", trending],
    ["Recommended for you", recommended],
    ["Popular services", popularServices],
    ["Quick actions", quickActions],
    ["Explore categories", categoryNav],
  ]) {
    await locator.waitFor({ timeout: 10000 });

    if (!(await isVisible(locator))) {
      throw new Error(`${name} is not visible.`);
    }
  }

  if (await isVisible(desktopShell.getByTestId("explore-search-panel"))) {
    throw new Error("Desktop Explore still shows the removed search panel.");
  }

  await page
    .getByTestId("customer-desktop-header")
    .getByRole("button", { name: "Use current location" })
    .waitFor({ timeout: 5000 });

  await desktopShell.getByRole("heading", { exact: true, name: "Explore" }).waitFor({
    timeout: 5000,
  });
  await desktopShell
    .getByText("Discover top salons, trending designs, and book instantly.")
    .waitFor({ timeout: 5000 });
  await desktopShell.getByRole("heading", { name: "Explore by Service" }).waitFor({
    timeout: 5000,
  });

  for (const label of [
    "All",
    "Nails",
    "Hair",
    "Spa",
    "Lashes",
    "Brows",
    "Massage",
    "More",
  ]) {
    if (!(await categoryNav.getByRole("button", { name: label }).first().isVisible())) {
      throw new Error(`Explore category chip is missing: ${label}`);
    }
  }

  const boxes = await page.evaluate(() => {
    const rectFor = (testId) => {
    const root = document.querySelector('[data-testid="customer-desktop-shell"]');
    const element = root?.querySelector(`[data-testid="${testId}"]`);
      const rect = element?.getBoundingClientRect();
      return rect ? { height: rect.height, top: rect.top, width: rect.width } : null;
    };

    return {
      hero: rectFor("explore-hero"),
      quickActions: rectFor("quick-actions"),
      popularServices: rectFor("popular-services"),
      recommended: rectFor("recommended-for-you"),
      topRated: rectFor("top-rated-salons"),
      trending: rectFor("trending-designs"),
    };
  });

  if (!boxes.hero || boxes.hero.height < 260) {
    throw new Error(`Explore hero is too small: ${JSON.stringify(boxes.hero)}`);
  }

  if (!boxes.topRated || !boxes.trending || boxes.topRated.top >= boxes.trending.top) {
    throw new Error("Explore sections are not ordered top-rated before trending.");
  }

  if (
    !boxes.trending ||
    !boxes.popularServices ||
    boxes.trending.top >= boxes.popularServices.top
  ) {
    throw new Error("Explore sections are not ordered trending before Explore by Service.");
  }

  if (
    !boxes.recommended ||
    !boxes.popularServices ||
    boxes.popularServices.top >= boxes.recommended.top
  ) {
    throw new Error("Explore sections are not ordered Explore by Service before recommended.");
  }

  if (
    !boxes.recommended ||
    !boxes.quickActions ||
    boxes.recommended.top >= boxes.quickActions.top
  ) {
    throw new Error("Explore sections are not ordered recommended before quick actions.");
  }

  await assertExploreCarouselsHideNativeScrollbars(page);
  await assertExploreUtilityDoesNotOverlapContent(page);

  for (const locator of [topRated, trending]) {
    await locator.getByRole("button", { name: /^Previous/ }).waitFor({
      timeout: 5000,
    });
    await locator.getByRole("button", { name: /^Next/ }).waitFor({
      timeout: 5000,
    });
  }

  const exposedFixtureNames = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="customer-desktop-shell"]');
    const sections = ["top-rated-salons", "recommended-for-you"];

    return sections.flatMap((testId) => {
      const text = root?.querySelector(`[data-testid="${testId}"]`)?.textContent ?? "";

      return /\[E2E\]|\b20\d{10,}\b/i.test(text) ? [testId] : [];
    });
  });

  if (exposedFixtureNames.length > 0) {
    throw new Error(
      `Explore exposes technical fixture names in ${exposedFixtureNames.join(", ")}.`,
    );
  }

  report.checks.exploreUtilityNoOverlap = true;
  report.checks.exploreDiscoveryOrder = true;
  report.checks.exploreCarouselArrowsAndScrollbars = true;
  report.checks.exploreFixtureNamesHidden = true;

  if (!(await isVisible(desktopShell.getByTestId("upcoming-booking-card")))) {
    throw new Error("Upcoming booking card is not visible.");
  }

  if (!(await isVisible(desktopShell.getByTestId("recent-notifications-card")))) {
    throw new Error("Recent notifications card is not visible.");
  }

  report.checks.exploreLandingSections = true;
}

async function assertDesktopShell(page, activeLabel, report, options = {}) {
  const { expectUtility = false, route = new URL(page.url()).pathname } = options;
  const shell = page.getByTestId("customer-desktop-shell");
  const sidebar = page.getByTestId("customer-desktop-sidebar");
  const header = page.getByTestId("customer-desktop-header");

  await shell.waitFor({ timeout: 15000 });

  if (!(await isVisible(shell))) {
    throw new Error("Customer desktop shell is not visible.");
  }

  for (const [name, locator] of [
    ["sidebar", sidebar],
    ["header", header],
  ]) {
    if (!(await isVisible(locator))) {
      throw new Error(`Customer desktop ${name} is not visible.`);
    }
  }

  await header.getByRole("searchbox").waitFor({ timeout: 5000 });
  await header.getByRole("link", { name: "Notifications" }).waitFor({
    timeout: 5000,
  });
  await header.getByRole("link", { name: "Messages" }).waitFor({
    timeout: 5000,
  });
  await header.getByRole("link", { name: "Account settings" }).waitFor({
    timeout: 5000,
  });

  const desktopNav = page.getByRole("navigation", {
    name: "Customer desktop",
  });
  await desktopNav.waitFor({ timeout: 5000 });
  await sidebar.getByRole("link", { name: "Reylumi Explore" }).waitFor({
    timeout: 5000,
  });

  if (activeLabel) {
    const active = desktopNav.getByRole("link", { name: activeLabel });
    await active.waitFor({ timeout: 5000 });

    if ((await active.getAttribute("aria-current")) !== "page") {
      throw new Error(`${activeLabel} desktop nav item is not active.`);
    }
  }

  const navText = await desktopNav.innerText();
  const expectedNavItems = ["Explore", "Bookings", "Beauty", "Notifications", "More"];

  for (const label of expectedNavItems) {
    if (!navText.includes(label)) {
      throw new Error(`Missing customer nav item: ${label}`);
    }
  }

  const forbiddenSidebarTerms = [
    "Operations",
    "POS",
    "Today",
    "Customers",
    "Staff",
    "Services",
    "Payroll",
    "Reports",
    "Salon Settings",
    "Finance",
    "Tax",
    "Daily Log",
    "Owner",
  ];
  const sidebarText = await sidebar.innerText();

  for (const term of forbiddenSidebarTerms) {
    if (new RegExp(`\\b${term}\\b`, "i").test(sidebarText)) {
      throw new Error(`Customer desktop sidebar leaked owner/staff term: ${term}`);
    }
  }

  for (const collapsedOnlyTerm of ["Switch Account", "Create salon", "Settings", "Log out"]) {
    if (new RegExp(`\\b${collapsedOnlyTerm}\\b`, "i").test(sidebarText)) {
      throw new Error(
        `Collapsed customer sidebar unexpectedly shows: ${collapsedOnlyTerm}`,
      );
    }
  }

  const accountTrigger = shell.getByTestId("customer-desktop-account-trigger");
  await accountTrigger.waitFor({ timeout: 5000 });

  if ((await accountTrigger.getAttribute("aria-expanded")) !== "false") {
    throw new Error("Desktop account menu is not collapsed by default.");
  }

  if ((await shell.getByTestId("customer-desktop-account-menu").count()) !== 0) {
    throw new Error("Desktop account menu panel is mounted while collapsed.");
  }

  await assertCustomerUtility(page, expectUtility);
  await assertCustomerDesktopRouteLayout(page, expectUtility);

  if (route === "/explore" && expectUtility) {
    await assertExploreLanding(page, report);
  }

  const bottomNavVisible = await isVisible(
    page.locator('nav[aria-label="Customer"]').first(),
  );

  if (bottomNavVisible) {
    throw new Error("Mobile customer bottom nav is visible on desktop.");
  }

  const oldPersonalRailVisible = await isVisible(
    page.getByRole("navigation", { name: "Personal app" }).first(),
  );

  if (oldPersonalRailVisible) {
    throw new Error("Legacy personal app rail is visible on desktop customer shell.");
  }

  await shell.locator("main").first().waitFor({ timeout: 5000 });
  await assertNoHorizontalOverflow(page);
  report.checks[`${page.viewportSize().width}:${route}`] = true;
}

async function assertHeaderGlobalExploreSearch(page, report) {
  const terms = ["King Nails", "Pedicure", "Milwaukee", "53214", "Nail Art"];

  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/explore", { waitUntil: "domcontentloaded" });
  await assertDesktopShell(page, "Explore", report, {
    expectUtility: true,
    route: "/explore",
  });

  for (const term of terms) {
    const header = page.getByTestId("customer-desktop-header");
    const searchbox = header.getByRole("searchbox");

    await searchbox.fill(term);
    await Promise.all([
      page.waitForURL(
        (url) =>
          url.pathname === "/explore" && url.searchParams.get("q") === term,
        { timeout: 20000 },
      ),
      searchbox.press("Enter"),
    ]);
    await page.waitForLoadState("domcontentloaded").catch(() => null);

    if (new URL(page.url()).pathname === "/login") {
      throw new Error(`Header search reached login for ${term}.`);
    }

    await assertDesktopShell(page, "Explore", report, {
      expectUtility: true,
      route: `/explore?q=${encodeURIComponent(term)}`,
    });

    const desktopShell = page.getByTestId("customer-desktop-shell");

    if (await isVisible(desktopShell.getByTestId("explore-search-panel"))) {
      throw new Error(`Search panel reappeared after searching ${term}.`);
    }
  }

  report.checks.headerGlobalExploreSearch = terms;
}

async function screenshotExploreCloseups(page, report) {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/explore", { waitUntil: "domcontentloaded" });
  await assertDesktopShell(page, "Explore", report, {
    expectUtility: true,
    route: "/explore",
  });

  const closeups = [
    ["sidebar", page.getByTestId("customer-desktop-sidebar")],
    ["header", page.getByTestId("customer-desktop-header")],
    ["top", page.getByTestId("customer-desktop-shell").getByTestId("explore-top-section")],
    ["hero", page.getByTestId("customer-desktop-shell").getByTestId("explore-hero")],
    ["top-rated", page.getByTestId("customer-desktop-shell").getByTestId("top-rated-salons")],
    ["trending", page.getByTestId("customer-desktop-shell").getByTestId("trending-designs")],
    ["popular-services", page.getByTestId("customer-desktop-shell").getByTestId("popular-services")],
    ["recommended", page.getByTestId("customer-desktop-shell").getByTestId("recommended-for-you")],
    ["quick-actions", page.getByTestId("customer-desktop-shell").getByTestId("quick-actions")],
    ["upcoming-booking", page.getByTestId("customer-desktop-shell").getByTestId("upcoming-booking-card")],
    ["recent-notifications", page.getByTestId("customer-desktop-shell").getByTestId("recent-notifications-card")],
  ];

  for (const [name, locator] of closeups) {
    await locator.waitFor({ timeout: 10000 });
    const screenshotPath = path.join(
      artifactsDir,
      `1440x900-explore-${name}-closeup.png`,
    );
    await locator.screenshot({ path: screenshotPath });
    report.screenshots[`1440x900:explore-${name}-closeup`] = screenshotPath;
  }

  const utility = page.getByTestId("customer-desktop-utility");
  const utilityBox = await utility.boundingBox();
  const headerBox = await page.getByTestId("customer-desktop-header").boundingBox();

  if (!utilityBox || !headerBox) {
    throw new Error("Could not capture Explore utility close-up bounds.");
  }

  const cropTop = Math.max(utilityBox.y, headerBox.y + headerBox.height);
  const utilityPath = path.join(
    artifactsDir,
    "1440x900-explore-utility-closeup.png",
  );
  await page.screenshot({
    path: utilityPath,
    clip: {
      x: utilityBox.x,
      y: cropTop,
      width: utilityBox.width,
      height: Math.max(1, utilityBox.y + utilityBox.height - cropTop),
    },
  });
  report.screenshots["1440x900:explore-utility-closeup"] = utilityPath;

  report.checks.exploreDesktopCloseups = true;
}

async function waitForAccountMenuState(page, isOpen) {
  await page.waitForFunction(
    ([selector, expectedOpen]) => {
      const menu = document.querySelector(selector);

      return expectedOpen ? Boolean(menu) : !menu;
    },
    ['[data-testid="customer-desktop-account-menu"]', isOpen],
  );
}

async function waitForAccountTriggerFocus(page) {
  await page.waitForFunction(
    () =>
      document.activeElement?.getAttribute("data-testid") ===
      "customer-desktop-account-trigger",
    undefined,
    { timeout: 2000 },
  );
}

async function assertAccountMenuInteraction(page, report) {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/explore", { waitUntil: "domcontentloaded" });
  await assertDesktopShell(page, "Explore", report, {
    expectUtility: true,
    route: "/explore",
  });

  const collapsedPath = path.join(
    artifactsDir,
    "1440x900-account-collapsed.png",
  );
  await page.screenshot({ fullPage: true, path: collapsedPath });
  report.screenshots["1440x900:account-collapsed"] = collapsedPath;

  const desktopShell = page.getByTestId("customer-desktop-shell");
  const trigger = desktopShell.getByTestId("customer-desktop-account-trigger");
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click({ force: true });
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '[data-testid="customer-desktop-shell"] [data-testid="customer-desktop-account-trigger"]',
        )
        ?.getAttribute("aria-expanded") === "true",
    undefined,
    { timeout: 5000 },
  );

  const menu = desktopShell.getByTestId("customer-desktop-account-menu");
  await menu.waitFor({ timeout: 5000 });

  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    throw new Error("Account trigger aria-expanded did not update when opened.");
  }

  const workspaceRows = await menu.getByRole("button", { name: /Switch to/ }).count();

  if (workspaceRows < 2) {
    throw new Error(`Expected multiple workspace rows, found ${workspaceRows}.`);
  }

  for (const label of ["Create salon", "Settings", "Log out"]) {
    if (!(await menu.getByText(label).first().isVisible())) {
      throw new Error(`Expanded account menu missing ${label}.`);
    }
  }

  const expandedPath = path.join(
    artifactsDir,
    "1440x900-account-expanded.png",
  );
  await page.screenshot({ fullPage: true, path: expandedPath });
  report.screenshots["1440x900:account-expanded"] = expandedPath;

  await page.keyboard.press("Escape");
  await waitForAccountMenuState(page, false);
  await waitForAccountTriggerFocus(page);

  if ((await trigger.getAttribute("aria-expanded")) !== "false") {
    throw new Error("Account trigger aria-expanded did not reset after Escape.");
  }

  const focusedAfterEscape = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-testid"),
  );

  if (focusedAfterEscape !== "customer-desktop-account-trigger") {
    throw new Error(`Focus did not return after Escape: ${focusedAfterEscape}`);
  }

  await trigger.click();
  await menu.waitFor({ timeout: 5000 });
  await page.getByTestId("customer-desktop-header").click({ position: { x: 8, y: 8 } });
  await waitForAccountMenuState(page, false);
  await waitForAccountTriggerFocus(page);

  const focusedAfterOutside = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-testid"),
  );

  if (focusedAfterOutside !== "customer-desktop-account-trigger") {
    throw new Error(
      `Focus did not return after outside click: ${focusedAfterOutside}`,
    );
  }

  report.checks.accountMenuCollapsedByDefault = true;
  report.checks.accountMenuExpanded = true;
  report.checks.accountMenuEscapeCloses = true;
  report.checks.accountMenuOutsideClickCloses = true;
  report.checks.accountMenuFocusRestored = true;
}

async function assertOwnerDesktopRegression(page, report) {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/explore", { waitUntil: "domcontentloaded" });

  const desktopShell = page.getByTestId("customer-desktop-shell");
  const trigger = desktopShell.getByTestId("customer-desktop-account-trigger");
  await trigger.click();

  const menu = desktopShell.getByTestId("customer-desktop-account-menu");
  await menu.waitFor({ timeout: 5000 });

  const target = menu.getByRole("button", {
    name: /Switch to Codex Customer Mobile QA Organization/,
  });

  if ((await target.count()) === 0) {
    report.checks.ownerDesktopRegression =
      "skipped: no organization workspace in QA account";
    return;
  }

  const navigation = page
    .waitForURL((url) => new URL(url).pathname === "/organizations", {
      timeout: 20000,
    })
    .catch(() => null);

  await target.first().click();
  await navigation;
  await page.waitForLoadState("domcontentloaded").catch(() => null);

  if (await isVisible(page.getByTestId("customer-desktop-shell"))) {
    throw new Error("Customer desktop shell is visible in organization context.");
  }

  await page.getByRole("navigation", { name: "Workspace" }).waitFor({
    timeout: 10000,
  });

  const ownerPath = path.join(
    artifactsDir,
    "1440x900-owner-desktop-regression.png",
  );
  await page.screenshot({ fullPage: true, path: ownerPath });
  report.screenshots["1440x900:owner-desktop-regression"] = ownerPath;
  report.checks.ownerDesktopRegression = true;
}

async function discoverSalonProfileRoute(page, report) {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/explore", { waitUntil: "domcontentloaded" });
  await assertDesktopShell(page, "Explore", report, {
    expectUtility: true,
    route: "/explore",
  });

  const href = await page
    .locator('.customer-desktop-content a[href^="/explore/salons/"]')
    .first()
    .getAttribute("href", { timeout: 10000 });

  if (!href) {
    throw new Error("Could not find an Explore salon profile link for nested route QA.");
  }

  return new URL(href, baseUrl).pathname;
}

async function assertExploreProfileNavigation(page, salonProfileRoute, report) {
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/explore", { waitUntil: "domcontentloaded" });
  await assertDesktopShell(page, "Explore", report, {
    expectUtility: true,
    route: "/explore",
  });

  await page
    .locator('.customer-desktop-content a[href^="/explore/salons/"]')
    .first()
    .click();
  await page.waitForURL(
    (url) => new URL(url).pathname.startsWith("/explore/salons/"),
    { timeout: 15000 },
  );
  await page.waitForLoadState("domcontentloaded").catch(() => null);
  await assertDesktopShell(page, "Explore", report, {
    expectUtility: false,
    route: salonProfileRoute,
  });

  await page.goBack({ waitUntil: "domcontentloaded" });
  await assertDesktopShell(page, "Explore", report, {
    expectUtility: true,
    route: "/explore",
  });

  report.checks.exploreUtilityRestoresAfterBack = true;
}

async function run() {
  await mkdir(artifactsDir, { recursive: true });
  await waitForServer();

  const report = {
      baseUrl,
      checks: {},
      consoleErrors: [],
      expectedRequestFailures: [],
      httpErrors: [],
      pageErrors: [],
    requestFailures: [],
    screenshots: {},
    viewports: viewports.map((viewport) => viewport.label),
  };

  let browser;

  try {
    browser = await launchBrowser();
    const context = await createAuthenticatedContext(browser);
    const page = await context.newPage();

    recordPageSignals(page, report);
    const salonProfileRoute = await discoverSalonProfileRoute(page, report);
    const routesToCheck = [
      ...customerRoutes,
      {
        activeLabel: "Explore",
        expectUtility: false,
        route: salonProfileRoute,
      },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({
        height: viewport.height,
        width: viewport.width,
      });

      for (const { activeLabel, expectUtility, route } of routesToCheck) {
        await page.goto(route, { waitUntil: "domcontentloaded" });

        if (new URL(page.url()).pathname === "/login") {
          throw new Error(`Authenticated QA reached login for ${route}.`);
        }

        await assertDesktopShell(page, activeLabel, report, {
          expectUtility,
          route,
        });

        const screenshotPath = path.join(
          artifactsDir,
          `${viewport.label}-${routeSlug(route)}.png`,
        );
        await page.screenshot({ path: screenshotPath });
        report.screenshots[`${viewport.label}:${route}`] = screenshotPath;
      }
    }

    await assertHeaderGlobalExploreSearch(page, report);
    await screenshotExploreCloseups(page, report);
    await assertExploreProfileNavigation(page, salonProfileRoute, report);
    await assertAccountMenuInteraction(page, report);
    await assertOwnerDesktopRegression(page, report);

    if (
      report.consoleErrors.length ||
      report.pageErrors.length ||
      report.requestFailures.length ||
      report.httpErrors.some(({ status }) => status >= 500)
    ) {
      throw new Error("Desktop browser QA captured console/page/network errors.");
    }

    await writeFile(
      path.join(artifactsDir, "browser-qa-report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await browser.close();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    const failure = {
      error: error instanceof Error ? error.message : String(error),
      report,
    };

    await writeFile(
      path.join(artifactsDir, "browser-qa-error.json"),
      `${JSON.stringify(failure, null, 2)}\n`,
    );

    if (browser) {
      await browser.close();
    }

    throw error;
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});

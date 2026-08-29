import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const artifactsDir = path.resolve("artifacts/customer-mobile-ui-qa");
const baseUrl = process.env.CUSTOMER_QA_BASE_URL ?? "http://localhost:3000";
const email = process.env.CUSTOMER_QA_EMAIL;
const password = process.env.CUSTOMER_QA_PASSWORD;
const storageState = process.env.CUSTOMER_QA_STORAGE_STATE;
const nonCustomerPath = process.env.CUSTOMER_QA_NON_CUSTOMER_PATH;

const customerRoutes = [
  ["/explore", "Explore"],
  ["/my-bookings", "Bookings"],
  ["/beauty", "Beauty"],
  ["/notifications", "Notifications"],
  ["/more", "More"],
  ["/more/saved-designs", "More"],
  ["/more/following", "More"],
  ["/more/memberships", "More"],
  ["/more/reviews", "More"],
  ["/more/gift-cards", "More"],
  ["/more/reports", "More"],
];

const viewports = [
  { height: 568, label: "320x568", width: 320 },
  { height: 667, label: "375x667", width: 375 },
  { height: 844, label: "390x844", width: 390 },
  { height: 932, label: "430x932", width: 430 },
  { height: 1024, label: "768x1024", width: 768 },
  { height: 900, label: "1440x900", width: 1440 },
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

function configurePage(page, report) {
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(20000);
  recordPageSignals(page, report);
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

async function assertBottomNav(page, activeLabel) {
  const nav = page.getByRole("navigation", { name: "Customer" });
  await nav.waitFor({ timeout: 15000 });
  const links = nav.getByRole("link");
  const labels = [];

  for (let index = 0; index < await links.count(); index += 1) {
    labels.push((await links.nth(index).innerText()).trim());
  }

  const expected = ["Explore", "Bookings", "Beauty", "Notifications", "More"];

  if (labels.join("|") !== expected.join("|")) {
    throw new Error(`Unexpected bottom nav labels: ${labels.join(", ")}`);
  }

  const active = nav.getByRole("link", { name: activeLabel });
  await active.waitFor({ timeout: 5000 });

  if ((await active.getAttribute("aria-current")) !== "page") {
    throw new Error(`${activeLabel} is not active.`);
  }

  const boxes = await links.evaluateAll((items) =>
    items.map((item) => {
      const rect = item.getBoundingClientRect();
      return { height: rect.height, width: rect.width };
    }),
  );

  for (const box of boxes) {
    if (box.height < 44 || box.width < 44) {
      throw new Error(`Bottom nav touch target too small: ${JSON.stringify(box)}`);
    }
  }
}

async function assertContentClearOfBottomNav(page) {
  const result = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Customer"]');
    const main = document.querySelector("main");

    if (!nav || !main) {
      return { ok: true };
    }

    window.scrollTo(0, document.documentElement.scrollHeight);
    const navTop = nav.getBoundingClientRect().top;
    const focusable = [...main.querySelectorAll("a, button")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
    const last = focusable.at(-1);

    if (!last) {
      return { ok: true };
    }

    const rect = last.getBoundingClientRect();

    return {
      bottom: rect.bottom,
      ok: rect.bottom <= navTop + 1,
      text: last.textContent?.trim() ?? "",
      navTop,
    };
  });

  if (!result.ok) {
    throw new Error(`Content overlaps bottom nav: ${JSON.stringify(result)}`);
  }
}

async function assertCustomerShell(page, activeLabel) {
  await page.getByRole("button", { name: "Open account switcher" }).waitFor({
    timeout: 15000,
  });
  await page.getByRole("link", { name: "Reylumi Explore" }).waitFor({
    timeout: 15000,
  });
  await assertBottomNav(page, activeLabel);
  await assertNoHorizontalOverflow(page);
  await assertContentClearOfBottomNav(page);
}

async function assertDesktopCustomerRoute(page) {
  const bottomNavVisible = await isVisible(
    page.locator('nav[aria-label="Customer"]').first(),
  );

  if (bottomNavVisible) {
    throw new Error("Customer bottom nav is visible on desktop.");
  }

  await page.getByTestId("customer-desktop-shell").waitFor({
    timeout: 15000,
  });
  await page.getByTestId("customer-desktop-sidebar").waitFor({ timeout: 5000 });
  await page.getByTestId("customer-desktop-header").waitFor({ timeout: 5000 });
  await assertNoHorizontalOverflow(page);
}

async function assertContextDrawer(page, report) {
  const trigger = page.getByRole("button", { name: "Open account switcher" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Switch account" });
  await dialog.waitFor({ timeout: 10000 });
  await dialog.getByText("Personal account").first().waitFor({ timeout: 5000 });
  report.checks.contextDrawerOpened = true;
  report.checks.contextWorkspaceRows = await dialog
    .getByRole("button", { name: /Switch to/ })
    .count();

  if (await dialog.getByText("Create salon").count() === 0) {
    throw new Error("Create salon entry not found.");
  }

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 10000 });
  report.checks.escapeClosesDrawer = true;

  const focusedLabel = await page.evaluate(() =>
    document.activeElement?.getAttribute("aria-label"),
  );

  if (focusedLabel !== "Open account switcher") {
    throw new Error(`Focus did not return to trigger: ${focusedLabel}`);
  }

  report.checks.focusReturnedToTrigger = true;
}

async function assertNonCustomerSwitchFromDrawer(page, report) {
  if (new URL(page.url()).pathname !== "/explore") {
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
  }
  const trigger = page.getByRole("button", { name: "Open account switcher" });
  await trigger.waitFor({ timeout: 15000 });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Switch account" });
  await dialog.waitFor({ timeout: 10000 });
  const target = dialog.getByRole("button", {
    name: /Switch to Codex Customer Mobile QA Organization/,
  });

  if ((await target.count()) === 0) {
    report.checks.nonCustomerContext =
      "skipped: no QA organization workspace in drawer";
    await page.keyboard.press("Escape");
    return;
  }

  const switchNavigation = page
    .waitForURL(
      (url) => new URL(url).pathname !== "/explore",
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);

  await target.first().click();
  const didNavigate = await switchNavigation;

  if (!didNavigate && new URL(page.url()).pathname === "/explore") {
    throw new Error("Workspace switch did not navigate away from /explore.");
  }

  await page
    .getByRole("navigation", { name: "Workspace" })
    .waitFor({ timeout: 15000 })
    .catch(() => null);
  report.checks.nonCustomerSwitchUrl = page.url();

  const customerNavCount = await page
    .getByRole("navigation", { name: "Customer" })
    .count();
  report.checks.nonCustomerBottomNavCount = customerNavCount;
  report.checks.nonCustomerDialogText = await dialog
    .textContent()
    .catch(() => null);
  report.checks.nonCustomerHeaderText = await page
    .locator("header")
    .first()
    .textContent()
    .catch(() => null);

  if (customerNavCount !== 0) {
    throw new Error(
      `Customer bottom nav rendered after switching to organization context at ${page.url()}.`,
    );
  }
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
    let page = await context.newPage();
    configurePage(page, report);

    for (const viewport of viewports) {
      await page.setViewportSize({ height: viewport.height, width: viewport.width });

      for (const [route, activeLabel] of customerRoutes) {
        await page.goto(route, { waitUntil: "networkidle" });

        if (new URL(page.url()).pathname === "/login") {
          throw new Error(`Authenticated QA reached login for ${route}.`);
        }

        if (viewport.width < 1024) {
          await assertCustomerShell(page, activeLabel);
        } else {
          await assertDesktopCustomerRoute(page);
        }

        const screenshotPath = path.join(
          artifactsDir,
          `${viewport.label}-${routeSlug(route)}.png`,
        );
        await page.screenshot({ fullPage: true, path: screenshotPath });
        report.screenshots[`${viewport.label}:${route}`] = screenshotPath;
      }
    }

    page = await context.newPage();
    configurePage(page, report);
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "Open account switcher" })
      .waitFor({ timeout: 15000 });
    await assertContextDrawer(page, report);
    await assertNonCustomerSwitchFromDrawer(page, report);

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

    page = await context.newPage();
    configurePage(page, report);
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/explore", { waitUntil: "domcontentloaded" });
    await assertDesktopCustomerRoute(page);
    report.checks.desktopNoCustomerBottomNav = true;

    if (nonCustomerPath) {
      await page.goto(nonCustomerPath, { waitUntil: "networkidle" });
      if (new URL(page.url()).pathname !== "/login") {
        const customerNavCount = await page
          .getByRole("navigation", { name: "Customer" })
          .count();
        report.checks.nonCustomerBottomNavCount = customerNavCount;

        if (customerNavCount !== 0) {
          throw new Error("Customer bottom nav rendered in non-customer context.");
        }
      }
    } else if (!report.checks.nonCustomerContext) {
      report.checks.nonCustomerContext = "skipped: CUSTOMER_QA_NON_CUSTOMER_PATH not set";
    }

    if (
      report.consoleErrors.length ||
      report.pageErrors.length ||
      report.requestFailures.length ||
      report.httpErrors.some(({ status }) => status >= 500)
    ) {
      throw new Error("Browser QA captured console/page/network errors.");
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
  console.error(error);
  process.exit(1);
});

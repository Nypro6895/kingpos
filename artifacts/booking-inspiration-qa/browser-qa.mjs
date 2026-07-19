import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const artifactsDir = path.resolve("artifacts/booking-inspiration-qa");
const baseUrl = process.env.BOOKING_INSPIRATION_QA_BASE_URL ?? "http://127.0.0.1:3000";

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

  page.on("pageerror", (error) => {
    report.pageErrors.push(error.message);
  });

  page.on("requestfailed", (request) => {
    const failure = request.failure();
    const url = request.url();

    if (failure && !url.startsWith("data:")) {
      report.requestFailures.push({
        errorText: failure.errorText,
        url,
      });
    }
  });
}

async function waitForServer() {
  let lastError;

  for (let attempt = 0; attempt < 30; attempt += 1) {
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

async function run() {
  await mkdir(artifactsDir, { recursive: true });
  await waitForServer();

  const report = {
    baseUrl,
    bookingHref: null,
    checks: {},
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    screenshots: {},
  };
  const browser = await launchBrowser();

  try {
    const desktop = await browser.newPage({ viewport: { height: 900, width: 1440 } });
    recordPageErrors(desktop, report);

    await desktop.goto(`${baseUrl}/explore`, { waitUntil: "networkidle" });
    const cards = desktop.locator('[data-inspiration-card="true"]');
    await cards.first().waitFor({ timeout: 30000 });
    const cardCount = await cards.count();
    let href = null;

    for (let index = 0; index < Math.min(cardCount, 18); index += 1) {
      await cards.nth(index).click();
      const bookLink = desktop.getByRole("link", { name: "Book this look" }).first();

      try {
        await bookLink.waitFor({ timeout: 2500 });
        href = await bookLink.getAttribute("href");
      } catch {
        href = null;
      }

      if (href) {
        break;
      }

      await desktop.keyboard.press("Escape");
      await desktop.waitForTimeout(250);
    }

    if (!href || !href.includes("inspiration=")) {
      throw new Error("Explore Book this look href did not include inspiration.");
    }

    report.bookingHref = href;
    report.checks.exploreBookLink = true;
    const exploreScreenshot = path.join(artifactsDir, "explore-book-this-look-desktop.png");
    await desktop.screenshot({ fullPage: true, path: exploreScreenshot });
    report.screenshots.exploreDesktop = exploreScreenshot;

    await desktop.goto(new URL(href, baseUrl).toString(), { waitUntil: "networkidle" });
    await desktop.locator('[data-testid="booking-inspiration-card"]').first().waitFor({
      timeout: 30000,
    });
    await desktop.getByRole("heading", { name: "Find a time" }).waitFor({
      timeout: 30000,
    });

    const desktopCardText = await desktop
      .locator('[data-testid="booking-inspiration-card"]')
      .first()
      .innerText();
    const normalizedDesktopCardText = desktopCardText.toLowerCase();
    report.checks.bookingCardDesktop =
      normalizedDesktopCardText.includes("book this look") &&
      !normalizedDesktopCardText.includes("currently unavailable");
    report.checks.initialStepDateTimeDesktop = true;

    if (!report.checks.bookingCardDesktop) {
      throw new Error("Desktop booking inspiration card missing expected content.");
    }

    const bookingDesktop = path.join(artifactsDir, "public-booking-inspiration-desktop.png");
    await desktop.screenshot({ fullPage: true, path: bookingDesktop });
    report.screenshots.bookingDesktop = bookingDesktop;
    await desktop.close();

    const mobile = await browser.newPage({ viewport: { height: 844, width: 390 } });
    recordPageErrors(mobile, report);
    await mobile.goto(new URL(href, baseUrl).toString(), { waitUntil: "networkidle" });
    await mobile.locator('[data-testid="booking-inspiration-card"]').first().waitFor({
      timeout: 30000,
    });
    await mobile.getByRole("heading", { name: "Find a time" }).waitFor({
      timeout: 30000,
    });

    const mobileCardBox = await mobile
      .locator('[data-testid="booking-inspiration-card"]')
      .first()
      .boundingBox();
    report.checks.mobileCardVisible = Boolean(
      mobileCardBox &&
        mobileCardBox.width > 250 &&
        mobileCardBox.height >= 72 &&
        mobileCardBox.x >= 0,
    );

    if (!report.checks.mobileCardVisible) {
      throw new Error("Mobile booking inspiration card was not visibly framed.");
    }

    const bookingMobile = path.join(artifactsDir, "public-booking-inspiration-mobile.png");
    await mobile.screenshot({ fullPage: true, path: bookingMobile });
    report.screenshots.bookingMobile = bookingMobile;
    await mobile.close();
  } finally {
    await browser.close();
  }

  await writeFile(
    path.join(artifactsDir, "browser-qa-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (
    report.consoleErrors.length > 0 ||
    report.pageErrors.length > 0 ||
    report.requestFailures.some(
      (failure) =>
        !failure.url.includes("favicon") &&
        failure.errorText !== "net::ERR_ABORTED",
    )
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

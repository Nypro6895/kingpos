import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.PARITY_BASE_URL ?? "http://127.0.0.1:3000";
const salonId = "7f599bc8-a806-4a68-be86-c149c21709e2";
const artifactsDir = path.resolve("artifacts/booking-browser-test");

async function launchBrowser() {
  const launchers = [
    () => chromium.launch({ channel: "chrome", headless: true }),
    () => chromium.launch({ channel: "msedge", headless: true }),
    () => chromium.launch({ headless: true }),
  ];

  let lastError;

  for (const launch of launchers) {
    try {
      return await launch();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function capture(page, name, url, width, height) {
  await page.setViewportSize({ height, width });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({
    fullPage: true,
    path: path.join(artifactsDir, name),
  });

  return {
    name,
    title: await page.title(),
    url: page.url(),
  };
}

await mkdir(artifactsDir, { recursive: true });

const report = {
  baseUrl,
  consoleErrors: [],
  networkErrors: [],
  pageErrors: [],
  screenshots: [],
};

const browser = await launchBrowser();

try {
  const context = await browser.newContext({
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();

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

    report.networkErrors.push({
      errorText: failure?.errorText ?? "unknown",
      url: request.url(),
    });
  });

  report.screenshots.push(
    await capture(
      page,
      "parity-public-services-desktop.png",
      `${baseUrl}/book/${salonId}`,
      1652,
      891,
    ),
  );
  report.screenshots.push(
    await capture(
      page,
      "parity-public-services-mobile.png",
      `${baseUrl}/book/${salonId}`,
      390,
      844,
    ),
  );
  report.screenshots.push(
    await capture(
      page,
      "parity-owner-unauth-check.png",
      `${baseUrl}/bookings`,
      1610,
      941,
    ),
  );
} finally {
  await browser.close();
}

await writeFile(
  path.join(artifactsDir, "parity-visual-smoke-report.json"),
  JSON.stringify(report, null, 2),
);

if (report.pageErrors.length > 0) {
  throw new Error(`Page errors: ${report.pageErrors.join("; ")}`);
}

import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.TAX_QA_URL ?? "http://127.0.0.1:3239",
  out = "artifacts/tax-activation-fix-20261110/screenshots";
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [],
  checks = [];
const open = async (mode) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.addCookies([
    {
      name: "reylumi-tax-qa-session",
      value: "activation-" + mode + Date.now(),
      url: base,
    },
    { name: "reylumi-tax-qa-mode", value: mode, url: base },
  ]);
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return { context, page };
};
const shot = async (page, name) => {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.screenshot({
    path: out + "/" + name + ".png",
    fullPage: true,
    caret: "initial",
  });
};
try {
  const tax = await open("tax");
  await tax.page.goto(base + "/tax?paused=1");
  await tax.page.getByText("Paused", { exact: true }).waitFor();
  assert.equal(
    await tax.page
      .getByRole("link", { name: "Open workspace →", exact: true })
      .count(),
    0,
  );
  await tax.page
    .getByRole("button", { name: "Refresh access", exact: true })
    .waitFor();
  await tax.page
    .getByText("Owner needs to renew Tax Company access.", { exact: true })
    .waitFor();
  await shot(tax.page, "tax-paused-business");
  checks.push(
    "expired connection shows Paused, no financial count or workspace action",
  );
  await tax.page.goto(base + "/tax");
  await tax.page
    .getByRole("link", { name: "Open workspace →", exact: true })
    .waitFor();
  await shot(tax.page, "tax-active-business");
  await tax.context.close();
  checks.push("active connection restores workspace entry");
  const owner = await open("owner");
  await owner.context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: base,
  });
  await owner.page.goto(base + "/tax/qa?view=activation");
  await owner.page
    .getByRole("heading", {
      name: "Next: connect your tax professional",
      exact: true,
    })
    .waitFor();
  await owner.page
    .getByRole("button", { name: "Create salon credentials", exact: true })
    .waitFor();
  assert.equal(
    await owner.page
      .getByRole("button", { name: "Start tax work", exact: true })
      .count(),
    0,
  );
  await owner.page
    .getByRole("button", { name: "Copy sign-in link", exact: true })
    .click();
  await owner.page
    .getByText("Sign-in link copied. Share it with your tax professional.", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await owner.page.evaluate(() => navigator.clipboard.readText()),
    "https://reylumi.com/tax",
  );
  await shot(owner.page, "owner-activation-next-step");
  await owner.page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await owner.page.evaluate(
      () => document.documentElement.scrollWidth <= 390,
    ),
  );
  await shot(owner.page, "owner-activation-phone");
  await owner.context.close();
  checks.push(
    "owner setup renders credentials and copies the professional sign-in link without opening a Tax profile",
  );
  const bridge = await open("owner");
  await bridge.page.goto(
    base +
      "/market/payment-return?plugin=tax-company&salon=00000000-0000-4000-8000-000000000010",
  );
  const web = bridge.page.getByRole("link", {
    name: "Continue to Tax connection setup on the website",
    exact: true,
  });
  await web.waitFor();
  assert.equal(
    await bridge.page
      .getByRole("link", { name: "Open Reylumi app", exact: true })
      .getAttribute("href"),
    "reylumi://market",
  );
  assert.ok((await web.getAttribute("href")).includes("activation=payment"));
  await shot(bridge.page, "tax-payment-return");
  await bridge.context.close();
  checks.push(
    "hosted checkout keeps the existing app deep link and scopes website continuation to the paid salon",
  );
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    out + "/acceptance.json",
    JSON.stringify(
      {
        checks,
        errors,
        screenshots: fs.readdirSync(out).filter((f) => f.endsWith(".png")),
        scope:
          "Actual Next routes/components with loopback-only seeded QA data. No production sessions, payments or physical iOS proof.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, errors }));
} finally {
  await browser.close();
}

import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const base = process.env.TAX_QA_URL ?? "http://127.0.0.1:3239",
  out = path.resolve("artifacts/tax-refinement-20261110/screenshots");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [],
  checks = [];
const run = "00000000-0000-4000-8000-000000000030";
const file = (name, type = "application/pdf") => ({
  name,
  mimeType: type,
  buffer: Buffer.from("%PDF-1.4 seeded test file"),
});
async function open(mode) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await ctx.addCookies([
    {
      name: "reylumi-tax-qa-session",
      value: "acceptance-" + Date.now(),
      url: base,
    },
    { name: "reylumi-tax-qa-mode", value: mode, url: base },
  ]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await p.goto(base + "/tax/qa");
  await p
    .getByText(
      "Local QA · actual app components with seeded data · no production connections",
      { exact: true },
    )
    .waitFor();
  return { ctx, p };
}
const shot = async (p, name) => {
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  return p.screenshot({
    path: path.join(out, name + ".png"),
    fullPage: true,
    caret: "initial",
  });
};
try {
  const { ctx, p } = await open("tax");
  await p.getByLabel("Payroll period", { exact: true }).selectOption(run);
  await p.getByRole("button", { name: "Anna Nguyen", exact: true }).click();
  await shot(p, "tax-payroll");
  assert.equal(await p.getByRole("link", { name: /Download/ }).count(), 0);
  assert.equal(await p.getByRole("button", { name: /Export/ }).count(), 0);
  checks.push("Tax has no download/export actions");
  assert.equal(
    await p.getByRole("columnheader", { name: "Status", exact: true }).count(),
    0,
  );
  assert.equal(
    await p.getByRole("button", { name: "Conversation", exact: true }).count(),
    0,
  );
  assert.equal(
    await p
      .getByRole("button", { name: "Versions & changes", exact: true })
      .count(),
    0,
  );
  for (const name of [
    "Wages reported",
    "Tips reported",
    "Bonus reported",
    "Total reported",
    "Withheld by salon",
    "Check amount",
  ])
    assert.equal(
      await p.getByRole("columnheader", { name, exact: true }).count(),
      1,
    );
  await p
    .getByRole("heading", { name: "How to read these amounts", exact: true })
    .waitFor();
  checks.push(
    "reported earnings breakdown and explanation; paystub replaces manual status; no row chat/version controls",
  );
  await p
    .getByRole("button", { name: "Upload multiple paystubs", exact: true })
    .click();
  await p
    .locator("input[type=file]")
    .setInputFiles([
      file("David-paystub.pdf"),
      file("Michael-invalid.txt", "text/plain"),
    ]);
  await p
    .getByLabel("Recipient for David-paystub.pdf", { exact: true })
    .selectOption("00000000-0000-4000-8000-000000000045");
  await p
    .getByLabel("Recipient for Michael-invalid.txt", { exact: true })
    .selectOption("00000000-0000-4000-8000-000000000045");
  await p
    .getByLabel("I checked each file, recipient and payroll period.", {
      exact: true,
    })
    .check();
  assert.equal(
    await p
      .getByRole("button", {
        name: "Send pending / retry failed files",
        exact: true,
      })
      .isDisabled(),
    true,
  );
  await p
    .getByLabel("Recipient for Michael-invalid.txt", { exact: true })
    .selectOption("00000000-0000-4000-8000-000000000043");
  await p
    .getByLabel("I checked each file, recipient and payroll period.", {
      exact: true,
    })
    .check();
  await shot(p, "tax-batch-match");
  await p
    .getByRole("button", {
      name: "Send pending / retry failed files",
      exact: true,
    })
    .click();
  await p
    .getByText(
      "Batch processed. Successful files stay sent; retry only the failed files.",
      { exact: true },
    )
    .waitFor();
  assert.ok(
    await p
      .getByText("Use a PDF, PNG, JPEG or WebP file up to 10 MB.", {
        exact: true,
      })
      .count(),
  );
  await shot(p, "tax-batch-partial-failure");
  checks.push(
    "duplicate mapping blocked; per-file failure and retry status retained",
  );
  await p.getByRole("button", { name: "Close", exact: true }).click();
  await p
    .getByLabel("Date range", { exact: true })
    .selectOption("previous_year");
  assert.equal(
    await p.getByLabel("Status for Anna Nguyen", { exact: true }).count(),
    0,
  );
  assert.equal(
    await p
      .getByRole("button", { name: "Upload multiple paystubs", exact: true })
      .isDisabled(),
    true,
  );
  checks.push(
    "year summary does not edit or upload against an arbitrary period",
  );
  await p.getByRole("tab", { name: "Documents", exact: true }).click();
  await shot(p, "tax-documents-current");
  await p.getByRole("button", { name: "Archive", exact: true }).first().click();
  await shot(p, "tax-documents-archive");
  await p.getByRole("tab", { name: /Conversations/ }).click();
  await p.getByRole("button", { name: "Sophia Le", exact: true }).click();
  await p
    .getByLabel("Message", { exact: true })
    .fill("Please confirm the updated employee information.");
  await p.getByRole("button", { name: "Send message", exact: true }).click();
  await p
    .getByText("Message sent. It remains in the owner's business history.", {
      exact: true,
    })
    .waitFor();
  await shot(p, "tax-conversation");
  checks.push("contextual conversation sends through real Next server action");
  await p.getByRole("tab", { name: "Receipts", exact: true }).click();
  await p.getByRole("button", { name: "＋ Add receipt", exact: true }).click();
  await p.getByLabel("Description", { exact: true }).fill("Acceptance receipt");
  await p.getByLabel("Amount · USD", { exact: true }).fill("12.34");
  await p.getByRole("button", { name: "Save receipt", exact: true }).click();
  await p
    .getByText("Receipt saved. Amounts are stored exactly in cents.", {
      exact: true,
    })
    .waitFor();
  await p.getByText("$362.34", { exact: true }).waitFor();
  await shot(p, "tax-receipts");
  checks.push("receipt cents and category totals");
  await p.getByRole("button", { name: "History", exact: true }).click();
  await shot(p, "tax-history");
  await p.locator(".tax-account-menu summary").click();
  await shot(p, "tax-role-switcher");
  await p.getByRole("button", { name: "Tax profile", exact: true }).click();
  await shot(p, "tax-profile");
  await p.getByRole("button", { name: "Close", exact: true }).click();
  for (const width of [1024, 390, 320]) {
    await p.setViewportSize({ width, height: 900 });
    for (const name of ["Payroll", "Documents", "Receipts"]) {
      await p.getByRole("tab", { name, exact: true }).click();
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
        `horizontal page overflow at ${width} ${name}`,
      );
    }
    if (width === 390) await shot(p, "tax-mobile-documents");
  }
  checks.push("desktop/tablet/mobile layout has no page overflow");
  await ctx.close();
  const owner = await open("owner");
  await owner.p.getByLabel("Payroll period", { exact: true }).selectOption(run);
  await shot(owner.p, "owner-payroll");
  await owner.p.getByRole("tab", { name: "Documents", exact: true }).click();
  await shot(owner.p, "owner-documents-current");
  assert.ok(
    await owner.p.getByRole("link", { name: "Download", exact: true }).count(),
  );
  await owner.p
    .getByRole("button", { name: "Archive", exact: true })
    .first()
    .click();
  await shot(owner.p, "owner-documents-archive");
  await owner.p
    .getByRole("button", { name: "Access & settings", exact: true })
    .click();
  await shot(owner.p, "owner-access-settings");
  await owner.p.getByRole("button", { name: "History", exact: true }).click();
  await shot(owner.p, "owner-history-handover");
  await owner.p.goto(base + "/tax/qa?view=setting");
  assert.equal(
    await owner.p.locator('input[name="effective_from"]').inputValue(),
    "2026-11-16",
  );
  await owner.p.getByRole("button", { name: /^Effective from/ }).click();
  await owner.p.locator('input[type="date"]').fill("2026-11-24");
  assert.equal(
    await owner.p.locator('input[name="effective_from"]').inputValue(),
    "2026-11-16",
  );
  await owner.p.getByRole("button", { name: /Entire selected period/ }).click();
  assert.equal(
    await owner.p.locator('input[name="effective_from"]').inputValue(),
    "2026-11-01",
  );
  owner.p.once("dialog", async (dialog) => {
    assert.match(dialog.message(), /ENTIRE selected payroll period/);
    await dialog.dismiss();
  });
  await owner.p.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal(new URL(owner.p.url()).searchParams.get("view"), "setting");
  await owner.p.getByRole("button", { name: /Next period/ }).click();
  await shot(owner.p, "owner-whole-period-setting");
  checks.push(
    "actual owner setting form defaults to next period, aligns dates and confirms entire selected period",
  );
  await owner.ctx.close();
  checks.push("owner current/archive/download/access/handover history");
  const staff = await open("staff");
  assert.equal(
    await staff.p.getByText("Paystub-Brian.pdf", { exact: true }).count(),
    0,
  );
  await shot(staff.p, "staff-current");
  assert.ok(
    await staff.p.getByRole("link", { name: "Download", exact: true }).count(),
  );
  await staff.p
    .getByRole("button", { name: "Archive", exact: true })
    .first()
    .click();
  await staff.p.getByText("Paystub-Anna-v1.pdf", { exact: true }).waitFor();
  await shot(staff.p, "staff-archive");
  await staff.ctx.close();
  checks.push("staff sees only own current and archive documents");
  const entry = await open("tax");
  await entry.p.goto(base + "/tax");
  await shot(entry.p, "tax-businesses");
  await entry.p
    .getByRole("button", { name: "＋ Connect business", exact: true })
    .click();
  await shot(entry.p, "tax-connect-business");
  await entry.p.goto(base + "/tax?setup=1");
  await shot(entry.p, "tax-activate-role");
  await entry.p
    .getByRole("button", { name: "Start tax work", exact: true })
    .click();
  await entry.p
    .getByRole("heading", { name: "My businesses", exact: true })
    .waitFor();
  await entry.ctx.close();
  checks.push("personal Tax opt-in and connection entry");
  const guest = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    g = await guest.newPage();
  g.on("pageerror", (e) => errors.push(e.message));
  g.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  for (const route of ["login", "signup", "forgot-password", "install"]) {
    await g.goto(base + "/tax/" + route);
    assert.equal(await g.locator("h1").count(), 1);
    await shot(g, "tax-" + route);
  }
  await guest.close();
  checks.push("dedicated sign-in/signup/recovery screens");
  assert.deepEqual(errors, []);
  const receipt = {
    checks,
    errors,
    screenshots: fs.readdirSync(out).filter((f) => f.endsWith(".png")),
    scope:
      "Real Next.js routes and production React components; loopback-only seeded QA adapter. SQL/RLS acceptance is covered separately with PGlite; no production authentication or device proof.",
  };
  fs.writeFileSync(
    path.join(out, "acceptance.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await browser.close();
}

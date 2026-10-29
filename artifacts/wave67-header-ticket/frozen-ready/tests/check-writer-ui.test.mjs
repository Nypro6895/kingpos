import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { PDFDocument, StandardFonts } from "pdf-lib";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
test(
  "Check Writer UI: mobile/desktop payroll, standalone, two stubs, verification, history and device-only calibration",
  { timeout: 120000 },
  async () => {
    const copy = JSON.parse(
      readFileSync("lib/vietnamese-check-writer.json", "utf8"),
    );
    const result = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CheckWriter} from './app/check-writer/check-writer';createRoot(document.getElementById('root')).render(<CheckWriter/>);`,
      },
      outfile: "bundle.js",
      bundle: true,
      write: false,
      jsx: "automatic",
      plugins: [
        {
          name: "host-fixture",
          setup(b) {
            b.onResolve(
              { filter: /^next\/link$|^@\/components\/workspace-language$/ },
              (a) => ({ path: a.path, namespace: "fixture" }),
            );
            b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
              resolveDir: process.cwd(),
              contents:
                a.path === "next/link"
                  ? `import React from 'react';export default function Link(props){return React.createElement('a',props)}`
                  : `const copy=${JSON.stringify(copy)};export function useWorkspaceTranslation(){return text=>location.search.includes('vi')?(copy[text]??text):text}`,
            }));
          },
        },
      ],
    });
    const js = result.outputFiles.find((f) => f.path.endsWith(".js")).text,
      css = result.outputFiles.find((f) => f.path.endsWith(".css")).text;
    const run = {
      id: id(1),
      period_start: "2026-10-12",
      period_end: "2026-10-25",
      version: 3,
      status: "locked",
      updated_at: "2026-10-27T12:00:00Z",
    };
    const line = (n, name, amount) => ({
      id: id(n),
      payroll_run_id: run.id,
      staff_id: id(n + 10),
      staff_display_name_snapshot: name,
      staff_legal_name_snapshot: name,
      final_check_amount: amount,
      final_cash_amount: 200,
      tip_amount: 120,
      bonus_amount: 50,
      gross_sales: 2000,
      updated_at: "2026-10-27T12:00:00Z",
      check_number: null,
    });
    const state = {
      businessDate: "2026-10-27",
      salonId: id(90),
      salonIssuer: "DEMO NAIL SALON",
      salonAddress: "100 Sample Ave\nSample City",
      active: true,
      subscribed: true,
      settings: {
        issuer: "DEMO NAIL SALON",
        address: "100 Sample Ave\nSample City",
        useSalon: true,
        bankName: "Demo Bank",
        last4: "4821",
        nextNumber: 1041,
        version: 1,
        stock: "preprinted",
        offsetX: 0,
        offsetY: 0,
        stubs: { same: true, payee: [], salon: [] },
      },
      runs: [run],
      selectedRun: run,
      lines: [
        line(2, "Anna Nguyen", 1245.8),
        line(3, "Mia Tran", 980.25),
        line(4, "Zero Pay", 0),
      ],
      history: [
        {
          id: id(20),
          number: 1040,
          snapshot: {
            payee: "Demo Prior Payee",
            amountCents: 12500,
            memo: "Sample payroll",
            date: "2026-10-20",
          },
          status: "issued",
          created_at: "2026-10-20T12:00:00Z",
          delivery_count: 1,
        },
      ],
      events: [],
    };
    const requests = [];
    const samplePdf = await PDFDocument.create();
    const sampleFont = await samplePdf.embedFont(StandardFonts.Helvetica);
    samplePdf.addPage([612, 792]).drawText("SAMPLE PREVIEW - NOT A PAYMENT", {
      x: 40,
      y: 700,
      font: sampleFont,
      size: 20,
    });
    const pdf = Buffer.from(await samplePdf.save());
    const server = createServer(async (req, res) => {
      if (req.url.startsWith("/api/check-writer")) {
        res.setHeader("Cache-Control", "no-store");
        if (req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(state));
          return;
        }
        let raw = "";
        for await (const c of req) raw += c;
        const body = JSON.parse(raw);
        requests.push(body);
        if (
          body.action === "preview" ||
          body.action === "alignment" ||
          req.url.includes("/pdf")
        ) {
          res.setHeader("Content-Type", "application/pdf");
          if (req.url.includes("/pdf") && !body.preview)
            res.setHeader("X-Check-Writer-Output-ID", id(80));
          res.end(pdf);
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify(
            body.action === "issue"
              ? { ids: [id(50)] }
              : body.action === "recover_creation"
                ? { status: "created", ids: [id(50)] }
                : body.action === "cancel_creation"
                  ? { status: "canceled" }
                  : { ok: true },
          ),
        );
        return;
      }
      res.setHeader(
        "Content-Type",
        req.url === "/bundle.js" ? "application/javascript" : "text/html",
      );
      res.end(
        req.url === "/bundle.js"
          ? js
          : `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}*{box-sizing:border-box}body{margin:0;background:#f5f7f7;font-family:Arial,sans-serif}button,input,textarea,select{font:inherit}button,a{cursor:pointer}h1,h2,p{margin:0 0 10px}button{border:0}a{color:inherit}fieldset{border:1px solid #dde4e4;border-radius:8px;margin:0;padding:12px}label{margin-bottom:8px}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    mkdirSync("work/check-writer-tests/ui", { recursive: true });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      for (const width of [320, 390, 768, 1440]) {
        const page = await browser.newPage({
            viewport: { width, height: 1000 },
          }),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await page.goto(base);
        await page
          .getByRole("heading", { name: "Print checks", exact: true })
          .waitFor();
        assert.equal(await page.getByLabel(/Zero Pay/).isDisabled(), true);
        await page.getByText("Check stub details", { exact: true }).click();
        assert.equal(
          await page.getByLabel("Same details on both stubs").isChecked(),
          true,
        );
        await page.getByLabel("Same details on both stubs").uncheck();
        await page
          .getByRole("group", { name: "Payee copy", exact: true })
          .getByLabel("Tip", { exact: true })
          .check();
        await page
          .getByRole("group", { name: "Salon copy", exact: true })
          .getByLabel("Bonus", { exact: true })
          .check();
        await page.screenshot({
          path: `work/check-writer-tests/ui/payroll-${width}.png`,
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Review checks", exact: true })
          .click();
        await page
          .getByLabel("Password", { exact: true })
          .fill("fixture-password");
        await page.getByRole("button", { name: "Verify", exact: true }).click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await page
          .getByRole("button", { name: "Review checks", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Confirm & create checks" })
          .waitFor();
        const preview = requests.filter((r) => r.action === "preview").at(-1);
        assert.equal(preview.mode, "payroll");
        assert.equal(preview.lines.length, 2);
        assert.deepEqual(preview.stubs.payee, ["tip"]);
        assert.deepEqual(preview.stubs.salon, ["bonus"]);
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page
          .getByRole("button", { name: "Standalone check", exact: true })
          .click();
        await page
          .getByLabel("Pay to", { exact: true })
          .fill("Demo Supply Co.");
        await page.getByLabel("Amount", { exact: true }).fill("250.00");
        await page.getByLabel("Memo", { exact: true }).fill("Salon supplies");
        await page.screenshot({
          path: `work/check-writer-tests/ui/standalone-${width}.png`,
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Review checks", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Confirm & create checks" })
          .click();
        await page.getByRole("heading", { name: "Checks created" }).waitFor();
        const issued = requests.filter((r) => r.action === "issue").at(-1);
        assert.equal(issued.mode, "standalone");
        assert.equal(issued.amount, "250.00");
        assert.equal(issued.payee, "Demo Supply Co.");
        assert.equal(issued.memo, "Salon supplies");
        const beforeDispatch = requests.filter(
          (r) => r.action === "dispatch",
        ).length;
        await page
          .getByRole("button", { name: "Download PDF", exact: true })
          .click();
        await page
          .getByText(
            "This output has been used. Use History and enter a reason for another output.",
            { exact: true },
          )
          .waitFor();
        assert.equal(
          await page
            .getByRole("button", { name: "Download PDF", exact: true })
            .isDisabled(),
          true,
        );
        assert.equal(
          requests.filter((r) => r.action === "dispatch").length,
          beforeDispatch + 1,
        );
        assert.equal(
          requests.filter((r) => r.action === "dispatch").at(-1).method,
          "download",
        );
        await page.getByRole("button", { name: "Close", exact: true }).click();
        await page
          .getByRole("button", { name: "Check settings", exact: true })
          .click();
        await page.getByLabel("Enter or replace bank details").check();
        await page
          .getByLabel("Account number", { exact: true })
          .fill("123450000");
        assert.equal(
          await page
            .getByLabel("Account number", { exact: true })
            .getAttribute("type"),
          "password",
        );
        await page.getByLabel("X (mm)").fill("1.2");
        assert.equal(
          await page.evaluate(
            () => JSON.parse(localStorage.getItem("check-writer-alignment")).x,
          ),
          1.2,
        );
        assert.equal(
          await page.evaluate(() =>
            JSON.stringify(localStorage).includes("123450000"),
          ),
          false,
        );
        await page.screenshot({
          path: `work/check-writer-tests/ui/settings-${width}.png`,
          fullPage: true,
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        assert.deepEqual(errors, []);
        await page.evaluate(() => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            value: "hidden",
          });
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForTimeout(50);
        assert.equal(
          await page.getByLabel("Account number", { exact: true }).inputValue(),
          "",
        );
        assert.equal(await page.locator('iframe[src^="blob:"]').count(), 0);
        await page.close();
      }
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      await page.goto(base + "?vi");
      await page
        .getByRole("button", { name: "Check riêng", exact: true })
        .click();
      await page
        .getByText("Không liên kết với bảng lương", { exact: true })
        .waitFor();
      await page.screenshot({
        path: "work/check-writer-tests/ui/vi-mobile.png",
        fullPage: true,
      });
      await page.close();
      const recover = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      await recover.addInitScript(
        ({ key, value }) => sessionStorage.setItem(key, value),
        { key: "check-writer-pending:" + id(90), value: id(77) },
      );
      await recover.goto(base);
      await recover
        .getByRole("button", { name: "Recover creation", exact: true })
        .click();
      await recover
        .getByLabel("Password", { exact: true })
        .fill("fixture-password");
      await recover
        .getByRole("button", { name: "Verify", exact: true })
        .click();
      await recover.getByRole("dialog").waitFor({ state: "hidden" });
      const issuedBefore = requests.filter((r) => r.action === "issue").length;
      await recover
        .getByRole("button", { name: "Recover creation", exact: true })
        .click();
      await recover
        .getByRole("heading", { name: "History", exact: true })
        .waitFor();
      assert.equal(
        requests.filter((r) => r.action === "issue").length,
        issuedBefore,
      );
      assert.equal(
        await recover.evaluate(
          (key) => sessionStorage.getItem(key),
          "check-writer-pending:" + id(90),
        ),
        null,
      );
      await recover.close();
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

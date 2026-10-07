import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test(
  "Reports: inline tabs, filter draft, chart scale and mobile layout",
  { skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH },
  async () => {
    const { build } = await import(
      pathToFileURL(process.env.ESBUILD_MODULE_PATH)
    );
    const repo = resolve(".").replaceAll("\\", "/"),
      scratch = mkdtempSync(join(tmpdir(), "reports-ui-"));
    const entry = join(scratch, "entry.tsx");
    writeFileSync(
      entry,
      `import React from 'react'; import {createRoot} from 'react-dom/client';
 import {OperationalReportDashboard} from '${repo}/app/reports/operational-report-dashboard';
 import {ClosingDateForm,ReportTabs} from '${repo}/app/reports/report-controls';
 const metric={current:100,previous:80,delta:20,direction:'up',percentChange:25};
 const totals={averageTicket:50,collectedTotal:1900,discountTotal:16,dueTotal:0,grossSales:1812,netSales:1796,taxTotal:0,ticketCount:26,tipTotal:104,totalRevenue:1900};
 const report={totals,range:{businessDate:'2026-09-23',startDate:'2026-09-01',endDate:'2026-09-23',label:'Sep 1 to Sep 23, 2026',previousStartDate:'2026-08-09',previousEndDate:'2026-08-31',preset:'this_month',timeZone:'America/Chicago',dayCount:23},comparison:Object.fromEntries(['grossSales','netSales','totalRevenue','ticketCount','bookings','customerCount'].map(k=>[k,metric])),bookingMetrics:{booked:20,completed:12,completionRate:60,checkedIn:1,inService:1,confirmed:3,cancelled:1,noShow:1,pending:1},customerMetrics:{activeCustomers:10,newCustomerRecords:3,returningCustomers:7,linkedCustomers:6},dataGaps:[],isEmpty:false,trend:Array.from({length:23},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),label:'Sep '+(i+1),totalRevenue:i===0?0:i===1?-10:100+i*5,ticketCount:i})),paymentBreakdown:[{method:'cash',amount:1900,percentOfCollected:100}],serviceBreakdown:[{serviceId:'a',serviceName:'Manicure',category:'Nails',itemCount:26,percentOfGrossSales:100,revenue:1812}],staffAttributionSource:'pos_ticket_staff_earnings',staffRows:[{staffId:'a',staffName:'Taylor',averageTicket:50,serviceSales:1812,tips:104,totalTurns:26,ticketCount:26}],recentTickets:[{id:'a',ticketNumber:'1001',openedAt:'2026-09-23T10:00:00Z',closedAt:'2026-09-23T11:00:00Z',paymentStatus:'paid',customerName:'Nene',totals}]};
 window.calls=[]; createRoot(document.getElementById('root')).render(<main style={{maxWidth:1200,margin:'auto',padding:16,display:'grid',gap:20}}><ReportTabs overview={<OperationalReportDashboard report={report} salonName="King Nails" selectedClosingDate="2026-09-23"/>}><h2>Daily Closing fixture</h2><input aria-label="Closing draft"/><ClosingDateForm><input name="date" aria-label="Business date" type="date" defaultValue="2026-09-23"/><input name="preset" type="hidden" value="this_month"/><button type="submit">Load date</button></ClosingDateForm></ReportTabs></main>);`,
    );
    const bundle = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      jsx: "automatic",
      platform: "browser",
      nodePaths: [join(repo, "node_modules")],
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "fixture",
          setup(b) { b.onResolve({filter:/explore-account-actions$/},()=>({path:"account",namespace:"account-stub"})); b.onLoad({filter:/.*/,namespace:"account-stub"},()=>({contents:"export const useExploreAuthenticated=()=>false;"}));
            b.onResolve({ filter: /^next\/navigation$/ }, () => ({
              path: "nav",
              namespace: "mock",
            }));
            b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
              contents: `export const usePathname=()=>"/reports"; export const useRouter=()=>({push:(href)=>window.calls.push(href)});`,
            }));
          },
        },
      ],
    });
    const css = await postcss([tailwind({ base: repo })]).process(
      `@import "tailwindcss" source(none); @source "${repo}/app/reports"; @source "${repo}/app/my-place/place-ui.tsx"; body{font-family:Arial;margin:0}`,
      { from: join(repo, "reports-qa.css") },
    );
    const server = createServer((req, res) => {
      if (req.url === "/bundle.js") {
        res.setHeader("content-type", "text/javascript");
        res.end(bundle.outputFiles[0].text);
      } else if (req.url === "/style.css") {
        res.setHeader("content-type", "text/css");
        res.end(css.css);
      } else
        res.end(
          '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
        );
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.TEST_BROWSER_PATH,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/reports`);
      await page
        .getByRole("heading", { name: "Reports", exact: true })
        .waitFor();
      assert.equal(
        await page.locator("svg rect").first().getAttribute("height"),
        "0",
      );
      assert.equal(
        await page.locator("svg rect").nth(1).getAttribute("fill"),
        "#be123c",
      );
      await page.getByRole("button", { name: /Filter/ }).click();
      await page.getByLabel("Today", { exact: true }).check();
      await page.mouse.click(5, 200);
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.deepEqual(await page.evaluate(() => window.calls), []);
      await page.getByRole("button", { name: /Filter/ }).click();
      assert.equal(
        await page.getByLabel("This month", { exact: true }).isChecked(),
        true,
      );
      await page.getByLabel("Custom dates").check();
      await page.getByLabel("Start", { exact: true }).fill("2026-09-10");
      await page.getByLabel("End", { exact: true }).fill("2026-09-20");
      await page.getByRole("button", { name: "Apply filters" }).click();
      assert.equal(
        await page.evaluate(() => window.calls[0]),
        "/reports?preset=custom&date=2026-09-23&start=2026-09-10&end=2026-09-20",
      );
      await page
        .getByRole("button", { name: "Daily Closing", exact: true })
        .click();
      await page.getByLabel("Closing draft").fill("Preserved");
      await page.getByLabel("Business date").fill("2026-09-22");
      await page.getByRole("button", { name: "Load date" }).click();
      assert.equal(
        await page.evaluate(() => window.calls.at(-1)),
        "/reports?date=2026-09-22&preset=this_month#daily-closing",
      );

      await page.getByRole("button", { name: "Overview", exact: true }).click();
      await page
        .getByRole("button", { name: "Daily Closing", exact: true })
        .click();
      assert.equal(
        await page.getByLabel("Closing draft").inputValue(),
        "Preserved",
      );
      await page.getByRole("button", { name: "Overview", exact: true }).click();
      mkdirSync("artifacts/reports-qa", { recursive: true });
      await page.screenshot({
        path: "artifacts/reports-qa/desktop.png",
        fullPage: true,
      });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `overflow at ${width}`,
        );
      }
      await page.screenshot({
        path: "artifacts/reports-qa/mobile.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: /Filter/ }).click();
      await page.getByLabel("Custom dates").check();
      assert.equal(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page.screenshot({ path: "artifacts/reports-qa/mobile-filter.png" });
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);

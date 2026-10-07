import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { chromium } from "playwright-core";
const enabled = Boolean(
  process.env.ESBUILD_MODULE_PATH && process.env.TEST_BROWSER_PATH,
);
test(
  "campaign list preserves separate creations, failed edits and status transitions",
  { skip: !enabled },
  async () => {
    const { build } = await import(
      pathToFileURL(process.env.ESBUILD_MODULE_PATH).href
    );
    const built = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CampaignManager} from './app/(app)/admin/advertising/campaign-manager';createRoot(document.getElementById('root')).render(<CampaignManager initialCampaigns={[]} error=""/>);`,
      },
      bundle: true,
      write: false,
      outfile: "fixture.js",
      jsx: "automatic",
      plugins: [
        {
          name: "stubs",
          setup(b) {
            b.onResolve(
              {
                filter:
                  /^(next\/navigation|@\/lib\/supabase\/browser)$|^\.\/actions$/,
              },
              (a) => ({ path: a.path, namespace: "stub" }),
            );
            b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
              loader: "js",
              contents:
                a.path === "next/navigation"
                  ? `export const useRouter=()=>({refresh(){}});`
                  : a.path.endsWith("/browser")
                    ? `export const createSupabaseBrowserClient=()=>null;`
                    : `window.rows={};export async function saveCampaignAction(previous,form){if(window.failSave){window.failSave=false;return {ok:false,message:'Save unavailable. Try again.',errors:{}};}const id=form.get('id')||crypto.randomUUID();window.rows[id]=Object.fromEntries(form);return {ok:true,id,message:'Saved'};}export async function deleteCampaignAction(form){delete window.rows[form.get('id')];}export async function campaignImageUploadAction(){throw new Error('Unsupported test upload');}`,
            }));
          },
        },
      ],
    });
    const server = createServer((req, res) => {
      if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(built.outputFiles.find((f) => f.path.endsWith(".js")).text);
      } else
        res.end(
          `<html><style>${built.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? ""}</style><div id="root"></div><script src="/bundle.js"></script></html>`,
        );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const browser = await chromium.launch({
      executablePath: process.env.TEST_BROWSER_PATH,
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1200, height: 900 },
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const create = async (name) => {
        await page
          .getByRole("button", { name: "+ Create campaign", exact: true })
          .click();
        await page.getByLabel("Campaign name").fill(name);
        await page
          .getByLabel("Status", { exact: true })
          .selectOption("running");
        await page
          .getByRole("button", { name: "Save campaign", exact: true })
          .click();
        await page.getByRole("heading", { name, exact: true }).waitFor();
      };
      await create("First offer");
      await create("Second offer");
      assert.equal(await page.locator("article").count(), 2);
      assert.equal(
        await page.evaluate(() => Object.keys(window.rows).length),
        2,
      );
      await page
        .getByRole("button", { name: "+ Create campaign", exact: true })
        .click();
      await page.getByLabel("Campaign name").fill("Keep this draft");
      await page
        .getByLabel("Click destination (optional)")
        .fill("javascript:alert(1)");
      await page
        .getByRole("button", { name: "Save campaign", exact: true })
        .click();
      await page.getByText("Use an HTTPS link or a local path.").waitFor();
      assert.equal(
        await page.getByLabel("Campaign name").inputValue(),
        "Keep this draft",
      );
      assert.equal(
        await page.getByLabel("Click destination (optional)").inputValue(),
        "javascript:alert(1)",
      );
      await page.getByLabel("Click destination (optional)").fill("");
      await page.evaluate(() => {
        window.failSave = true;
      });
      await page
        .getByRole("button", { name: "Save campaign", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "Save unavailable" })
        .waitFor();
      assert.equal(
        await page.getByLabel("Campaign name").inputValue(),
        "Keep this draft",
      );
      await page
        .getByRole("button", { name: "Save campaign", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Keep this draft", exact: true })
        .waitFor();
      await page.getByRole("button", { name: /^Running/ }).click();
      const first = page
        .locator("article")
        .filter({
          has: page.getByRole("heading", { name: "First offer", exact: true }),
        });
      await first.getByRole("button", { name: "Stop", exact: true }).click();
      await page
        .getByRole("heading", { name: "First offer", exact: true })
        .waitFor();
      assert.equal(await page.locator("article").count(), 1);
      await page.getByRole("button", { name: /^Running/ }).click();
      assert.equal(
        await page
          .getByRole("heading", { name: "Second offer", exact: true })
          .count(),
        1,
      );
      fs.mkdirSync(".next-advertising-build/review", { recursive: true });
      await page.screenshot({
        path: ".next-advertising-build/review/admin-desktop.png",
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: ".next-advertising-build/review/admin-mobile.png",
        fullPage: true,
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

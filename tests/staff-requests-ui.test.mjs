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
  "Staff requests: tabs, drawer actions, search and mobile",
  { skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH },
  async () => {
    const { build } = await import(
      pathToFileURL(process.env.ESBUILD_MODULE_PATH)
    );
    const repo = resolve(".").replaceAll("\\", "/"),
      scratch = mkdtempSync(join(tmpdir(), "requests-ui-"));
    const entry = join(scratch, "entry.tsx");
    writeFileSync(
      entry,
      `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {RequestsWorkspace,RequestAccountSearch,RequestForm} from '${repo}/app/staff/requests-workspace';
      window.calls=[];
      const entries=['applications','invitations','history'].map((group,i)=>({id:String(i),group,name:i===2?'Tracy':'Taylor',contact:'t***@example.test',status:i===2?'accepted':'pending',kind:group==='applications'?'Application':'Invitation',date:'Sep 23, 2026',detail:<div><p>t***@example.test</p>{i===0?<RequestForm action={async()=>{window.calls.push('accept');await new Promise(r=>window.finish=r)}}><button type="submit">Accept application</button></RequestForm>:<p>Request details</p>}</div>}));
      createRoot(document.getElementById('root')).render(<main style={{maxWidth:1000,margin:'auto',padding:16}}><RequestsWorkspace entries={entries} initialInvite={false} invite={<RequestAccountSearch email="" phone=""/>}/></main>);`,
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
          setup(b) {
            b.onResolve({ filter: /^next\/navigation$/ }, () => ({
              path: "nav",
              namespace: "mock",
            }));
            b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
              contents: `export const useRouter=()=>({push:(href)=>window.calls.push(href)});`,
            }));
          },
        },
      ],
    });
    const css = await postcss([tailwind({ base: repo })]).process(
      `@import "tailwindcss" source(none); @source "${repo}/app/staff"; @source "${repo}/app/my-place/place-ui.tsx"; body{font-family:Arial;margin:0}`,
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
        .getByRole("heading", { name: "Requests", exact: true })
        .waitFor();
      assert.equal(await page.getByText("Tracy", { exact: true }).count(), 0);
      await page.getByRole("button", { name: /History/ }).click();
      await page.getByRole("button", { name: /Tracy/ }).click();
      await page.getByRole("dialog").waitFor();
      await page.mouse.click(5, 200);
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: /Applications/ }).click();
      await page.getByRole("button", { name: /Taylor/ }).click();
      await page.getByRole("button", { name: "Accept application" }).click();
      await page.getByText("Saving...", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").isVisible(), true);
      await page.evaluate(() => window.finish());
      await page
        .getByText("Saving...", { exact: true })
        .waitFor({ state: "hidden" });
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "+ Invite staff", exact: true })
        .click();
      await page.locator("input[type=email]").fill("person@example.test");
      page.once("dialog", (d) => d.dismiss());
      await page.mouse.click(5, 200);
      assert.equal(await page.getByRole("dialog").isVisible(), true);
      await page.getByRole("button", { name: "Search account" }).click();
      assert.equal(
        await page.evaluate(() => window.calls.at(-1)),
        "/staff?invite_email=person%40example.test",
      );
      page.once("dialog", (d) => d.accept());
      await page.keyboard.press("Escape");
      mkdirSync("artifacts/staff-requests-qa", { recursive: true });
      await page.screenshot({
        path: "artifacts/staff-requests-qa/desktop.png",
        fullPage: true,
      });
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
      }
      await page.screenshot({
        path: "artifacts/staff-requests-qa/mobile.png",
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "+ Invite staff", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page.screenshot({
        path: "artifacts/staff-requests-qa/mobile-invite.png",
      });
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);

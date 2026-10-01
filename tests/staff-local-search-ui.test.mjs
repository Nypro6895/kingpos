import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test(
  "Staff directory: local search keeps drafts and makes no requests",
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
      import {StaffDirectoryEditor} from '${repo}/app/staff/staff-directory-editor';
      const member=(id,name)=>({id,display_name:name,first_name:name,last_name:'',is_active:true,email:id+'@example.test',phone:'5551234',job_title:'Nail technician',employment_status:'active',staff_profile_avatar_url:null});
      const status={booking:{label:'',tone:'success'},payroll:{label:'',tone:'success'}};
      window.calls=[];
      createRoot(document.getElementById('root')).render(<main style={{padding:16}}><StaffDirectoryEditor activeStaff={[member('a','Tracy'),member('b','Taylor')]} hiddenStaff={[{...member('c','Hidden Person'),is_active:false}]} addHref="/staff?add=1" canManageStaff={true} hasAnyStaff={true} profileHrefByStaffId={{a:'/staff?staff=a',b:'/staff?staff=b',c:'/staff?staff=c'}} query="Tracy" statusByStaffId={{a:status,b:status,c:status}}/></main>);`,
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
            b.onResolve({ filter: /^next\/link$/ }, () => ({
              path: "link",
              namespace: "mock",
            }));
            b.onResolve({ filter: /actions$/ }, () => ({
              path: "actions",
              namespace: "mock",
            }));
            b.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
              resolveDir: repo,
              contents:
                path === "link"
                  ? `import React from 'react';export default function Link({children,...p}){return React.createElement('a',p,children)}`
                  : `export async function resetStaffPasscodeFormAction(){}; export async function updateStaffDirectoryBatchFormAction(form){window.calls.push(Object.fromEntries(form));}`,
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
      const search = page.getByRole("searchbox", { name: "Search staff" });
      await search.waitFor();
      let requests = 0;
      page.on("request", () => requests++);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      const active = page.getByLabel("Enable staff", { exact: true });
      await active.uncheck();
      await search.fill("Taylor");
      assert.equal(await page.getByText("Tracy", { exact: true }).count(), 0);
      await search.fill("Tracy");
      assert.equal(
        await page.getByLabel("Enable staff", { exact: true }).isChecked(),
        false,
      );
      await search.fill("not-found");
      await page.getByText("0 matching staff", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Clear", exact: true }).click();
      assert.equal(await search.inputValue(), "");
      assert.equal(
        await page.getByRole("button", { name: "Edit", exact: true }).count(),
        1,
      );
      await search.fill("Hidden");
      assert.equal(await page.locator("details").getAttribute("open"), "");
      await search.fill("b@example.test");
      await page.getByText("1 matching staff", { exact: true }).waitFor();
      await search.press("Enter");
      assert.equal(requests, 0);
      assert.deepEqual(await page.evaluate(() => window.calls), []);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);

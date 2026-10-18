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
  "Staff directory: compact single-open editor saves one staff and cancels drafts without requests",
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
      const member=(id,name)=>({id,display_name:name,first_name:name,last_name:'',is_active:true,email:id+'@example.test',phone:'5551234',job_title:'Nail technician',online_booking_enabled:true,pos_enabled:true,salon_profile_content_posting_enabled:true,passcode_is_default:true,employment_status:'active',staff_profile_avatar_url:null});
      const status={booking:{label:'',tone:'success'},payroll:{label:'',tone:'success'}};
      window.calls=[]; window.pinCalls=[];
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
            b.onResolve({filter:/^next\/navigation$/},()=>({path:"navigation",namespace:"mock"}));
            b.onResolve({ filter: /^next\/link$/ }, () => ({
              path: "link",
              namespace: "mock",
            }));
            b.onResolve({ filter: /actions?$/ }, () => ({
              path: "actions",
              namespace: "mock",
            }));
            b.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
              resolveDir: repo,
              contents:
                path === "navigation" ? "export const useRouter=()=>({refresh(){}}); export const usePathname=()=>'/staff';" : path === "link"
                  ? `import React from 'react';export default function Link({children,...p}){return React.createElement('a',p,children)}`
                  : `export async function deleteUnusedRecordAction(){throw Error('Deletion is outside this fixture');}; export async function resetStaffPasscodeFormAction(form){window.pinCalls.push(Object.fromEntries(form));}; export async function saveStaffDirectoryEntryAction(form){if(window.delaySave)await new Promise(resolve=>window.finishSave=resolve);if(window.failSave)return {ok:false,message:'Fixture save failed'};window.calls.push(Object.fromEntries(form));return {ok:true};}`,
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
      await page.getByRole("switch", { name: "Staff", exact: true }).uncheck();
      assert.equal(await page.getByRole("switch", { name: "Booking", exact: true }).isChecked(), false);
      assert.equal(await page.getByRole("switch", { name: "POS", exact: true }).isEnabled(), false);
      await search.fill("Taylor");
      assert.equal(await page.getByText("Tracy", { exact: true }).count(), 0);
      await search.fill("Tracy");
      assert.equal(await page.getByRole("switch", { name: "Staff", exact: true }).isChecked(), false);
      await search.fill("not-found");
      await page.getByText("0 matching staff", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Clear staff search", exact: true }).click();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.equal(await page.getByRole("form", { name: "Edit staff" }).count(), 0);
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      assert.equal(await page.getByRole("switch", { name: "Staff", exact: true }).isChecked(), true);
      assert.equal(await page.getByRole("switch", { name: "Booking", exact: true }).isChecked(), true);
      assert.equal(await page.getByRole("switch", { name: "POS", exact: true }).isChecked(), true);
      await page.getByLabel("Nickname", { exact: true }).fill("Discard this");
      await page.getByLabel("Phone", { exact: true }).fill("5550000");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.calls), []);
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      assert.equal(await page.getByLabel("Nickname", { exact: true }).inputValue(), "Tracy");
      assert.equal(await page.getByLabel("Phone", { exact: true }).inputValue(), "5551234");
      assert.equal(await page.getByLabel("Role", { exact: true }).count(), 0);
      assert.equal(await page.getByPlaceholder("Default 1234", { exact: true }).inputValue(), "");
      assert.equal(await page.getByRole("button", { name: "Save", exact: true }).isEnabled(), false);
      await page.getByLabel("PIN", { exact: true }).fill("5678");
      await page.getByRole("button", { name: "Reset", exact: true }).click();
      await page.waitForFunction(() => window.pinCalls.length === 1);
      const reset = await page.evaluate(() => window.pinCalls[0]);
      assert.equal(reset.reset_staff_id, "a");
      assert.equal(reset.new_passcode_a, "5678");
      assert.deepEqual(await page.evaluate(() => window.calls), []);
      await page.getByLabel("PIN", { exact: true }).fill("");
      // Switching clean editors opens exactly one, including hidden staff.
      await page.getByRole("button", { name: "Edit", exact: true }).nth(1).click();
      assert.equal(await page.getByRole("form", { name: "Edit staff" }).count(), 1);
      assert.equal(await page.getByLabel("Nickname", { exact: true }).inputValue(), "Taylor");
      await page.getByLabel("Nickname", { exact: true }).fill("Taylor draft");
      page.once("dialog", dialog => dialog.dismiss());
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      assert.equal(await page.getByLabel("Nickname", { exact: true }).inputValue(), "Taylor draft");
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      assert.equal(await page.getByLabel("Nickname", { exact: true }).inputValue(), "Tracy");
      await search.fill("Hidden");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      assert.equal(await page.getByRole("form", { name: "Edit staff" }).count(), 1);
      assert.equal(await page.getByLabel("Nickname", { exact: true }).inputValue(), "Hidden Person");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await search.fill("");
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      await page.getByLabel("Nickname", { exact: true }).fill("Tracy Updated");
      await page.getByLabel("Phone", { exact: true }).fill("5558888");
      // No persisted data changes before an explicit save.
      assert.equal(requests, 0);
      assert.deepEqual(await page.evaluate(() => window.calls), []);
      for (const width of [320, 375, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Overflow at ${width}px`);
        const target = join(repo, "artifacts", "staff-inline-20261017");
        mkdirSync(target, { recursive: true });
        await page.screenshot({ path: join(target, `${width}-edit.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 375, height: 812 });
      const editorHeight = await page.getByRole("form", { name: "Edit staff" }).evaluate(el => el.getBoundingClientRect().height);
      assert.ok(editorHeight < 420, `Editor too tall: ${editorHeight}px`);
      await page.evaluate(() => { window.failSave = true; });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
      assert.equal(await page.getByLabel("Nickname", { exact: true }).inputValue(), "Tracy Updated");
      assert.deepEqual(await page.evaluate(() => window.calls), []);
      await page.evaluate(() => { window.failSave = false; window.delaySave = true; });
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.waitForFunction(() => Boolean(window.finishSave) && document.getElementById("staff-search").disabled);
      assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).isEnabled(), false);
      assert.equal(await page.getByRole("button", { name: "Edit", exact: true }).first().isEnabled(), false);
      assert.equal(await search.isEnabled(), false);
      await page.evaluate(() => { window.finishSave(); });
      await page.waitForFunction(() => window.calls.length === 1);
      const saved = await page.evaluate(() => window.calls[0]);
      assert.equal(saved.display_name_a, "Tracy Updated");
      assert.equal(saved.phone_a, "5558888");
      assert.equal(saved.staff_id, "a");
      assert.equal(saved.job_title_a, "Nail technician");
      assert.equal(saved.pos_enabled_a, "on");
      assert.equal(saved.online_booking_enabled_a, "on");
      assert.equal(saved.salon_profile_content_posting_enabled_a, "on");
      assert.equal(saved.display_name_b, undefined);
      assert.equal(await page.getByRole("form", { name: "Edit staff" }).count(), 0);
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      await page.getByLabel("Nickname", { exact: true }).fill("Cancel after save");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      assert.equal(await page.getByLabel("Nickname", { exact: true }).inputValue(), "Tracy Updated");
      await page.getByRole("button", { name: "Edit", exact: true }).nth(1).click();
      assert.equal(await page.getByLabel("Nickname", { exact: true }).inputValue(), "Taylor");
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);

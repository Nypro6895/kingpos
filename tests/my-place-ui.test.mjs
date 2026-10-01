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
  "My Place browser: inline operations, retained drafts, workspace isolation and mobile layout",
  {
    skip: !process.env.ESBUILD_MODULE_PATH || !process.env.TEST_BROWSER_PATH,
    timeout: 120_000,
  },
  async () => {
    const { build } = await import(
      pathToFileURL(process.env.ESBUILD_MODULE_PATH).href
    );
    const repo = resolve(".").replaceAll("\\", "/");
    const scratch = mkdtempSync(join(tmpdir(), "kingpos-my-place-ui-"));
    const output = resolve("artifacts/my-place-qa");
    mkdirSync(output, { recursive: true });
    const entry = join(scratch, "entry.tsx");
    writeFileSync(
      entry,
      `
    import React,{useEffect,useReducer} from 'react';
    import {createRoot} from 'react-dom/client';
    import {MyPlaceClient} from '${repo}/app/my-place/my-place-client';
    const action=(id,label,href)=>({id,label,href});
    const base={accountId:'account-a',accountName:'King Nails Group',avatarUrl:null,businessId:null,businessMode:null,businessName:null,description:null,roleCode:'OWNER',roleLabel:'Owner',salonCount:1,secondaryAction:null};
    const account={...base,id:'account:account-a',type:'account',label:'King Nails Group',salonId:null,salonMode:null,defaultHref:'/salons',primaryAction:action('overview','Salons','/salons'),menuActions:[action('create-salon','Create Salon','/salons/new')],quickActions:[]};
    const workspace={...base,id:'salon:salon-a',type:'salon',label:'King Nails',salonId:'salon-a',salonName:'King Nails',salonMode:'manage',defaultHref:'/staff/today',primaryAction:action('open','Open','/staff/today'),menuActions:[],quickActions:[action('today','Today','/staff/today'),action('book','Book','/bookings'),action('salon-settings','Salon Settings','/salon-settings'),action('profile','Profile','/salon-profile'),action('services','Services','/services'),action('staff','Staff','/staff'),action('pos','POS','/pos')]};
    const salon={id:'salon-a',name:'King Nails',phone:'5551234567',address_line1:'120 Main Street',address_line2:null,city:'Austin',state:'TX',postal_code:'78701',country:'US',status:'active'};
    window.fixture={user:{id:'user-a',email:'owner@example.test',phone:'+15551234567',display_name:'Nene',first_name:'Nene',last_name:'',avatar_url:null,status:'active',language:'en',timezone:'America/Chicago',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'},phoneVerified:true,currentWorkspace:workspace,workspaceOptions:[workspace,account],salons:[salon],requests:{ok:true,data:[{id:'request-a',kind:'review',label:'King Nails',detail:'Taylor · Nail technician',message:'I would like to join.',status:'pending',createdAt:'2026-09-23T12:00:00Z',expiresAt:null}]}};
    window.members={canManage:true,roles:[{id:'owner',name:'Owner',code:'OWNER',permissions:[]},{id:'manager',name:'Manager',code:'MANAGER',permissions:['staff.manage']}],members:[{id:'member-owner',name:'Nene',email:'owner@example.test',roleId:'owner',roleCode:'OWNER',status:'active',isSelf:true},{id:'member-two',name:'Taylor',email:'taylor@example.test',roleId:'manager',roleCode:'MANAGER',status:'active',isSelf:false}]};
    window.calls=[];
    function App(){const [,refresh]=useReducer(x=>x+1,0);useEffect(()=>{window.addEventListener('fixture-refresh',refresh);return()=>window.removeEventListener('fixture-refresh',refresh)},[]);return <MyPlaceClient {...window.fixture}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  `,
    );
    const actions = `
    const ok=data=>({ok:true,data});
    const call=(name,args)=>{window.calls.push({name,args});if(window.failNext===name){window.failNext=null;return {ok:false,message:'Please correct the details and try again.'};}return null;};
    const form=f=>Object.fromEntries(f);
    export async function getPlaceSalon(id){return call('loadSalon',id)||ok({salon:window.fixture.salons.find(s=>'salon:'+s.id===id),canEdit:true,canEditLogo:true});}
    export async function createPlaceSalon(f){const values=form(f),error=call('create',values);if(error)return error;return ok({salonId:'new-salon'});}
    export async function savePlaceSalon(id,f){const values=form(f),error=call('saveSalon',{id,...values});if(error)return error;Object.assign(window.fixture.salons[0],values);return ok(null);}
    export async function savePlaceLogo(id,path){return call('saveLogo',{id,path})||ok(null);}
    export async function getPlaceAccount(id){return call('loadAccount',id)||ok(structuredClone(window.members));}
    export async function savePlaceMember(id,f){const values=form(f),error=call('member',{id,...values});if(error)return error;return ok(null);}
    export async function respondPlaceRequest(id,operation){call('request',{id,operation});window.fixture.requests.data=window.fixture.requests.data.map(r=>r.id===id?{...r,status:'accepted'}:r);return ok(null);}
    export async function searchPlaceSalons(query){return call('search',query)||ok([{salon_id:'other-salon',salon_name:'Garden Nails',address_line1:'50 Oak St',city:'Austin',state:'TX'}]);}
    export async function getPlaceLifecycleReview(id){return ok({status:window.fixture.salons[0].status==='active'?'active':'disabled',counts:{futureBookings:2,pendingBookings:1,openPosTickets:1}});}
    export async function setPlaceSalonActivity(id,f){call('activity',{id,...form(f)});window.fixture.salons[0].status=f.get('operation')==='pause'?'disabled':'active';return ok(null);}
    export async function applyToPlaceSalon(f){return call('apply',form(f))||ok(null);}
  `;
    const bundle = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      nodePaths: [join(repo, "node_modules")],
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "fixtures",
          setup(b) {
            b.onResolve({ filter: /^next\/navigation$/ }, () => ({
              path: "navigation",
              namespace: "fixture",
            }));
            b.onResolve({ filter: /^next\/link$/ }, () => ({
              path: "link",
              namespace: "fixture",
            }));
            b.onResolve({ filter: /actions$/ }, (args) => {
              if (
                args.path.includes("/account/") ||
                args.importer.includes("account-profile-editor")
              )
                return { path: "account-actions", namespace: "fixture" };
              if (args.path.includes("salon-profile"))
                return { path: "media", namespace: "fixture" };
              if (args.path.includes("salons/"))
                return { path: "workspace", namespace: "fixture" };
              if (args.importer.includes("my-place"))
                return { path: "actions", namespace: "fixture" };
            });
            b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
              resolveDir: repo,
              contents:
                path === "link"
                  ? `import React from 'react'; export default function Link({prefetch,children,...props}){return React.createElement('a',props,children);}`
                  : path === "account-actions"
                    ? `
                    export async function getAccountAvatarUploadSessionAction(){throw new Error('Not used');}
                    export async function updateAccountProfileAction(input){window.calls.push({name:'personal',args:input});return {error:null,phoneClaim:{status:'verification_required',normalizedPhone:input.phone,canSendOtp:true,resendCooldownSeconds:30}};}
                    export async function sendAccountPhoneVerificationOtpAction(){return {error:null};}
                    export async function verifyAccountPhoneOtpAction(){return {error:null};}
                  `
                    : path === "actions"
                      ? actions
                      : path === "navigation"
                        ? `export const useRouter=()=>({refresh:()=>window.dispatchEvent(new Event('fixture-refresh')),push:href=>window.calls.push({name:'navigate',args:href})});`
                        : path === "workspace"
                          ? `export async function switchWorkspaceDestination(args){window.calls.push({name:'switch',args});return {ok:true,href:args.destinationHref};}`
                          : `export async function getSalonProfileMediaUploadSessionAction(intent,kind,id){window.calls.push({name:'uploadSession',args:{intent,kind,id}});return {supabaseUrl:location.origin,accessToken:'fixture',anonKey:'fixture',bucket:'logos',path:'salon-a/test.webp'};}`,
            }));
          },
        },
      ],
    });
    const css = await postcss([tailwind({ base: repo })]).process(
      `@import "tailwindcss" source(none); @source "${repo}/app/my-place"; @source "${repo}/app/account/account-profile-editor.tsx"; body {font-family:Arial,sans-serif;background:#fff;margin:0}`,
      { from: join(repo, "my-place-qa.css") },
    );
    const server = createServer((req, res) => {
      if (req.url === "/bundle.js") {
        res.setHeader("Content-Type", "text/javascript");
        res.end(bundle.outputFiles[0].text);
      } else if (req.url === "/style.css") {
        res.setHeader("Content-Type", "text/css");
        res.end(css.css);
      } else if (req.url.startsWith("/storage/")) {
        res.end("{}");
      } else {
        res.setHeader("Content-Type", "text/html");
        res.end(
          '<html><head><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
        );
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const browser = await chromium.launch({
      executablePath: process.env.TEST_BROWSER_PATH,
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/my-place`);
      await page
        .getByRole("heading", { name: "My Place", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Find a salon", exact: true })
          .count(),
        1,
      );
      const sections = await page
        .getByRole("heading", { level: 2 })
        .allTextContents();
      assert.deepEqual(
        sections.map((s) => s.replace(/\s*\d+$/, "").trim()),
        ["Personal", "Staff", "Salon / Business"],
      );
      const staffSection = page
        .locator("section")
        .filter({ has: page.getByRole("heading", { name: /^Staff/ }) });
      assert.equal(
        await staffSection
          .getByRole("link", { name: "Portable", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await page
          .getByRole("navigation", { name: "Shortcuts for King Nails" })
          .getByRole("link", { name: "Portable", exact: true })
          .count(),
        1,
      );
      await page.getByRole("button", { name: "Details", exact: true }).click();
      await page
        .getByRole("button", { name: "Edit details", exact: true })
        .waitFor();
      assert.equal(
        await page.getByText("Open workspace tools", { exact: true }).count(),
        0,
      );
      await page.getByRole("dialog").click({ position: { x: 20, y: 100 } });
      assert.equal(await page.getByRole("dialog").isVisible(), true);
      await page.mouse.click(10, 200);
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Details", exact: true }).click();
      await page
        .getByRole("button", { name: "Edit details", exact: true })
        .click();
      await page
        .getByLabel("Salon name", { exact: false })
        .fill("Unsaved salon draft");
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.mouse.click(10, 200);
      assert.equal(await page.getByRole("dialog").isVisible(), true);
      page.once("dialog", (dialog) => dialog.accept());
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await page.getByText(/^Verified/).isVisible(), true);
      const hours = new URL(
        await page
          .getByRole("link", { name: "Working hours", exact: true })
          .getAttribute("href"),
        "https://test.invalid",
      );
      assert.equal(hours.searchParams.get("workspace_id"), "salon:salon-a");
      assert.equal(
        hours.searchParams.get("destination"),
        "/salon-settings#operating-hours",
      );
      await page.getByRole("switch").click();
      await page
        .getByText("2 upcoming appointments", { exact: true })
        .waitFor();
      await page.getByRole("button", { name: "Close panel" }).click();
      assert.equal(
        await page.evaluate(
          () => window.calls.filter((c) => c.name === "activity").length,
        ),
        0,
      );
      await page.getByRole("switch").click();
      await page.getByRole("checkbox").check();
      await page
        .getByRole("button", { name: "Pause salon", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(
        await page.getByRole("switch").getAttribute("aria-checked"),
        "false",
      );
      await page.getByRole("switch").click();
      await page.getByRole("checkbox").check();
      await page
        .getByRole("button", { name: "Reactivate salon", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(
        await page.getByRole("switch").getAttribute("aria-checked"),
        "true",
      );
      await page.screenshot({
        path: join(output, "desktop.png"),
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Create salon", exact: false })
        .click();
      await page.getByLabel("Salon name").fill("New salon");
      await page.getByLabel("Phone", { exact: true }).fill("5559998888");
      await page.evaluate(() => (window.failNext = "create"));
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Create salon", exact: true })
        .click();
      await page.getByRole("alert").waitFor();
      assert.equal(
        await page.getByLabel("Salon name").inputValue(),
        "New salon",
      );
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Create salon", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      const creates = await page.evaluate(() =>
        window.calls.filter((c) => c.name === "create"),
      );
      assert.equal(creates.length, 2);
      assert.equal(
        creates[0].args.create_request_key,
        creates[1].args.create_request_key,
      );
      assert.equal(creates[0].args.workspace_id, "account:account-a");
      await page.getByRole("button", { name: "Details", exact: true }).click();
      await page
        .getByRole("button", { name: "Edit details", exact: true })
        .click();
      await page.getByLabel("Salon name").fill("King Nails Updated");
      await page.evaluate(() => (window.failNext = "saveSalon"));
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.getByRole("dialog").getByRole("alert").waitFor();
      assert.equal(
        await page.getByLabel("Salon name").inputValue(),
        "King Nails Updated",
      );
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Edit details", exact: true })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => window.calls.find((c) => c.name === "saveSalon").args.id,
        ),
        "salon:salon-a",
      );
      await page.getByLabel("Upload salon logo").setInputFiles({
        name: "logo.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          await page.evaluate(() => {
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 20;
            canvas.getContext("2d").fillRect(0, 0, 20, 20);
            return canvas.toDataURL("image/png").split(",")[1];
          }),
          "base64",
        ),
      });
      await page.waitForFunction(() =>
        window.calls.some((c) => c.name === "saveLogo"),
      );
      await page.getByRole("button", { name: "Close panel" }).click();
      await page
        .getByText("Business accounts & access", { exact: true })
        .click();
      await page
        .getByRole("button", { name: /King Nails Group.*Manage/ })
        .click();
      await page
        .getByRole("button", { name: "Invite member", exact: true })
        .click();
      await page.getByLabel("Member’s Reylumi email").fill("new@example.test");
      await page.evaluate(() => (window.failNext = "member"));
      await page
        .getByRole("button", { name: "Create invitation", exact: true })
        .click();
      await page.getByRole("alert").waitFor();
      assert.equal(
        await page.getByLabel("Member’s Reylumi email").inputValue(),
        "new@example.test",
      );
      await page
        .getByRole("button", { name: "Create invitation", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Invite member", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "Save role", exact: true })
        .click();
      await page.waitForFunction(() =>
        window.calls.some(
          (c) => c.name === "member" && c.args.operation === "role",
        ),
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Save role", exact: true })
          .count(),
        1,
      );
      await page.getByRole("button", { name: "Approve", exact: true }).click();
      await page
        .getByText(/Requests & invitations/)
        .waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "Find a salon", exact: true })
        .click();
      await page.getByLabel("Salon name or address").fill("Garden");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("button", { name: /Garden Nails/ }).click();
      await page.getByLabel("Position / job title").fill("Nail technician");
      await page
        .getByLabel("Message", { exact: true })
        .fill("Experienced technician");
      await page
        .getByRole("button", { name: "Send application", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(
        await page.evaluate(
          () => window.calls.find((c) => c.name === "apply").args.salon_id,
        ),
        "other-salon",
      );
      assert.equal(
        await page.evaluate(
          () =>
            window.calls.filter(
              (c) => c.name === "switch" || c.name === "navigate",
            ).length,
        ),
        0,
      );
      await page.getByLabel("Search My Place").fill("no-match-at-all");
      assert.equal(
        await page.getByText("No matching salons.").isVisible(),
        true,
      );
      await page.getByLabel("Clear search").click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: join(output, "mobile.png"),
        fullPage: true,
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.getByRole("button", { name: "Details", exact: true }).click();
      await page
        .getByRole("button", { name: "Edit details", exact: true })
        .click();
      await page.screenshot({
        path: join(output, "mobile-edit.png"),
        fullPage: true,
      });
      assert.equal(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await page.getByRole("button", { name: "Close panel" }).click();
      await page
        .getByRole("button", { name: "Open workspace", exact: true })
        .click();
      await page.waitForFunction(() =>
        window.calls.some((c) => c.name === "switch"),
      );
      await page.evaluate(() => {
        window.fixture.phoneVerified = false;
        window.fixture.user.updated_at = "2026-09-23T15:00:00Z";
        window.dispatchEvent(new Event("fixture-refresh"));
      });
      await page
        .getByRole("button", { name: "Verify phone", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
      assert.equal(
        await page.evaluate(
          () => window.calls.find((c) => c.name === "personal").args.phone,
        ),
        "+15551234567",
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((r) => server.close(r));
    }
  },
);

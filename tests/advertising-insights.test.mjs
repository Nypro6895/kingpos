import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
const enabled = Boolean(process.env.ESBUILD_MODULE_PATH);
test(
  "signed attribution rejects tampering and counts only genuinely new accounts",
  { skip: !enabled },
  async () => {
    const { build } = await import(
      pathToFileURL(process.env.ESBUILD_MODULE_PATH).href
    );
    const built = await build({
      entryPoints: ["lib/advertising-attribution.ts"],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      plugins: [
        {
          name: "server",
          setup(b) {
            b.onResolve(
              { filter: /^(server-only|@\/lib\/explore-advertising)$/ },
              (a) => ({ path: a.path, namespace: "stub" }),
            );
            b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
              loader: "js",
              contents:
                a.path === "server-only"
                  ? ""
                  : `export const advertisingClient=()=>({rpc:async(name,args)=>{globalThis.conversions.push(args);return {error:null};}});`,
            }));
          },
        },
      ],
    });
    const { signAdAttribution, readAdAttribution, recordAdvertisingSignup } =
      await import(
        "data:text/javascript;base64," +
          Buffer.from(built.outputFiles[0].text).toString("base64")
      );
    const old = process.env.ADVERTISING_IP_HASH_SECRET;
    process.env.ADVERTISING_IP_HASH_SECRET = "test-attribution";
    globalThis.conversions = [];
    try {
      const attribution = {
        id: "1650370b-f86d-461e-8d97-6210052eeed7",
        session: "2650370b-f86d-461e-8d97-6210052eeed7",
        device: "mobile",
        audience: "guest",
        path: "/explore",
        at: Date.now(),
      };
      const token = signAdAttribution(attribution);
      assert.deepEqual(readAdAttribution(token), attribution);
      assert.equal(readAdAttribution(token + "x"), null);
      assert.equal(
        readAdAttribution(
          signAdAttribution({ ...attribution, at: Date.now() - 8 * 86400000 }),
        ),
        null,
      );
      const request = new Request("https://example.test/signup", {
        headers: { cookie: "reylumi-ad-attribution=" + token },
      });
      await recordAdvertisingSignup(request, {
        id: "new-user",
        created_at: new Date().toISOString(),
        identities: [{}],
      });
      assert.equal(globalThis.conversions.length, 1);
      assert.equal(globalThis.conversions[0].p_kind, "signup");
      await recordAdvertisingSignup(request, {
        id: "existing",
        created_at: "2020-01-01T00:00:00Z",
        identities: [{}],
      });
      await recordAdvertisingSignup(request, {
        id: "obfuscated",
        created_at: new Date().toISOString(),
        identities: [],
      });
      assert.equal(globalThis.conversions.length, 1);
    } finally {
      if (old === undefined) delete process.env.ADVERTISING_IP_HASH_SECRET;
      else process.env.ADVERTISING_IP_HASH_SECRET = old;
    }
  },
);
test(
  "report filters compute rates and preview changes devices without recording activity",
  { skip: !enabled || !process.env.TEST_BROWSER_PATH },
  async () => {
    const { build } = await import(
      pathToFileURL(process.env.ESBUILD_MODULE_PATH).href
    );
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
    }).format(new Date());
    const built = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {CampaignManager} from './app/(app)/admin/advertising/campaign-manager';window.tracked=0;window.fetch=()=>{window.tracked++;throw new Error('Preview must not track');};const campaign={id:'1650370b-f86d-461e-8d97-6210052eeed7',name:'October welcome',kind:'popup',enabled:true,href:'/signup',imageUrl:'',text:'Find your next favorite salon',background:'#fff0e8',color:'#302326',delaySeconds:8,durationSeconds:15,closeButton:true,repeat:'daily',position:'top',speedSeconds:25,startsAt:null,endsAt:null,audiences:['guest'],devices:['mobile','desktop'],locations:['/explore']};createRoot(document.getElementById('root')).render(<CampaignManager initialCampaigns={[campaign]} error="" report={[{campaign_id:campaign.id,day:'${today}',device:'mobile',audience:'guest',views:10,clicks:2,signups:1}]}/>);`,
      },
      bundle: true,
      write: false,
      outfile: "fixture.js",
      jsx: "automatic",
      plugins: [
        {
          name: "server",
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
                  ? `export const usePathname=()=>'/admin/advertising';export const useRouter=()=>({refresh(){}});`
                  : a.path.endsWith("/browser")
                    ? `export const createSupabaseBrowserClient=()=>null;`
                    : `export const saveCampaignAction=async()=>({ok:true});export const deleteCampaignAction=async()=>{};export const campaignImageUploadAction=async()=>{};export const saveAdvertisingLimitsAction=async()=>({ok:true,message:'Limits saved'});`,
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
        viewport: { width: 1200, height: 1000 },
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await page.getByRole("button", { name: "Reports & limits" }).click();
      await page
        .getByRole("heading", { name: "Performance", exact: true })
        .waitFor();
      const row = page.getByRole("row").filter({ hasText: "October welcome" });
      assert.match(await row.innerText(), /20.0%/);
      assert.match(await row.innerText(), /50.0%/);
      await page.getByLabel("Device").selectOption("desktop");
      await page
        .getByText("No tracked activity in this period.", { exact: false })
        .waitFor();
      await page.getByLabel("Device").selectOption("all");
      fs.mkdirSync(".next-advertising-build/review", { recursive: true });
      await page.screenshot({
        path: ".next-advertising-build/review/insights-desktop.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: /^Running/ }).click();
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      const preview = page.getByRole("region", { name: "Campaign preview" });
      await preview.waitFor();
      assert.equal(await preview.getByRole("link").count(), 0);
      await preview.getByLabel("Audience").selectOption("staff");
      await preview
        .getByText("This campaign will not appear for this selection.", {
          exact: true,
        })
        .waitFor();
      await preview.getByLabel("Audience").selectOption("guest");
      await preview.getByLabel("Device").selectOption("desktop");
      await preview
        .getByText("Matches the selected audience, device and page.", {
          exact: true,
        })
        .waitFor();
      await page.screenshot({
        path: ".next-advertising-build/review/preview-desktop.png",
        fullPage: true,
      });
      await preview.getByLabel("Device").selectOption("mobile");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: ".next-advertising-build/review/preview-mobile.png",
        fullPage: true,
      });
      await preview.getByRole("button", { name: "Close preview" }).click();
      await page
        .getByRole("button", { name: "+ Create campaign", exact: true })
        .click();
      await page.getByLabel("Campaign name").fill("Draft GIF");
      await page
        .locator('input[name="image"]')
        .setInputFiles({
          name: "preview.gif",
          mimeType: "image/gif",
          buffer: Buffer.from(
            "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
            "base64",
          ),
        });
      await page
        .getByRole("button", { name: "Preview draft", exact: true })
        .click();
      const draft = page.getByRole("region", { name: "Campaign preview" });
      await draft.waitFor();
      assert.match(await draft.locator("img").getAttribute("src"), /^blob:/);
      assert.equal(
        await page.getByLabel("Campaign name").inputValue(),
        "Draft GIF",
      );
      assert.equal(await page.evaluate(() => window.tracked), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  },
);

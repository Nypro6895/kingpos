import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import { chromium } from "playwright-core";
const enabled = Boolean(
  process.env.ESBUILD_MODULE_PATH && process.env.TEST_BROWSER_PATH,
);
async function fixture(run, options = {}) {
  const { build } = await import(
    pathToFileURL(process.env.ESBUILD_MODULE_PATH).href
  );
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
  import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
  import {ExploreAdvertising,ExploreAdSlot} from './components/explore-advertising';
  import {ExploreAccountActionsProvider,ExploreBookButton,ExploreSalonLove} from './components/explore-account-actions';
  function App(){const [auth,setAuth]=useState(false);window.authenticate=()=>setAuth(true);return <ExploreAccountActionsProvider authenticated={auth}><ExploreAdvertising audience={${JSON.stringify(options.audience ?? "guest")}}><h1>Explore</h1>${options.positions ? '<ExploreAdSlot position="page-top"/><ExploreAdSlot position="page-bottom"/>' : ""}<div style={{width:220}}><ExploreAdSlot desktop/></div>${options.allSlots ? "<div data-feed-slots><ExploreAdSlot slotIndex={0}/><ExploreAdSlot slotIndex={1}/><ExploreAdSlot slotIndex={2}/><ExploreAdSlot slotIndex={3}/></div>" : "<ExploreAdSlot/>"}${options.scroll ? "<div style={{height:5000}}>Scroll content</div>" : ""}<ExploreBookButton name="Quiet Nails" contactHref="/salon" phoneHref="tel:+15555550100"/><ExploreSalonLove name="Quiet Nails" salonId="1650370b-f86d-461e-8d97-6210052eeed7"/></ExploreAdvertising></ExploreAccountActionsProvider>};createRoot(document.getElementById('root')).render(<App/>);
 `,
    },
    bundle: true,
    write: false,
    outfile: "fixture.js",
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    plugins: [
      {
        name: "test-deps",
        setup(builder) {
          builder.onResolve(
            { filter: /^next\/(navigation|link)$/ },
            (args) => ({ path: args.path, namespace: "stub" }),
          );
          builder.onResolve(
            {
              filter:
                /^@\/app\/(salon-profile\/actions|explore\/account-actions|saved-post\/actions)$/,
            },
            (args) => ({ path: args.path, namespace: "stub" }),
          );
          builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            loader: "js",
            resolveDir: process.cwd(),
            contents:
              args.path === "next/navigation"
                ? `export const usePathname=()=>window.location.pathname;`
                : args.path === "next/link"
                  ? `import React from 'react';export default function Link(props){return React.createElement('a',props,props.children);}`
                  : `export const salonLoveAction=async(id,active)=>({active:active??false,error:null});export const referenceLoveAction=salonLoveAction;export const setAccountSavedPostAction=async()=>({active:true,error:null});`,
          }));
        },
      },
    ],
  });
  const base = {
    enabled: true,
    href: "/offer",
    imageUrl: "/ad.png",
    text: "A lovely first visit",
    background: "#fff0e8",
    color: "#302326",
    delaySeconds: 0,
    durationSeconds: 0,
    closeButton: true,
    repeat: "daily",
    position: "bottom",
    speedSeconds: 10,
    startsAt: null,
    endsAt: null,
  };
  let claims = 0;
  const campaigns = options.campaigns ?? [
    { ...base, id: "a", kind: "placement", name: "Offer A" },
    { ...base, id: "b", kind: "placement", name: "Offer B" },
    {
      ...base,
      id: "popup",
      kind: "popup",
      name: "Welcome gift",
      delaySeconds: 0.2,
      durationSeconds: 1,
    },
    { ...base, id: "ticker", kind: "ticker", name: "Notice" },
  ];
  const server = createServer(async (req, res) => {
    if (req.url === "/bundle.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(bundle.outputFiles.find((f) => f.path.endsWith(".js")).text);
    } else if (req.url === "/bundle.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(
        bundle.outputFiles.find((f) => f.path.endsWith(".css"))?.text ?? "",
      );
    } else if (req.url === "/ad.png") {
      res.setHeader("Content-Type", "image/png");
      res.end(fs.readFileSync("public/brand/reylumi-favicon.png"));
    } else if (req.url.startsWith("/api/explore/advertising")) {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST") {
        let body = "";
        for await (const chunk of req) body += chunk;
        const event = JSON.parse(body);
        if (
          event.event === "view" &&
          (event.id === "popup" || event.id === "scroll")
        ) {
          claims++;
          res.end(JSON.stringify({ allowed: claims === 1 }));
        } else res.end(JSON.stringify({ allowed: true }));
      } else res.end(JSON.stringify({ campaigns }));
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<html><link rel="stylesheet" href="/bundle.css"><body><div id="root"></div><script src="/bundle.js"></script></body></html>',
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    executablePath: process.env.TEST_BROWSER_PATH,
    headless: true,
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `http://127.0.0.1:${server.address().port}${options.path ?? "/explore"}`,
    );
    await run(page, () => claims);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
test(
  "popup delay, automatic close, random rotation and mobile feed rendering",
  { skip: !enabled },
  () =>
    fixture(async (page, claims) => {
      await page
        .getByRole("link", { name: "A lovely first visit", exact: true })
        .waitFor();
      assert.equal(claims(), 0, "announcement must precede popup");
      await page.getByRole("dialog", { name: "Welcome gift" }).waitFor();
      assert.equal(claims(), 1);
      fs.mkdirSync(".next/advertising-review", { recursive: true });
      await page.screenshot({
        path: ".next/advertising-review/mobile-popup.png",
      });
      await page
        .getByRole("dialog", { name: "Welcome gift" })
        .waitFor({ state: "hidden" });
      let first = await page
        .locator('aside[aria-label="Advertisement"] a')
        .first()
        .getAttribute("aria-label");
      assert.equal(
        await page
          .getByRole("link", { name: "A lovely first visit", exact: true })
          .isVisible(),
        true,
      );
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
      first = await page
        .locator('aside[aria-label="Advertisement"] a')
        .first()
        .getAttribute("aria-label");
      await page.screenshot({ path: ".next/advertising-review/desktop.png" });
      await page.reload();
      await page
        .locator('aside[aria-label="Advertisement"] a')
        .first()
        .waitFor();
      const second = await page
        .locator('aside[aria-label="Advertisement"] a')
        .first()
        .getAttribute("aria-label");
      assert.notEqual(second, first);
    }),
);
test(
  "guest Book offers signup/login and resumes with contact notice after authentication",
  { skip: !enabled },
  () =>
    fixture(async (page) => {
      await page.getByRole("dialog", { name: "Welcome gift" }).waitFor();
      await page.getByRole("button", { name: "Close promotion" }).click();
      await page.getByRole("button", { name: "Book Quiet Nails" }).click();
      const prompt = page.getByRole("dialog", {
        name: "Your next beauty moment ✨",
      });
      await prompt.waitFor();
      assert.match(
        await prompt
          .getByRole("link", { name: "Create account" })
          .getAttribute("href"),
        /signup\?next=%2Fexplore/,
      );
      assert.equal(
        await prompt.getByRole("link", { name: "Login" }).count(),
        1,
      );
      await page.evaluate(() => window.authenticate());
      await page.getByRole("dialog", { name: "Contact salon" }).waitFor();
      assert.equal(
        await page
          .getByRole("link", { name: "Call salon" })
          .getAttribute("href"),
        "tel:+15555550100",
      );
    }),
);
test(
  "Love on a guest salon presents an account prompt",
  { skip: !enabled },
  () =>
    fixture(async (page) => {
      await page.getByRole("dialog", { name: "Welcome gift" }).waitFor();
      await page.getByRole("button", { name: "Close promotion" }).click();
      await page.getByRole("button", { name: "Love Quiet Nails" }).click();
      await page
        .getByRole("dialog", { name: "Keep this salon close ♡" })
        .waitFor();
    }),
);

test(
  "three mobile feed campaigns appear once and a fourth slot stays empty",
  { skip: !enabled },
  () =>
    fixture(
      async (page) => {
        for (let index = 0; index < 3; index++) {
          const slot = page.locator("[data-feed-slots] aside").nth(index);
          await slot.waitFor({ state: "attached" });
          await slot.scrollIntoViewIfNeeded();
          await slot.waitFor();
        }
        const names = await page
          .locator("[data-feed-slots] aside a")
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute("aria-label")),
          );
        assert.equal(names.length, 3);
        assert.equal(new Set(names).size, 3);
        await page.reload();
        for (let index = 0; index < 3; index++) {
          const slot = page.locator("[data-feed-slots] aside").nth(index);
          await slot.waitFor({ state: "attached" });
          await slot.scrollIntoViewIfNeeded();
          await slot.waitFor();
        }
        assert.equal(await page.locator("[data-feed-slots] aside").count(), 3);
      },
      {
        allSlots: true,
        campaigns: ["One", "Two", "Three"].map((name, index) => ({
          id: String(index),
          kind: "placement",
          name,
          href: "/offer",
          imageUrl: "/ad.png",
          background: "#ffffff",
          color: "#302326",
          delaySeconds: 0,
          durationSeconds: 0,
        })),
      },
    ),
);
test(
  "popup scroll stage waits until the visitor reaches the configured progress",
  { skip: !enabled },
  () =>
    fixture(
      async (page, claims) => {
        await page.waitForTimeout(250);
        assert.equal(claims(), 0);
        await page.evaluate(() =>
          window.scrollTo(0, document.documentElement.scrollHeight * 0.6),
        );
        await page.getByRole("dialog", { name: "After browsing" }).waitFor();
        assert.equal(claims(), 1);
      },
      {
        scroll: true,
        campaigns: [
          {
            id: "scroll",
            kind: "popup",
            name: "After browsing",
            href: "",
            imageUrl: "",
            text: "Welcome",
            background: "#ffffff",
            color: "#302326",
            delaySeconds: 0,
            durationSeconds: 0,
            closeButton: true,
            popupTrigger: "scroll",
            scrollPercent: 35,
          },
        ],
      },
    ),
);

test(
  "owner-only campaign appears in chosen page positions and stays hidden from guests",
  { skip: !enabled },
  async () => {
    const campaign = {
      id: "owner-banner",
      kind: "placement",
      name: "Owner update",
      href: "",
      imageUrl: "",
      text: "Workspace news",
      background: "#ffffff",
      color: "#302326",
      delaySeconds: 0,
      durationSeconds: 0,
      audiences: ["owner"],
      locations: ["/bookings", "/staff"],
      devices: ["mobile"],
      placements: ["page-top", "page-bottom"],
    };
    await fixture(
      async (page) => {
        await page.getByLabel("Owner update").first().waitFor();
        assert.equal(await page.getByLabel("Owner update").count(), 2);
      },
      {
        path: "/bookings",
        audience: "owner",
        positions: true,
        campaigns: [campaign],
      },
    );
    await fixture(
      async (page) => {
        await page.waitForTimeout(300);
        assert.equal(await page.getByLabel("Owner update").count(), 0);
      },
      {
        path: "/bookings",
        audience: "guest",
        positions: true,
        campaigns: [campaign],
      },
    );
  },
);

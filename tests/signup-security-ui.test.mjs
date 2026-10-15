import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit } from "playwright-core";

const executablePath = process.env.TEST_BROWSER_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const challengeError = { status: 403, body: { error: "Please complete the security check.", code: "security_check_required", challengeRequired: true } };
const success = { body: { redirectTo: "/bookings?salon=fixture" } };

test("signup inline security check browser regressions", { timeout: 120000, skip: process.env.SIGNUP_TEST_BROWSER !== "webkit" && !existsSync(executablePath) }, async t => {
  const bundled = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{Activity,useState} from 'react'; import {createRoot} from 'react-dom/client';
import {SignupForm} from './app/signup/signup-form';
import {SecurityCheck} from './app/(app)/security-check/security-check';
import styles from './app/(app)/auth-screen.module.css';
window.redirects=[]; window.refreshes=0;
const root=createRoot(document.getElementById('root')); window.unmount=()=>root.unmount();
const standalone=new URLSearchParams(location.search).has('standalone');
function App(){const[visible,setVisible]=useState(true);window.setVisible=setVisible;return <Activity mode={visible?'visible':'hidden'}><main className={styles.authViewport}><div className={styles.authPanel}><div className={styles.authPanelInner}><section className={styles.authCard+' rounded-[1.5rem] bg-white'}><p className='text-xs font-extrabold uppercase text-brand-orange'>Join ReyLUMI</p><h1 className='mt-3 text-3xl font-semibold text-text-primary'>Create account</h1><p className='mt-3 text-sm leading-6 text-text-secondary'>Save favorites, book faster, and keep your beauty plans in one place.</p>{standalone?<SecurityCheck/>:<SignupForm nextPath='/bookings?salon=fixture'/>}</section></div></div></main></Activity>};root.render(<App/>);
` }, bundle: true, write: false, outdir: "fixture", jsx: "automatic", alias: { "@": process.cwd() },
    plugins: [{ name: "navigation", setup(b) {
      b.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: "stub" }));
      b.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ resolveDir: process.cwd(), loader: "tsx", contents: args.path.endsWith("link")
        ? "import React from 'react';export default function Link(props){return <a {...props}/>;}"
        : "export const useRouter=()=>({push:path=>window.redirects.push(path),refresh:()=>window.refreshes++});" }));
    } }],
  });
  const globals = readFileSync("app/globals.css", "utf8").replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./signup/signup-form.tsx";\n@source "../components/security-challenge.tsx";\n@source "./(app)/signup/page.tsx";\n@source "./(app)/security-check/security-check.tsx";');
  const css = (await postcss([tailwind()]).process(globals, { from: path.resolve("app/globals.css") })).css + bundled.outputFiles.find(file => file.path.endsWith(".css")).text;
  const js = bundled.outputFiles.find(file => file.path.endsWith(".js")).text;
  // Render fixture pixels through the real image renderer without creating a database challenge.
  const imageModule = {};
  vm.runInNewContext(ts.transpileModule(readFileSync("lib/security-challenge-image.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, { exports: imageModule, require: createRequire(import.meta.url), Buffer, process });
  const png = await imageModule.createSecurityChallengeImage("A7K3W9");
  const sample = { id: "12345678-1234-1234-1234-123456789012", image: `data:image/png;base64,${png.toString("base64")}` };
  const browser = process.env.SIGNUP_TEST_BROWSER === "webkit" ? await webkit.launch({ headless: true }) : await chromium.launch({ executablePath, headless: true });

  async function fixture(api = {}, query = "") {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const calls = { signup: [], load: [], verify: [] }, errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, "http://signup.test", "The fixture never contacts production or third parties");
      if (url.pathname.startsWith("/api/")) {
        const kind = url.pathname === "/api/auth/signup" ? "signup" : request.method() === "GET" ? "load" : "verify";
        calls[kind].push(request.postData());
        const result = await (api[kind]?.(calls[kind].length, request) ?? (kind === "load" ? { body: sample } : kind === "verify" ? { body: { ok: true } } : challengeError));
        if (result.abort) await route.abort("failed");
        else await route.fulfill({ status: result.status ?? 200, contentType: result.contentType ?? "application/json", body: result.raw ?? JSON.stringify(result.body) });
      } else await route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>` });
    });
    await page.goto(`http://signup.test/${query}`);
    await page.getByRole("heading", { name: "Create account", exact: true }).waitFor();
    async function fill() {
      await page.getByLabel("Display name", { exact: true }).fill("Fixture Person");
      await page.getByLabel("Email", { exact: true }).fill("signup-fixture@example.test");
      await page.getByLabel("Password", { exact: true }).fill("Test-only-password-123");
    }
    async function trigger() {
      await fill();
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await page.getByRole("img", { name: "Security image containing six letters and numbers" }).waitFor();
    }
    async function finish() { assert.deepEqual(errors, []); await page.close(); }
    return { page, calls, fill, trigger, finish };
  }

  try {
    await t.test("ordinary signup remains one request with no CAPTCHA, preserving return routing", async () => {
      const f = await fixture({ signup: () => success });
      await f.fill();
      await f.page.getByRole("button", { name: "Create account", exact: true }).evaluate(button => { button.click(); button.click(); });
      await f.page.waitForFunction(() => window.redirects.length === 1);
      assert.equal(f.calls.signup.length, 1); assert.equal(f.calls.load.length, 0);
      assert.match(f.calls.signup[0], /name="next"\r\n\r\n\/bookings\?salon=fixture/);
      assert.deepEqual(await f.page.evaluate(() => window.redirects), ["/bookings?salon=fixture"]);
      assert.equal(await f.page.evaluate(() => window.refreshes), 1);
      await f.finish();
    });

    await t.test("inline check fits 320/390/1280, enlarges without pinch, retains credentials and retries exactly once", async () => {
      let resolveVerify;
      const pendingVerify = new Promise(resolve => { resolveVerify = resolve; });
      const f = await fixture({ signup: n => n === 1 ? challengeError : success, verify: () => pendingVerify });
      await f.trigger();
      assert.equal(await f.page.locator("form").count(), 1);
      assert.equal(await f.page.getByRole("link", { name: "Open security check" }).count(), 0);
      assert.equal(await f.page.locator('input[aria-invalid="true"]').count(), 0);
      assert.equal(await f.page.getByRole("group", { name: "Quick security check" }).evaluate(el => el === document.activeElement), true);
      for (const width of [320, 390, 1280]) {
        await f.page.setViewportSize({ width, height: 844 });
        assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No page overflow at ${width}px`);
        await f.page.getByRole("button", { name: "Enlarge image", exact: true }).click();
        const enlarged = f.page.getByRole("region", { name: /Enlarged security image/ });
        assert.ok(await enlarged.evaluate(el => el.scrollWidth > el.clientWidth), "Image genuinely enlarges");
        await enlarged.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        assert.ok(await enlarged.evaluate(el => el.scrollLeft > 0));
        assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Enlarging stays within page width");
        await f.page.getByRole("button", { name: "Show full image" }).click();
        const submit = f.page.getByRole("button", { name: "Verify and create account" });
        await submit.scrollIntoViewIfNeeded();
        assert.ok(await submit.evaluate(el => {
          const box = el.getBoundingClientRect();
          return box.top >= 0 && box.bottom <= innerHeight + 1 && el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        }), "Verification stays reachable below the expanded form");
        if (process.env.SIGNUP_QA_DIR) {
          await mkdir(process.env.SIGNUP_QA_DIR, { recursive: true });
          await f.page.screenshot({ path: path.join(process.env.SIGNUP_QA_DIR, `signup-security-${width}.png`), fullPage: true });
        }
      }
      await f.page.getByLabel("Characters in the image", { exact: true }).fill("a7k3w9");
      await f.page.getByRole("button", { name: "Verify and create account" }).evaluate(button => { button.click(); button.click(); });
      await f.page.getByRole("button", { name: "Verifying…" }).waitFor();
      assert.equal(f.calls.verify.length, 1);
      assert.equal(await f.page.getByRole("button", { name: "Verifying…" }).isDisabled(), true);
      resolveVerify({ body: { ok: true } });
      await f.page.waitForFunction(() => window.redirects.length === 1);
      assert.equal(f.calls.signup.length, 2); assert.equal(f.calls.verify.length, 1);
      const originalFields = data => [...data.matchAll(/name="([^"]+)"\r\n\r\n([^\r]*)/g)].map(match => [match[1], match[2]]);
      assert.deepEqual(originalFields(f.calls.signup[1]), originalFields(f.calls.signup[0]));
      assert.equal(await f.page.getByLabel("Password", { exact: true }).inputValue(), "Test-only-password-123");
      assert.equal(await f.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      await f.finish();
    });

    await t.test("incorrect and expired answers stay inline; refresh failure clears stale image; retry can recover", async () => {
      const f = await fixture({ load: n => n === 2 ? { status: 503, body: { error: "Security check is temporarily unavailable." } } : { body: sample }, verify: () => ({ status: 400, body: { error: "Incorrect or expired check. Try again or request a new image." } }) });
      await f.trigger();
      await f.page.getByLabel("Characters in the image", { exact: true }).fill("123");
      await f.page.getByRole("button", { name: "Verify and create account" }).click();
      assert.equal(f.calls.verify.length, 0);
      await f.page.getByRole("alert").filter({ hasText: "Enter all six" }).waitFor();
      await f.page.getByLabel("Characters in the image", { exact: true }).fill("WRONG9");
      await f.page.getByLabel("Characters in the image", { exact: true }).press("Enter");
      await f.page.getByRole("alert").filter({ hasText: "Incorrect or expired" }).waitFor();
      assert.equal(f.calls.signup.length, 1);
      assert.equal(await f.page.getByLabel("Email", { exact: true }).getAttribute("aria-invalid"), null);
      await f.page.getByRole("button", { name: "Get a new image", exact: true }).click();
      await f.page.getByRole("alert").filter({ hasText: "temporarily unavailable" }).waitFor();
      assert.equal(await f.page.getByRole("img").count(), 0, "No stale image survives a failed refresh");
      assert.equal(await f.page.getByLabel("Characters in the image", { exact: true }).inputValue(), "");
      assert.equal(await f.page.getByRole("button", { name: "Verify and create account" }).isDisabled(), true);
      await f.page.getByRole("button", { name: "Try loading a new image" }).click();
      await f.page.getByRole("img").waitFor();
      assert.equal(await f.page.getByRole("button", { name: "Verify and create account" }).isDisabled(), false);
      assert.equal(await f.page.getByLabel("Display name", { exact: true }).inputValue(), "Fixture Person");
      await f.finish();
    });

    await t.test("legacy challenge response works and repeated challenge never auto-loops", async () => {
      const legacy = { status: 403, body: { error: "Please complete the security check at /security-check, then try again." } };
      const f = await fixture({ signup: () => legacy });
      await f.trigger();
      await f.page.getByLabel("Characters in the image", { exact: true }).fill("A7K3W9");
      await f.page.getByRole("button", { name: "Verify and create account" }).click();
      await f.page.waitForFunction(() => document.querySelector('input[autocomplete="off"]')?.value === "" && !document.querySelector('input[autocomplete="off"]')?.disabled);
      assert.equal(f.calls.signup.length, 2); assert.equal(f.calls.verify.length, 1); assert.equal(f.calls.load.length, 2);
      await f.finish();
    });

    await t.test("initial image failures and malformed verification never submit signup", async () => {
      const f = await fixture({ load: n => n === 1 ? { contentType: "text/html", raw: "<html>Provider security checkpoint</html>", status: 429 } : { body: sample }, verify: n => n === 1 ? { body: { ok: false } } : { status: 503, body: { error: "Security check is temporarily unavailable." } } });
      await f.fill(); await f.page.getByRole("button", { name: "Create account", exact: true }).click();
      await f.page.getByRole("alert").filter({ hasText: "Unable to complete" }).waitFor();
      assert.equal(await f.page.getByRole("img").count(), 0);
      assert.equal(await f.page.getByRole("button", { name: "Verify and create account" }).isDisabled(), true);
      await f.page.getByRole("button", { name: "Try loading a new image" }).click();
      await f.page.getByRole("img").waitFor();
      await f.page.getByLabel("Characters in the image", { exact: true }).fill("A7K3W9");
      await f.page.getByRole("button", { name: "Verify and create account" }).click();
      await f.page.getByRole("alert").filter({ hasText: "Unable to verify" }).waitFor();
      assert.equal(f.calls.signup.length, 1);
      await f.page.getByRole("button", { name: "Verify and create account" }).click();
      await f.page.getByRole("alert").filter({ hasText: "temporarily unavailable" }).waitFor();
      assert.equal(f.calls.signup.length, 1);
      assert.equal(await f.page.getByLabel("Characters in the image", { exact: true }).getAttribute("aria-invalid"), null, "Server outage does not blame the entered answer");
      await f.finish();
    });

    await t.test("rate limit and network failures do not demand CAPTCHA or mark every input invalid", async () => {
      for (const response of [{ status: 429, body: { error: "Too many account creations. Try again later.", code: "rate_limited" } }, { abort: true }]) {
        const f = await fixture({ signup: () => response });
        await f.fill(); await f.page.getByRole("button", { name: "Create account", exact: true }).click();
        await f.page.getByRole("alert").waitFor();
        assert.equal(f.calls.load.length, 0); assert.equal(await f.page.locator('input[aria-invalid="true"]').count(), 0);
        assert.equal(await f.page.getByRole("button", { name: "Create account", exact: true }).isDisabled(), false);
        assert.equal(await f.page.getByLabel("Password", { exact: true }).inputValue(), "Test-only-password-123");
        await f.finish();
      }
    });

    await t.test("unmount aborts a pending verification and cannot create an account later", async () => {
      let resolveVerify;
      const pendingVerify = new Promise(resolve => { resolveVerify = resolve; });
      const f = await fixture({ verify: () => pendingVerify });
      await f.trigger();
      await f.page.getByLabel("Characters in the image", { exact: true }).fill("A7K3W9");
      await f.page.getByRole("button", { name: "Verify and create account" }).click();
      await f.page.getByRole("button", { name: "Verifying…" }).waitFor();
      await f.page.evaluate(() => window.unmount());
      resolveVerify({ body: { ok: true } });
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(f.calls.signup.length, 1); assert.deepEqual(await f.page.evaluate(() => window.redirects), []);
      await f.finish();
    });

    await t.test("Activity hide/resume aborts pending signup without retaining a disabled form or replaying it", async () => {
      let resolveSignup;
      const pendingSignup = new Promise(resolve => { resolveSignup = resolve; });
      const f = await fixture({ signup: n => n === 1 ? pendingSignup : success });
      await f.fill(); await f.page.getByRole("button", { name: "Create account", exact: true }).click();
      await f.page.getByRole("button", { name: "Creating...", exact: true }).waitFor();
      await f.page.evaluate(() => window.setVisible(false));
      await f.page.locator("form").waitFor({ state: "hidden" });
      await f.page.evaluate(() => window.setVisible(true));
      await f.page.getByRole("button", { name: "Create account", exact: true }).waitFor();
      assert.equal(await f.page.getByRole("button", { name: "Create account", exact: true }).isDisabled(), false);
      resolveSignup(success);
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(f.calls.signup.length, 1); assert.deepEqual(await f.page.evaluate(() => window.redirects), []);
      assert.equal(await f.page.getByLabel("Password", { exact: true }).inputValue(), "Test-only-password-123");
      await f.page.getByRole("button", { name: "Create account", exact: true }).click();
      await f.page.waitForFunction(() => window.redirects.length === 1);
      assert.equal(f.calls.signup.length, 2);
      await f.finish();
    });

    await t.test("Activity hide/resume resets aborted CAPTCHA verification but preserves account fields", async () => {
      let resolveVerify;
      const pendingVerify = new Promise(resolve => { resolveVerify = resolve; });
      const f = await fixture({ signup: n => n === 1 ? challengeError : success, verify: n => n === 1 ? pendingVerify : { body: { ok: true } } });
      await f.trigger();
      await f.page.getByLabel("Characters in the image", { exact: true }).fill("A7K3W9");
      await f.page.getByRole("button", { name: "Verify and create account" }).click();
      await f.page.getByRole("button", { name: "Verifying…" }).waitFor();
      await f.page.evaluate(() => window.setVisible(false));
      await f.page.locator("form").waitFor({ state: "hidden" });
      await f.page.evaluate(() => window.setVisible(true));
      await f.page.waitForFunction(() => document.querySelector('input[autocomplete="off"]')?.value === "" && !document.querySelector('input[autocomplete="off"]')?.disabled);
      resolveVerify({ body: { ok: true } });
      await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(f.calls.signup.length, 1); assert.equal(f.calls.load.length, 2);
      assert.equal(await f.page.getByLabel("Password", { exact: true }).inputValue(), "Test-only-password-123");
      await f.page.getByLabel("Characters in the image", { exact: true }).fill("A7K3W9");
      await f.page.getByRole("button", { name: "Verify and create account" }).click();
      await f.page.waitForFunction(() => window.redirects.length === 1);
      assert.equal(f.calls.signup.length, 2); assert.equal(f.calls.verify.length, 2);
      await f.finish();
    });

    await t.test("standalone page reuses the check and retains return/explore actions", async () => {
      const f = await fixture({}, "?standalone");
      await f.page.getByRole("img").waitFor();
      assert.equal(await f.page.locator("form").count(), 1);
      await f.page.getByLabel("Characters in the image", { exact: true }).fill("a7k3w9");
      await f.page.getByLabel("Characters in the image", { exact: true }).press("Enter");
      await f.page.getByRole("status").filter({ hasText: "Verified" }).waitFor();
      assert.equal(f.calls.verify.length, 1); assert.equal(f.calls.signup.length, 0);
      assert.equal(await f.page.getByRole("button", { name: "Return to previous page" }).count(), 1);
      assert.equal(await f.page.getByRole("link", { name: "Explore", exact: true }).getAttribute("href"), "/explore");
      await f.finish();
    });
  } finally { await browser.close(); }
});

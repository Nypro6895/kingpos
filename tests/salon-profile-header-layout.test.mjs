import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { chromium } from "playwright-core";

const source = readFileSync("app/salon-profile/salon-profile-view.tsx", "utf8");
const start = source.indexOf('        <section className="group min-w-0');
const end = source.indexOf('        </section>', start) + '        </section>'.length;
assert.ok(start >= 0 && end > start);
const code = ts.transpileModule(`export function Header(p) {
  const { profile, capabilities, identityMeta, data, mainTabs, visibleTabs, effectiveTab, preferences } = p;
  const ownerMenuOpen = false, manageData = null, trustSummary = {}, sortedLooks = [], ownerMenuButtonRef = null, ownerMenuRef = null, canShowFollow = false, canShowBook = false;
  const changeTab = () => {}, onTabKeyDown = () => {}, setOwnerMenuOpen = () => {}, setProfileSettingsOpen = () => {}, setProfileEditorOpen = () => {}, setPublicationOpen = () => {}, setHoursInfoOpen = () => {}, setOperatingHoursOpen = () => {}, shareSalon = () => {};
  return (${source.slice(start, end).trim()});
}`, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
const compiledModule = { exports: {} };
const Cover = () => React.createElement("div", { className: "absolute inset-0 bg-brand-orange-soft" });
const Trust = () => React.createElement("span", { className: "text-brand-orange" }, "+");
new Function("require", "exports", "SalonCover", "SalonTrustLine", "SalonVerifiedBadge", "salonPopularPrice", "Button", code)(createRequire(import.meta.url), compiledModule.exports, Cover, Trust, () => null, () => null, () => null);
const cssPath = ".next/dev/static/css/app/(app)/layout.css";
const chromePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
const tabs = ["discover", "gallery", "services", "team", "experiences", "about"].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }));

test("compact staff and owner headers fit mobile widths and expose overflow actions", {
  skip: !css || !existsSync(chromePath) ? "Requires a local dev CSS build and Chrome" : false,
}, async () => {
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    for (const width of [320, 390, 768]) for (const owner of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const markup = renderToStaticMarkup(React.createElement(compiledModule.exports.Header, {
        profile: { name: "King Nails", logoImageUrl: null, salonId: "test", operatingStatus: { label: "Closed", detail: "Hours not set" } },
        capabilities: { canEditProfile: owner }, data: {reputationSummary:{}}, identityMeta: ["Milwaukee, WI", "3 services", "1 follower"], mainTabs: tabs.slice(0, 4), visibleTabs: tabs, effectiveTab: "discover", preferences: { allow_sharing: true },
      }));
      await page.setContent(`<style>${css}</style><main style="padding:12px">${markup}</main>`);
      assert.equal(await page.locator('[role="tab"]').count(), 4);
      assert.equal(await page.getByRole("button", { name: "Profile settings", exact: true }).count(), owner ? 1 : 0);
      const bounds = await page.locator("section").boundingBox();
      // A full-width hours row keeps the reopening hint readable beside the status.
      assert.ok(bounds.height <= (width >= 640 ? 264 : 244), `Header too tall at ${width}px: ${bounds.height}px`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Horizontal viewport overflow");
      await page.locator("summary").click();
      assert.ok(await page.getByRole("button", { name: "About", exact: true }).isVisible());
      assert.ok(await page.getByRole("button", { name: "Share profile", exact: true }).isVisible());
      await page.close();
    }
  } finally { await browser.close(); }
});

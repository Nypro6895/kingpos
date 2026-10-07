import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { chromium } from "playwright-core";

const executablePath = "C:/Program Files/Google/Chrome/Application/chrome.exe";
test("popovers dismiss outside, across menus, on selection and Escape", { skip: !existsSync(executablePath) }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<details id="one" data-dismissible-popover><summary>One</summary><input id="inside"><a href="#selected">Select</a></details><details id="two" data-dismissible-popover><summary>Two</summary><button>Action</button></details><details id="accordion" open><summary>Inline section</summary>Content</details><button id="outside">Outside</button>`);
    await page.addStyleTag({ content: "details { position: relative; margin-bottom: 80px; } details > :not(summary) { position: absolute; top: 24px; } details a { left: 200px; }" });
    const code = ts.transpileModule(readFileSync("lib/dismissible-popovers.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    await page.addScriptTag({ content: `const exports = {}; ${code}; window.cleanup = exports.installPopoverDismissal(document); window.closePopovers = () => exports.closePopovers(document); document.querySelector('#outside').addEventListener('pointerdown', e => e.stopPropagation());` });
    const open = (id) => page.locator(`#${id}`).evaluate(el => el.open);
    await page.locator("#one summary").click();
    await page.locator("#inside").fill("Keep editing");
    assert.equal(await open("one"), true);
    await page.locator("#two summary").click();
    assert.equal(await open("one"), false);
    assert.equal(await open("two"), true);
    await page.keyboard.press("Escape");
    assert.equal(await open("two"), false);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Two");
    await page.locator("#one summary").click();
    await page.locator("#outside").click();
    assert.equal(await open("one"), false);
    await page.locator("#one summary").click();
    await page.locator("#one a").click();
    assert.equal(await open("one"), false);
    await page.locator("#one summary").click();
    await page.locator("#outside").focus();
    assert.equal(await open("one"), false);
    await page.locator("#two summary").click();
    await page.evaluate(() => window.closePopovers());
    assert.equal(await open("two"), false);
    assert.equal(await open("accordion"), true);
    await page.evaluate(() => window.cleanup());
    await page.locator("#one summary").click();
    await page.locator("#outside").click();
    assert.equal(await open("one"), true);
  } finally { await browser.close(); }
});

import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const bundle = await build({ stdin: { contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import NumericInputEditing from './components/numeric-input-editing';
function App() {
  const [value, setValue] = useState('0');
  return <><NumericInputEditing/><form>
    <input id="controlled" type="number" step="0.01" value={value} onChange={e=>setValue(e.target.value)}/>
    <output id="state">{value}</output>
    <input id="decimal" inputMode="decimal" defaultValue="0.00" name="amount"/>
    <input id="uncontrolled" type="number" defaultValue="0"/>
    <input id="code" inputMode="numeric" defaultValue="0"/>
    <input id="phone" type="tel" defaultValue="0"/>
    <input id="readonly" type="number" readOnly value="0"/>
    <input id="disabled" type="number" disabled value="0"/>
    <button type="reset">Reset</button>
  </form></>;
}
createRoot(document.getElementById('root')).render(<App/>);
`, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', jsx: 'automatic' });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/bundle.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let checks = 0;
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#controlled').waitFor();
  await page.waitForTimeout(100);
  const check = async (id, expected) => { assert.equal(await page.locator('#'+id).inputValue(), expected, id); checks++; };
  // Real keyboard input reproduces the screenshot; React state must agree.
  await page.locator('#controlled').focus();
  await page.keyboard.press('End');
  await page.keyboard.type('20');
  await check('controlled', '20');
  assert.equal(await page.locator('#state').textContent(), '20'); checks++;
  await page.locator('#controlled').fill('0');
  await page.locator('#controlled').blur();
  await check('controlled', '0');
  for (const [raw, expected] of [['020','20'],['000','0'],['000.25','0.25'],['0.02','0.02'],['-020','-20'],['12.50','12.50'],['','']]) {
    await page.locator('#controlled').fill(raw);
    await check('controlled', expected);
    assert.equal(await page.locator('#state').textContent(), expected); checks++;
  }
  await page.locator('#uncontrolled').focus();
  await page.keyboard.press('End');
  await page.keyboard.type('20');
  await check('uncontrolled', '20');
  await page.locator('#decimal').fill('00020.50');
  await check('decimal', '20.50');
  assert.equal(await page.locator('form').evaluate(form=>new FormData(form).get('amount')), '20.50'); checks++;
  await page.locator('#decimal').fill('0.');
  await page.keyboard.type('25');
  await check('decimal', '0.25');
  for (const id of ['code','phone']) { await page.locator('#'+id).fill('020'); await check(id,'020'); }
  await check('readonly','0'); await check('disabled','0');
  await page.locator('button').click();
  await check('uncontrolled','0'); await check('decimal','0.00');
  // Mid-string insertion retains the text-field caret after removing zeros.
  await page.locator('#decimal').fill('20');
  await page.locator('#decimal').evaluate(input=>input.setSelectionRange(0,0));
  await page.keyboard.type('0');
  await check('decimal','20');
  assert.equal(await page.locator('#decimal').evaluate(input=>input.selectionStart),0); checks++;
  await page.locator('#decimal').fill('0.00');
  await page.locator('#decimal').blur();
  await page.locator('#decimal').focus();
  await page.keyboard.press('End');
  await page.keyboard.type('20');
  await check('decimal','20');
  await page.locator('#controlled').fill('0.00');
  await page.locator('#controlled').blur();
  await page.locator('#controlled').focus();
  await page.keyboard.press('End');
  await page.keyboard.type('20');
  await check('controlled','20');
  assert.equal(await page.locator('#state').textContent(), '20'); checks++;
  await page.locator('#decimal').fill('0');
  await page.locator('#decimal').blur();
  await page.locator('#decimal').focus();
  await page.keyboard.press('End');
  await page.keyboard.type('.02');
  await check('decimal','0.02');
  console.log(JSON.stringify({passed:checks, browser:'Chrome', coverage:'React controlled/uncontrolled, decimal drafts, form data/reset, caret, code/phone exclusions'}));
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }

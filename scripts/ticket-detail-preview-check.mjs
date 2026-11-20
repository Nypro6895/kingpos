import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

// Checks only our own synthetic fixture file and already-owned local preview.
const receipt=JSON.parse(fs.readFileSync('artifacts/ticket-detail-professional/preview-server.json','utf8'));
assert.equal(path.resolve(receipt.source),process.cwd());
const input=path.resolve('tests/fixtures/ticket-detail-professional-data.mjs');
const original=fs.readFileSync(input,'utf8');
const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(receipt.url);await page.waitForFunction(()=>window.qaMounted);
 const before=await page.evaluate(()=>({origin:performance.timeOrigin,href:location.href,scripts:document.querySelectorAll('script[src*="revision="]').length}));
 fs.writeFileSync(input,original+'\n// Local native-watch smoke check; removed immediately after verification.\n');
 await page.waitForFunction(n=>document.querySelectorAll('script[src*="revision="]').length>n,before.scripts,{timeout:15000});
 await page.locator('[data-ticket-detail] h1').waitFor();
 assert.equal(await page.locator('[data-ticket-detail] h1').innerText(),'T00078');
 const after=await page.evaluate(()=>({origin:performance.timeOrigin,href:location.href,scripts:document.querySelectorAll('script[src*="revision="]').length}));
 assert.equal(after.origin,before.origin,'Source update reloaded the document');assert.equal(after.href,before.href);
 assert.deepEqual(errors,[],'Native source rebuild caused runtime errors');
 const evidence={kind:'synthetic-production-component-native-watch-check',passed:true,before,after,errors};
 fs.writeFileSync('artifacts/ticket-detail-professional/preview-watch-verification.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence,null,2));
}finally{fs.writeFileSync(input,original);await browser.close();}

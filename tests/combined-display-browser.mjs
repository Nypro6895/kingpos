import fs from'node:fs';import assert from'node:assert/strict';import{chromium}from'playwright-core';import{customerDisplayResponsivePreview}from'./fixtures/customer-display-responsive-preview.mjs';
const out='C:/Reylumi/kingpos/artifacts/all-recent-chats-20261026';
const server=await customerDisplayResponsivePreview();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const checks=[];
try{const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
for(const [width,height]of[[640,480],[710,848],[800,600],[900,650],[1000,650],[512,614],[1440,900]]){
 await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.getByRole('button',{name:'Digit 7',exact:true}).waitFor();
 for(const name of['7','0']){const box=await page.getByRole('button',{name:'Digit '+name,exact:true}).boundingBox();assert(box&&box.y>=0&&box.y+box.height<=height+1,`key ${name} clipped at ${width}`);}
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push({width,height,keypadFullyVisible:true});
 if(width===640)await page.screenshot({path:out+'/display-640x480.png'});
}
await page.setViewportSize({width:640,height:480});await page.goto(`http://127.0.0.1:${server.address().port}/?mode=custom`);
await page.getByRole('button',{name:'Custom tip digit 5',exact:true}).click();const body=await page.locator('body').innerText();assert(body.includes('$5'));assert(!body.includes('$5.00'));
await page.getByRole('button',{name:'Apply custom tip',exact:true}).click();assert.equal(await page.evaluate(()=>window.previewRequests.at(-1).amount),5);
assert.deepEqual(errors,[]);fs.writeFileSync(out+'/display-browser.json',JSON.stringify({passed:true,checks,tipFiveDollars:true,errors},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,tipFiveDollars:true}));
}finally{await browser.close();await new Promise(r=>server.close(r));}

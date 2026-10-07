import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright-core';
const base=process.env.WEB_SMOKE_URL||'http://127.0.0.1:3100';
const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH,headless:true});
const checks=[];const output='artifacts/web-css-audit/screenshots';fs.mkdirSync(output,{recursive:true});
try{for(const width of [390,1440]){const page=await browser.newPage({viewport:{width,height:width===390?844:900}});
 for(const route of ['/login','/signup','/forgot-password','/privacy','/terms','/legal','/explore','/pos/portable']){
  const cssFailures=[],errors=[];const responseHandler=r=>{if(r.request().resourceType()==='stylesheet'&&r.status()>=400)cssFailures.push({url:r.url(),status:r.status()});};const errorHandler=e=>errors.push(e.message);page.on('response',responseHandler);page.on('pageerror',errorHandler);
  try{const response=await page.goto(base+route,{waitUntil:'load',timeout:60000});await page.waitForFunction(()=>document.body.innerText.trim().length>20 && !document.body.innerText.includes('Loading page'),{},{timeout:30000});await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,cssSheets:document.styleSheets.length,mainText:document.body.innerText.length}));
   const check={route,width,status:response.status(),finalPath:new URL(page.url()).pathname,...geometry,cssFailures,errors};checks.push(check);
   await page.screenshot({path:path.join(output,route.slice(1).replaceAll('/','-')+'-'+width+'.png'),fullPage:true});console.log(JSON.stringify(check));
  }catch(e){checks.push({route,width,error:e.message});console.log(JSON.stringify({route,width,error:e.message}));}
  page.off('response',responseHandler);page.off('pageerror',errorHandler);
 }await page.close();}
}finally{await browser.close();fs.writeFileSync('artifacts/web-css-audit/live-pages.json',JSON.stringify(checks,null,2));}

if(checks.some(c=>c.error||c.status>=400||c.overflow||c.cssFailures?.length||c.errors?.length))process.exitCode=1;

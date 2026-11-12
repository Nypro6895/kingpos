import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';
const output='artifacts/terminology-step1-20261110';
const entry=`import React from'react';import{createRoot}from'react-dom/client';import{RoleMoreContent}from'./components/role-more-content';const p=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(<RoleMoreContent roleKind={p.get('role')??'owner'} workspace={p.get('workspace')??'standard'} activeItemIds={[]} onNavigate={()=>{}}/>);`;
const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:entry},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'ui-boundaries',setup(b){
 b.onResolve({filter:/^(next\/link|@\/components\/feedback-link)$/},()=>({path:'link',namespace:'fixture'}));
 b.onResolve({filter:/^@\/components\/workspace-language$/},()=>({path:'language',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'jsx',resolveDir:process.cwd(),contents:a.path==='link'?`import React from'react';export default function Link({href,prefetch,...props}){return <a href={href} {...props}/>}`:`import{translateVietnamese}from'./lib/vietnamese-dictionary';const t=text=>translateVietnamese(text,new URLSearchParams(location.search).get('lang')==='vi');export const WorkspaceText=({text})=>t(text);export const useWorkspaceTranslation=()=>t;`}));
 }}]});
const globals=await postcss([tailwind()]).process(fs.readFileSync('app/globals.css','utf8'),{from:'app/globals.css'});
const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text,css=globals.css+'\n'+result.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n');
const server=createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('content-type','application/javascript');res.end(js);}else{res.setHeader('content-type','text/html; charset=utf-8');res.end(`<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;font-family:Arial}#root{max-width:428px;margin:auto}</style><div id="root"></div><script src="/app.js"></script></html>`);}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));for(const role of ['owner','staff','personal'])for(const lang of ['en','vi'])for(const width of [320,428]){
 await page.setViewportSize({width,height:926});await page.goto(`http://127.0.0.1:${server.address().port}/?role=${role}&lang=${lang}`);await page.getByRole('heading',{name:lang==='vi'?'Thêm':'More',exact:true}).waitFor();
 const support=page.locator('a[href="/support"]');assert.equal(await support.innerText(),lang==='vi'?'Hỗ trợ':'Support');
 if(role==='owner'){assert.equal(await page.locator('a[href="/reports"]').innerText(),lang==='vi'?'Báo cáo':'Reports');assert.equal(await page.locator('a[href="/pos-tickets"]').innerText(),lang==='vi'?'Phiếu':'Tickets');}
 if(role==='personal')assert.equal(await page.locator('a[href="/more/reviews"]').innerText(),lang==='vi'?'Đánh giá của tôi':'My reviews');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
 const clipped=await page.locator('.role-more-item span').evaluateAll(es=>es.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent));assert.deepEqual(clipped,[]);
 if(width===428)await page.screenshot({path:`${output}/menu-${role}-${lang}.png`,fullPage:true});checks.push({role,lang,width});
 }assert.deepEqual(errors,[]);fs.writeFileSync(output+'/menu-browser.json',JSON.stringify({checks,errors,boundary:'Actual shared More component and translator in isolated browser fixtures; no authenticated or physical-device claim'},null,2));console.log('Passed '+checks.length+' role/language/width combinations');}finally{await browser.close();await new Promise(r=>server.close(r));}

import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

const output='artifacts/help-native-parity-20261106';
fs.mkdirSync(output,{recursive:true});
let browser,server,origin;
const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
import React,{useSyncExternalStore} from 'react';import{createRoot}from'react-dom/client';
import{HelpHome,HelpArticle}from'./app/help/help-content';import{AppLocalHelp}from'./components/app-local-help';import{HELP_GUIDES,findHelpGuide}from'./lib/help-guides';
window.calls={diagnostic:0,network:0};window.__reylumiExportDiagnostics=()=>{window.calls.diagnostic++};
window.fetch=()=>{window.calls.network++;throw Error('No backend allowed')};
window.XMLHttpRequest=class{constructor(){window.calls.network++;throw Error('No backend allowed')}};
window.mode=location.pathname.startsWith('/native')?'native':'web';
for(const name of ['pushState','replaceState']){const original=history[name].bind(history);history[name]=(state,title,url)=>{if(url===undefined||url===null){original(state,title);return;}const href=String(url);original(state,title,href.startsWith('/help')||href.startsWith('/support')?'/'+window.mode+href:href);window.dispatchEvent(new Event('route'));};}
window.fixtureNavigate=href=>history.pushState(null,'',href);
const subscribe=cb=>{window.addEventListener('route',cb);return()=>window.removeEventListener('route',cb)};
function App(){useSyncExternalStore(subscribe,()=>location.href,()=>location.href);const route=new URL(location.href);const pathname=route.pathname.replace(/^\\/(web|native)/,'');const slug=pathname.startsWith('/help/')?decodeURIComponent(pathname.slice(6)):undefined;const language=route.searchParams.get('lang')==='vi'?'vi':'en';const guide=slug?findHelpGuide(slug):undefined;return window.mode==='native'?<AppLocalHelp slug={slug} language={language} support={pathname==='/support'} experienceScope='fixture-scope' navigate={window.fixtureNavigate}/>:guide?<HelpArticle guide={guide} language={language}/>:<HelpHome language={language}/>;}
window.guideSlugs=HELP_GUIDES.map(g=>g.slug);createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'server-and-next-boundaries',setup(b){
 b.onResolve({filter:/^(server-only|next\/link|next\/navigation)$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:specifier})=>({loader:'tsx',resolveDir:process.cwd(),contents:specifier==='server-only'?'':specifier==='next/link'?`export default function Link({prefetch,...props}){return <a {...props} onClick={event=>{if(!event.button&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey&&!props.href.startsWith('#')){event.preventDefault();window.fixtureNavigate(props.href)}}}/>}`:`import{useSyncExternalStore}from'react';const sub=cb=>{window.addEventListener('route',cb);return()=>window.removeEventListener('route',cb)};export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(sub,()=>location.search,()=>''));export const usePathname=()=>location.pathname.replace(/^\\/(web|native)/,'');export const useRouter=()=>({replace:href=>history.replaceState(null,'',href)});`}));
}}]});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
before(async()=>{
 server=createServer((req,res)=>{if(process.env.HELP_NATIVE_BUNDLE_DIR&&!req.url.startsWith('/web/')&&!req.url.startsWith('/native/')&&!req.url.startsWith('/fixture.')){const root=path.resolve(process.env.HELP_NATIVE_BUNDLE_DIR);const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,pathname.startsWith('/help')?'index.html':'.'+pathname);if(!file.startsWith(root+path.sep)){res.statusCode=403;res.end();return;}if(fs.existsSync(file)&&fs.statSync(file).isFile()){res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.woff2')?'font/woff2':file.endsWith('.png')?'image/png':'image/jpeg');res.end(fs.readFileSync(file));return;}res.statusCode=404;res.end();return;}if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(js)}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css)}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;font-family:Arial,sans-serif}button,input,select{font:inherit}*{box-sizing:border-box}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve))});

test('no diagnostic control or label remains in any application UI source',()=>{
 const matches=[];function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(/\.[tj]sx?$/.test(file)){const text=fs.readFileSync(file,'utf8');if(/AppLocalDiagnosticExport|Save diagnostic report|Lưu báo cáo chẩn đoán|__reylumiExportDiagnostics/.test(text))matches.push(file)}}}
 walk('app');walk('components');assert.deepEqual(matches,[]);
 assert(!fs.existsSync('components/app-local-diagnostic-export.tsx'));
 assert(!Object.keys(JSON.parse(fs.readFileSync('app/help/help-copy.json'))).some(key=>/diagnostic|save options/.test(key)));
 assert.doesNotMatch(js,/Save diagnostic report|Lưu báo cáo chẩn đoán/);
});

test('native and web render the same Help pixels at mobile, tablet and desktop sizes in both languages',{timeout:120000},async()=>{
 const result=[];
 const pages={web:await browser.newPage(),native:await browser.newPage()};
 const errors=[];for(const page of Object.values(pages)){page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>{localStorage.clear();sessionStorage.clear()})}
 try{
 for(const width of [320,390,430,768,1280])for(const lang of ['en','vi']){
   const captures={};
   for(const [mode,page]of Object.entries(pages)){
     await page.setViewportSize({width,height:844});await page.goto(origin+'/'+mode+'/help?lang='+lang,{waitUntil:'networkidle'});await page.locator(`main[lang="${lang}"]`).waitFor();
     assert.equal(await page.locator('#help-results a').count(),36);assert.equal(await page.locator('#help-results h2').count(),7);
     assert.equal(await page.getByRole('heading',{name:/Choose a quick start|All guides|Chọn bắt đầu nhanh/}).count(),0);
     assert.equal(await page.locator('#help-results ol').count(),0);assert.equal(await page.locator('#help-results a svg').count(),36);
     assert.equal(await page.getByRole('button',{name:/diagnostic|chẩn đoán/i}).count(),0);
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
     const boxes=await page.locator('main > header h1,main > header [role="group"]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().toJSON()));assert.equal(boxes.length,2);assert(Math.abs(boxes[0].y-boxes[1].y)<10);
     await page.locator('main [role="group"]').first().screenshot();
     captures[mode]=await page.screenshot({animations:'disabled'});
     if(width===390)fs.writeFileSync(`${output}/${mode}-home-${lang}-390.png`,captures[mode]);
   }
   if(!captures.native.equals(captures.web)){for(const [mode,bytes]of Object.entries(captures))fs.writeFileSync(`${output}/mismatch-${mode}.png`,bytes)}
   assert(captures.native.equals(captures.web),`Help screenshot mismatch at ${width}/${lang}`);result.push({screen:'home',width,lang,pixelIdentical:true});
 }
 const native=pages.native;await native.goto(origin+'/native/help',{waitUntil:'networkidle'});
 const slugs=await native.evaluate(()=>window.guideSlugs);
 for(const lang of ['en','vi'])for(const slug of slugs){
   const captures={};
   for(const [mode,page]of Object.entries(pages)){
     await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/${mode}/help/${slug}?lang=${lang}`,{waitUntil:'networkidle'});
     await page.locator('h1').waitFor();assert.equal(await page.locator('#walkthroughs > details').count(),await page.locator('#walkthroughs > details:not([open])').count());
     assert.equal(await page.getByRole('button',{name:/diagnostic|chẩn đoán/i}).count(),0);
     captures[mode]=await page.screenshot({animations:'disabled'});
     if(slug==='personal-qr')fs.writeFileSync(`${output}/${mode}-article-${lang}-390.png`,captures[mode]);
   }
   assert(captures.native.equals(captures.web),`Article screenshot mismatch at ${slug}/${lang}`);result.push({screen:slug,width:390,lang,pixelIdentical:true});
 }
 for(const page of Object.values(pages))assert.deepEqual(await page.evaluate(()=>window.calls),{diagnostic:0,network:0});assert.deepEqual(errors,[]);
 fs.writeFileSync(`${output}/pixel-parity.json`,JSON.stringify({passed:true,comparisons:result.length,results:result,scope:'Real shared native/web Help components and CSS, Chromium, no Next server or native device claimed'},null,2));
 }finally{for(const page of Object.values(pages))await page.close()}
});

test('native Help works offline, keeps browse state, and never offers diagnostics even with the bridge installed',{timeout:30000},async()=>{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 await page.goto(origin+'/native/help',{waitUntil:'networkidle'});await page.context().setOffline(true);
 await page.getByRole('searchbox').fill('hoa hong');await page.getByRole('button',{name:'Owners',exact:true}).click();
 await page.getByRole('button',{name:'Tiếng Việt',exact:true}).click();await page.locator('main[lang="vi"]').waitFor();
 await page.locator('#help-results a[href*="payroll-and-tax"]').click();await page.locator('h1').filter({hasText:'Lương & hồ sơ thuế'}).waitFor();
 await page.locator('main > div > a').first().click();await page.getByRole('searchbox').waitFor();assert.equal(await page.getByRole('searchbox').inputValue(),'hoa hong');assert.equal(await page.getByRole('button',{name:'Chủ tiệm',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Xem tất cả hướng dẫn',exact:true}).click();assert.equal(await page.locator('#help-results a').count(),36);
 await page.locator('a[href^="/support"]').click();await page.getByRole('heading',{name:'Support',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/diagnostic|chẩn đoán/i}).count(),0);assert.deepEqual(await page.evaluate(()=>window.calls),{diagnostic:0,network:0});assert.deepEqual(errors,[]);
 }finally{await page.close()}
});


test('rebuilt installed application bundle shows the approved Help UI, all articles and no diagnostic action',{timeout:90000,skip:!process.env.HELP_NATIVE_BUNDLE_DIR},async()=>{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.calls={diagnostic:0,network:0};window.__reylumiExportDiagnostics=()=>{window.calls.diagnostic++};window.fetch=()=>{window.calls.network++;throw Error('No backend in installed Help verification')};});
 try{
 for(const lang of ['en','vi']){
  await page.goto(origin+'/help?lang='+lang,{waitUntil:'networkidle'});await page.locator('main[lang="'+lang+'"]').waitFor();
  assert.equal(await page.locator('#help-results a').count(),36);assert.equal(await page.locator('#help-results h2').count(),7);assert.equal(await page.locator('#help-results a svg').count(),36);
  assert.equal(await page.getByText('Choose a quick start',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:/diagnostic|chẩn đoán/i}).count(),0);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('main [role="group"]').first().screenshot();await page.screenshot({path:output+'/installed-home-'+lang+'-390.png',animations:'disabled'});
  await page.locator('#help-results a[href*="personal-qr"]').click();await page.locator('main[lang="'+lang+'"] #walkthroughs').waitFor();
  assert.equal(await page.locator('#walkthroughs > details').count(),2);assert.equal(await page.locator('#walkthroughs > details[open]').count(),0);
  await page.locator('main [role="group"]').first().screenshot();await page.screenshot({path:output+'/installed-article-'+lang+'-390.png',animations:'disabled'});
 }
 assert.deepEqual(await page.evaluate(()=>window.calls),{diagnostic:0,network:0});assert.deepEqual(errors,[]);
 fs.writeFileSync(output+'/installed-bundle-check.json',JSON.stringify({passed:true,bundleBuildId:JSON.parse(fs.readFileSync(path.join(process.env.HELP_NATIVE_BUNDLE_DIR,'manifest.json'))).buildId,guideCount:36,groupCount:7,languages:['en','vi'],backendCalls:0,diagnosticCalls:0,scope:'Actual packaged entry, routing and CSS in Chromium; no WKWebView, signing or physical-device claim'},null,2));
 }finally{await page.close()}
});

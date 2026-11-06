import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

// Set HELP_TEST_BASE_URL to an isolated local Next server with no backend credentials.
const base=process.env.HELP_TEST_BASE_URL || 'http://localhost:3167';
assert(['localhost','127.0.0.1'].includes(new URL(base).hostname),'Local verification only');
const output='artifacts/help-complete-20261106';
fs.mkdirSync(output,{recursive:true});
const bundle=await build({entryPoints:['lib/help-guides.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};
new Function('module','exports','require',bundle.outputFiles[0].text)(module,module.exports,createRequire(import.meta.url));
const {HELP_GUIDES,HELP_GROUPS}=module.exports;

test('every guide belongs to one topic, with valid related destinations',()=>{
 const slugs=HELP_GROUPS.flatMap(group=>group.slugs);
 assert.equal(slugs.length,HELP_GUIDES.length);
 assert.equal(new Set(slugs).size,slugs.length);
 for(const slug of slugs)assert(HELP_GUIDES.some(guide=>guide.slug===slug),slug);
 for(const guide of HELP_GUIDES){
  assert(module.exports.relatedHelpGuides(guide).every(item=>item.slug!==guide.slug&&slugs.includes(item.slug)));
 }
});

test('actual Next Help routes: search, filters, languages, navigation and responsive articles',{timeout:240000,skip:!process.env.HELP_TEST_BASE_URL},async()=>{
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const errors=[],measurements=[];
 const page=await browser.newPage({viewport:{width:390,height:844}});
 page.on('pageerror',error=>errors.push(error.message));
 async function open(url,language='en'){
  const response=await page.goto(base+url,{waitUntil:'networkidle'});
  assert.equal(response.status(),200,url);
  await page.waitForFunction(()=>document.querySelectorAll('main[lang]').length===1);
  await page.locator(`main[lang="${language}"]`).waitFor();
  // Wait for hydration so interactions use the real Next router and native-history integration.
  await page.getByRole('button',{name:'English',exact:true}).waitFor();
 }
 async function readable(label){
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' document overflow');
  const bad=await page.locator('main[lang] p, main[lang] h1, main[lang] h2, main[lang] h3, main[lang] li').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).filter(n=>n.getBoundingClientRect().right>innerWidth+1||n.getBoundingClientRect().left< -1).map(n=>n.textContent.slice(0,100)));
  assert.deepEqual(bad,[],label+' content overflow');
 }
 const screenshot=async name=>page.screenshot({path:path.join(output,name),style:'nextjs-portal{display:none!important}'});
 try {
  for(const width of [320,375,390,430,768,1024,1440]){
   await page.setViewportSize({width,height:844});
   for(const lang of ['en','vi']){
    await open('/help'+(lang==='vi'?'?lang=vi':''),lang);
    assert.equal(await page.locator('#help-results a').count(),HELP_GUIDES.length);
    assert.equal(await page.locator('#help-results h2').count(),HELP_GROUPS.length);
    const tabs=await page.locator('[aria-pressed]').filter({hasNot:page.locator('svg')}).evaluateAll(nodes=>nodes.filter(n=>['All','Customers','Owners','Staff','Tất cả','Khách','Chủ tiệm','Nhân viên'].includes(n.textContent)).map(n=>n.getBoundingClientRect().y));
    assert.equal(new Set(tabs).size,1,`Role filters wrap at ${width}/${lang}`);
    await readable(`home ${width}/${lang}`);
    measurements.push({page:'home',width,lang});
    if(width===390||width===1440)await screenshot(`home-${lang}-${width}.png`);
   }
  }
  await page.setViewportSize({width:390,height:844});
  await open('/help');
  await page.getByRole('searchbox').fill('hoa hong');
  await page.waitForURL(url=>url.searchParams.get('q')==='hoa hong');
  await page.locator('#help-results a[href*="payroll-and-tax"]').waitFor();
  assert.equal(new URL(page.url()).searchParams.get('q'),'hoa hong');
  await page.getByRole('button',{name:'Owners',exact:true}).click();
  await page.getByRole('button',{name:'Tiếng Việt',exact:true}).click();
  await page.locator('main[lang="vi"]').waitFor();
  const before=new URL(page.url()).searchParams;
  assert.equal(before.get('q'),'hoa hong'); assert.equal(before.get('role'),'owner');
  await page.locator('#help-results a[href*="payroll-and-tax"]').click();
  await page.locator('h1').filter({hasText:'Lương & hồ sơ thuế'}).waitFor();
  const back=page.locator('main[lang] > div > a[href^="/help?"]').first();
  assert.match(await back.getAttribute('href'),/lang=vi/);
  await back.click();
  await page.getByRole('searchbox').waitFor();
  assert.equal(await page.getByRole('searchbox').inputValue(),'hoa hong');
  assert.equal(new URL(page.url()).searchParams.get('role'),'owner');
  await page.getByRole('searchbox').fill('khong-co-huong-dan-12345');
  await page.getByRole('heading',{name:'Không tìm thấy hướng dẫn',exact:true}).waitFor();
  assert.equal(await page.locator('#help-results a').count(),0);
  assert(await page.locator('main a[href^="/support"]').first().isVisible());
  await page.getByRole('button',{name:'Xem tất cả hướng dẫn',exact:true}).click();
  assert.equal(await page.locator('#help-results a').count(),HELP_GUIDES.length);
  await page.getByRole('combobox',{name:'Chọn chủ đề'}).selectOption('team');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'topic-team');
  for(const guide of HELP_GUIDES){
   for(const lang of ['en','vi']){
    await open(`/help/${guide.slug}${lang==='vi'?'?lang=vi':''}`,lang);
    assert.equal(await page.locator('main[lang] h1').count(),1);
    assert.equal(await page.locator('#walkthroughs > details').count(),guide.sections.length);
    assert.equal(await page.locator('#walkthroughs > details[open]').count(),0);
    const firstTask=page.locator('#walkthroughs > details').first();
    await firstTask.locator(':scope > summary').click();
    assert(await firstTask.locator(':scope > ol').isVisible());
    const problem=firstTask.locator('details').first();
    await problem.locator('summary').click();
    assert(await problem.locator('ul').isVisible());
    for(const width of [320,390,1280]){
     await page.setViewportSize({width,height:844});
     await readable(`${guide.slug} ${width}/${lang}`);
     measurements.push({page:guide.slug,width,lang});
    }
    await page.setViewportSize({width:390,height:844});
    if(['personal-qr','owner-tips','settings-security'].includes(guide.slug)){
     await page.evaluate(()=>window.scrollTo(0,0));await screenshot(`article-${guide.slug}-${lang}-390.png`);
    }
    const action=page.locator('#before-start a');assert.equal(await action.getAttribute('href'),guide.entry.href);
    const support=page.locator('main[lang] footer a[href^="/support"]');assert((await support.getAttribute('href')).includes(encodeURIComponent('/help/'+guide.slug)));
   }
  }
  await page.setViewportSize({width:390,height:844});
  await open('/help/notifications?lang=vi','vi');
  const related=page.locator('#related a').first();assert((await related.getAttribute('href')).includes('lang=vi'));
  await related.click();await page.locator('main[lang="vi"] h1').waitFor();
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'browser-results.json'),JSON.stringify({measurements,errors,backend:'No credentials or authenticated actions used',browser:'Chromium, actual Next routes'},null,2));
 } finally {await browser.close();}
});

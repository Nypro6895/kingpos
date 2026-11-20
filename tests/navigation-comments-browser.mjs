import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';

// Exercise original view functions with inert data/providers. No server writes,
// account cookies, production navigation, or generated copies of the UI.
async function declaration(file, name) {
  const source = await fs.readFile(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function walk(node) { if(ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(ast); ts.forEachChild(node,walk); }
  walk(ast); assert.ok(result, name); return result.replace(/^export /,'');
}
const originalSocial = await declaration('components/explore-social.tsx','ExploreSocialActions');
const summary = await declaration('app/salon-profile/salon-profile-view.tsx','ExperienceSummaryPanel');
const experiences = await declaration('app/salon-profile/salon-profile-view.tsx','renderExperiences');
const descriptor = await declaration('lib/app-local-public-registry.tsx','descriptor');
const tabFromHash = await declaration('app/salon-profile/salon-profile-view.tsx','tabFromHash');
const syncTabFromHash = await declaration('app/salon-profile/salon-profile-view.tsx','syncTabFromHash');
const profileSource=await fs.readFile('app/salon-profile/salon-profile-view.tsx','utf8');
// Execute the actual hook body responsible for selecting and scrolling anchors.
const scrollEffect=profileSource.slice(profileSource.indexOf('    let frame = 0;',profileSource.indexOf('function syncTabFromHash')),profileSource.indexOf('  }, [selectedTab]);',profileSource.indexOf('    let frame = 0;',profileSource.indexOf('function syncTabFromHash'))));
assert.ok(scrollEffect.includes('salonProfileAnchor'));
const source = `
import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import {installAppLocalLinkNavigation} from './lib/app-local-link-navigation';
import {salonProfileAnchor} from './lib/salon-profile-anchor';
import {hasAppLocalPublicAnchor} from './lib/app-local-public-anchor';
import {AppLocalLink,AppLocalNavigationProvider} from './app/local-app/navigation';
const WorkspaceText=({text})=><>{text}</>,ReylumiIcon=()=>null,LumiTrustSpark=()=>null;
const Link=({prefetch,...props})=><a {...props}/>;
const styles={actions:'actions',count:'count',feedback:'feedback'};
const useSalonSocial=()=>({authenticated:true,state:{loved:false},busy:false,change:async()=>{}});
const SavePostButton=()=> <button>Love post</button>,ExploreBookButton=()=> <button>Book</button>;
const profileTrustSummary=()=>({level:'empty',mark:{label:'Building LUMI Trust',detail:'Waiting for evidence'},evidenceRows:[]});
const __vt=x=>x,experienceFilter='all',setExperienceFilter=value=>window.experienceFilter=value,data={experiences:[],reputationSummary:{}},capabilities={},refresh=()=>{};
const cancelled=false,TABS=[],setSelectedTab=value=>window.selectedTab=value;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,APP_LOCAL_BOOKING_QUERY_KEYS=[];
const ExperienceCard=()=>null,EmptyState=({title,children})=><section data-empty><h4>{title}</h4>{children}</section>;
${originalSocial}
${summary}
${experiences}
${descriptor}
${tabFromHash}
${syncTabFromHash}
window.commentCalls=0;window.handoffs=[];
createRoot(document.getElementById('root')).render(<AppLocalNavigationProvider value={{path:'/explore',navigate:path=>window.handoffs.push(['router',path]),refresh:()=>{}}}><>
<section id='post'><ExploreSocialActions salon={{id:'salon',href:'/explore/salons/salon',name:'Salon'}} href='/post/id' target={{sourceId:'post-id'}} onComment={()=>window.commentCalls++}/></section>
<section id='salon'><ExploreSocialActions salon={{id:'salon',href:'/explore/salons/salon',name:'Salon'}} href='/explore/salons/salon'/></section>
<section id='missing'><ExploreSocialActions href='/post/missing' target={{sourceId:'invalid'}}/></section>
{renderExperiences()}<a id='trust-link' href='#lumi-trust'>Trust details</a><a id='experience-link' href='#customer-experiences'>Read experiences</a>
<div hidden><div id='hidden-target'>Hidden tab</div></div><a id='hidden-link' href='#hidden-target'>Open tab</a>
<AppLocalLink id='native-same-page' href='/explore#customer-experiences'>Native same-page link</AppLocalLink>
<a id='salon-local' href='/explore/salons/00000000-0000-4000-8000-000000000001#customer-experiences'>Salon experience destination</a>
<a id='salon-unknown' href='/explore/salons/00000000-0000-4000-8000-000000000001#unknown'>Unknown destination</a>
</></AppLocalNavigationProvider>);
installAppLocalLinkNavigation({navigate:path=>window.handoffs.push(['local',path]),isLocalRoute:path=>Boolean(descriptor(path)),openOnline:path=>window.handoffs.push(['hosted',path])});
window.hashEvents=0;window.addEventListener('hashchange',()=>window.hashEvents++);
window.addEventListener('hashchange',syncTabFromHash);
(()=>{${scrollEffect}})();
window.anchorForTest=salonProfileAnchor;
window.descriptorForTest=descriptor;
`;
const bundled=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic'});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><div id="root"></div><script>${bundled.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`}));
  await page.goto('https://reylumi.com/explore');
  await page.locator('#post button[aria-label="Comment"]').click();
  assert.equal(await page.evaluate(()=>window.commentCalls),1);
  assert.equal(await page.locator('#salon a[aria-label="Customer experiences"]').getAttribute('href'),'/explore/salons/salon#customer-experiences');
  assert.equal(await page.locator('#salon [aria-label="Comment"]').count(),0);
  assert.equal(await page.locator('#missing [aria-label="Comment"],#missing a').count(),0);
  assert.equal(await page.locator('#customer-experiences [data-empty]').count(),1,'Empty experiences still have a real anchor');
  assert.equal(await page.locator('#lumi-trust').getAttribute('open'),null);
  await page.locator('#trust-link').click();
  await page.waitForFunction(()=>document.getElementById('lumi-trust').open);
  await page.locator('#experience-link').click();
  await page.waitForFunction(()=>location.hash==='#customer-experiences');
  assert.equal(await page.evaluate(()=>window.anchorForTest(location.hash).targetId),'customer-experiences');
  await page.locator('#hidden-link').click();
  assert.equal(await page.evaluate(()=>location.hash),'#hidden-target');
  assert.ok(await page.evaluate(()=>window.hashEvents>=3));
  await page.locator('#native-same-page').click();
  assert.equal(await page.evaluate(()=>location.hash),'#customer-experiences');
  assert.deepEqual(await page.evaluate(()=>window.handoffs),[],'Same-page anchors never open a second hosted window');
  await page.locator('#salon-local').click();
  await page.locator('#salon-unknown').click();
  assert.deepEqual(await page.evaluate(()=>window.handoffs.map(item=>item[0])),['local','hosted']);
  const salon='/explore/salons/00000000-0000-4000-8000-000000000001';
  for(const hash of ['#customer-experiences','#reviews','#feedback-good','#feedback-issue','#lumi-trust','#lumi-trust-details']) assert.equal(await page.evaluate(path=>window.descriptorForTest(path)?.name,salon+hash),'public.salon');
  const post='/explore/beauty/00000000-0000-4000-8000-000000000001/posts/00000000-0000-4000-8000-000000000002';
  assert.equal(await page.evaluate(path=>window.descriptorForTest(path)?.name,post+'#comments'),'public.beauty-post');
  for(const path of [salon+'#comments',salon+'?token=private#customer-experiences',post+'?token=private#comments','/login#comments','/staff/invite/token#comments','//external.invalid'+salon+'#customer-experiences']) assert.equal(await page.evaluate(path=>window.descriptorForTest(path),path),null,path);
  for(const hash of ['#reviews','#feedback-good','#feedback-issue'])assert.equal(await page.evaluate(hash=>window.anchorForTest(hash).targetId,hash),'customer-experiences');
  await page.evaluate(()=>{history.pushState(null,'','/explore#feedback-issue');window.dispatchEvent(new HashChangeEvent('hashchange'));});
  await page.waitForFunction(()=>window.selectedTab==='experiences'&&window.experienceFilter==='issues');
  await page.evaluate(()=>{history.pushState(null,'','/explore#reviews');window.dispatchEvent(new HashChangeEvent('hashchange'));});
  await page.waitForFunction(()=>window.experienceFilter==='all');
  assert.equal(await page.evaluate(()=>window.anchorForTest('#comments')),null,'Post comments cannot be redirected to salon Trust');
  await page.screenshot({path:'artifacts/navigation-comment-audit-20261028/browser.png',fullPage:true});
  console.log('PASS: post comment action, salon experience semantics, invalid post target, empty experiences, collapsed/explicit Trust, same-page hidden anchors, feedback destinations. Native XCTest still requires Xcode.');
}finally{await browser.close();}

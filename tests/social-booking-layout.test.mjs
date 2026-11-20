import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {buildSocialWidgetFixture,buildSocialJourneyFixture} from './fixtures/social-booking-layout.mjs';

const dir='artifacts/social-booking-layout-20261119';
const executablePath=[process.env.TEST_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));
const options={skip:!executablePath,timeout:120000};
let browser,widgets,journeys;
const keyboardCases=[{height:360,offsetTop:0},{height:360,offsetTop:60},{height:220,offsetTop:0}];

before(async()=>{
 if(!executablePath)return;
 mkdirSync(dir,{recursive:true});
 [widgets,journeys]=await Promise.all([buildSocialWidgetFixture(),buildSocialJourneyFixture()]);
 browser=await chromium.launch({executablePath,headless:true});
},{timeout:120000});
after(async()=>{await browser?.close()});

async function fixture(bundle,kind){
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],requests=[];
 page.setDefaultTimeout(6000);
 page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const viewport=new EventTarget();
  Object.assign(viewport,{height:innerHeight,width:innerWidth,offsetTop:0,offsetLeft:0,scale:1});
  Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
  window.setFixtureViewport=({height,offsetTop=0})=>{Object.assign(viewport,{height,offsetTop});viewport.dispatchEvent(new Event('resize'));viewport.dispatchEvent(new Event('scroll'))};
 });
 await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='https://social-layout.test'){requests.push(url.href);return route.abort()}
  if(url.pathname==='/api/public-booking/context'&&bundle.booking)return route.fulfill({json:bundle.booking});
  if(url.pathname==='/app.js')return route.fulfill({contentType:'text/javascript',body:bundle.js});
  return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${bundle.css}</style><div id="root"></div><script src="/app.js"></script>`});
 });
 await page.goto('https://social-layout.test/explore?kind='+kind);
 if(bundle===widgets){await page.waitForFunction(()=>window.show);await page.evaluate(value=>window.show(value),kind)}
 return{page,errors,requests};
}
async function bounds(locator){return locator.evaluate(element=>{
 const box=element.getBoundingClientRect(),viewport=visualViewport,point={x:box.left+box.width/2,y:box.top+box.height/2};
 const hit=document.elementFromPoint(point.x,point.y);
 return{box:box.toJSON(),visible:box.top>=viewport.offsetTop-1&&box.bottom<=viewport.offsetTop+viewport.height+1,hit:hit===element||element.contains(hit)};
})}
async function setViewport(page,value){await page.evaluate(value=>window.setFixtureViewport(value),value);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))))}
async function revealAction(action){
 await action.evaluate(element=>{
  const viewport=visualViewport;
  for(let panel=element.parentElement;panel&&panel!==document.body;panel=panel.parentElement){
   if(!/(auto|scroll)/.test(getComputedStyle(panel).overflowY)||panel.scrollHeight<=panel.clientHeight)continue;
   const box=panel.getBoundingClientRect(),target=element.getBoundingClientRect();
   const top=Math.max(viewport.offsetTop,box.top)+4,bottom=Math.min(viewport.offsetTop+viewport.height,box.bottom)-4;
   panel.scrollTop+=target.bottom>bottom?target.bottom-bottom:target.top<top?target.top-top:0;
  }
 });
}
async function assertOrdinarySizes(page,dialog,action){
 for(const viewport of [{width:320,height:844},{width:844,height:390},{width:820,height:1180}]){
  await page.setViewportSize(viewport);await setViewport(page,{height:viewport.height});
  await revealAction(action);
  const primary=await bounds(action),panel=await bounds(dialog);
  assert.ok(panel.box.left>=-1&&panel.box.right<=viewport.width+1,JSON.stringify({viewport,panel}));
  assert.equal(primary.visible,true,JSON.stringify({viewport,primary}));
  assert.equal(primary.hit,true,JSON.stringify({viewport,primary}));
  await action.click({trial:true});
  assert.equal(await page.evaluate(()=>Boolean(document.querySelector('[data-overlay-keyboard="true"]'))),false,'ordinary resized layouts must not receive a keyboard inset');
 }
 await page.setViewportSize({width:390,height:844});await setViewport(page,{height:844});
}
async function assertKeyboard(page,kind,dialog,input,action){
 const initial=await bounds(dialog),draft=await input.inputValue(),scroll=await page.evaluate(()=>scrollY);
 const evidence=[];
 for(const viewport of keyboardCases){
  await input.focus();await setViewport(page,viewport);
  assert.equal(await page.evaluate(()=>innerHeight),844,'keyboard must shrink only visual viewport');
  const focused=await bounds(input);
  assert.equal(focused.visible,true,JSON.stringify({kind,viewport,focused}));
  assert.equal(focused.hit,true,JSON.stringify({kind,viewport,focused}));
  assert.equal(await input.inputValue(),draft,'viewport changes must retain entered text');
  await revealAction(action);
  const primary=await bounds(action);
  assert.equal(primary.visible,true,JSON.stringify({kind,viewport,primary}));
  assert.equal(primary.hit,true,JSON.stringify({kind,viewport,primary}));
  await action.click({trial:true});
  assert.equal(await page.evaluate(()=>scrollY),scroll,'modal scrolling must not move retained page');
  evidence.push({viewport,focused,primary});
  await page.screenshot({path:`${dir}/${kind}-${viewport.height}-${viewport.offsetTop}.png`});
 }
 await setViewport(page,{height:844});
 const restored=await bounds(dialog);
 for(const dimension of ['top','left','width','height'])assert.ok(Math.abs(restored.box[dimension]-initial.box[dimension])<=1,JSON.stringify({kind,dimension,initial,restored}));
 assert.equal(await input.inputValue(),draft);
 writeFileSync(`${dir}/${kind}.json`,JSON.stringify(evidence,null,2));
}

test('social reports and My Place keep focused fields, primary actions and drafts usable above the keyboard',options,async t=>{
 for(const kind of ['post-edit','text-report','salon-report','create-salon'])await t.test(kind,async()=>{
  const {page,errors,requests}=await fixture(widgets,kind);
  try{
   let dialog,input,action;
   if(kind==='post-edit'){dialog=page.getByRole('dialog',{name:'Edit post',exact:true});input=dialog.getByLabel('Post caption');action=dialog.getByRole('button',{name:'Save changes',exact:true})}
   if(kind==='text-report'){await page.getByRole('button',{name:'Report',exact:true}).click();dialog=page.getByRole('dialog',{name:'Report content',exact:true});input=dialog.locator('textarea');action=dialog.getByRole('button',{name:'Send report',exact:true})}
   if(kind==='salon-report'){dialog=page.getByRole('dialog',{name:'Report salon',exact:true});await dialog.getByLabel('Other problem',{exact:true}).check();input=dialog.locator('textarea');action=dialog.getByRole('button',{name:'Send report',exact:true})}
   if(kind==='create-salon'){dialog=page.getByRole('dialog',{name:'Create salon',exact:true});input=dialog.getByLabel('ZIP code',{exact:true});action=dialog.getByRole('button',{name:'Create salon',exact:true})}
   await dialog.waitFor();await input.fill(kind==='create-salon'?'53202':'Preserved local draft');
   await assertOrdinarySizes(page,dialog,action);await assertKeyboard(page,kind,dialog,input,action);
   if(kind==='create-salon'){
    page.once('dialog',prompt=>prompt.dismiss());await dialog.getByRole('button',{name:'Close panel',exact:true}).click();
    assert.equal(await dialog.isVisible(),true,'dirty My Place close must still allow refusal');
    assert.equal(await input.inputValue(),'53202');
    page.once('dialog',prompt=>prompt.accept());await dialog.getByRole('button',{name:'Close panel',exact:true}).click();
   }else if(kind==='salon-report'){await dialog.getByRole('button',{name:'Close report',exact:true}).click()}
   else{await dialog.getByRole('button',{name:'Close',exact:true}).click()}
   await dialog.waitFor({state:'hidden'});
   await page.waitForFunction(()=>!document.querySelector('[data-overlay-keyboard="true"]'));
   if(kind==='text-report')assert.equal(await page.getByRole('button',{name:'Report',exact:true}).evaluate(e=>e===document.activeElement),true);
   assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
   assert.ok((await page.evaluate(()=>window.calls)).every(call=>call.action==='permissions'),'layout checks must never send a social/business mutation');
  }finally{await page.close()}
 });
});

test('Beauty editor, Forum moderation and quick-booking customer details use the actual flows above the keyboard',options,async t=>{
 for(const kind of ['beauty-profile','forum-report','forum-restrict','forum-section','quickbooking'])await t.test(kind,async()=>{
  const {page,errors,requests}=await fixture(journeys,kind);
  try{
   let dialog,input,action;
   if(kind==='beauty-profile'){await page.getByRole('button',{name:'Edit Beauty profile',exact:true}).click();dialog=page.getByRole('dialog',{name:'Beauty profile',exact:true});input=dialog.locator('textarea');action=dialog.getByRole('button',{name:'Save',exact:true})}
   if(kind==='forum-report'||kind==='forum-restrict'){
    const card=page.locator('[data-forum-topic=fixture-topic]');
    assert.equal(await card.evaluate(e=>getComputedStyle(e).contentVisibility),'auto','closed posts retain feed containment');
    await page.getByLabel('Content actions',{exact:true}).click();
    const trigger=page.getByRole('button',{name:kind==='forum-report'?'Report':'Restrict author',exact:true});
    await trigger.click({trial:true});assert.equal((await bounds(trigger)).hit,true,'expanded card menu must escape paint clipping');
    await trigger.click();dialog=page.locator('dialog[open]');input=dialog.locator('textarea[name=reason]');action=dialog.getByRole('button',{name:'Confirm',exact:true});
   }
   if(kind==='forum-section'){await page.getByLabel('Your profile and forum menu',{exact:true}).click();await page.getByRole('button',{name:'Quản lý',exact:true}).click();await page.getByRole('button',{name:'Sections',exact:true}).click();await page.getByRole('button',{name:'+ Add section',exact:true}).click();dialog=page.locator('dialog[open]');input=dialog.locator('input[name=reason]');action=dialog.getByRole('button',{name:'Save section',exact:true})}
   if(kind==='quickbooking'){await page.getByRole('button',{name:'Open quick booking',exact:true}).click();dialog=page.getByRole('dialog',{name:'Quick booking',exact:true});input=dialog.locator('#public-booking-phone');action=dialog.getByTestId('public-booking-next')}
   await dialog.waitFor();await input.fill(kind==='quickbooking'?'+14145550101':'Preserved local draft');
   await assertOrdinarySizes(page,dialog,action);await assertKeyboard(page,kind,dialog,input,action);
   if(kind==='beauty-profile'){await revealAction(dialog.getByRole('button',{name:'Close',exact:true}));await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Edit Beauty profile')}
   else if(kind.startsWith('forum-')){await revealAction(dialog.getByRole('button',{name:'Cancel',exact:true}));await dialog.getByRole('button',{name:'Cancel',exact:true}).click()}
   else{await revealAction(dialog.getByRole('button',{name:'Close booking',exact:true}));await dialog.getByRole('button',{name:'Close booking',exact:true}).click()}
   await dialog.waitFor({state:'hidden'});
   await page.waitForFunction(()=>!document.querySelector('[data-overlay-keyboard="true"]'));
   if(kind==='forum-report'||kind==='forum-restrict'){
    await page.getByLabel('Content actions',{exact:true}).click();
    assert.equal(await page.locator('[data-forum-topic=fixture-topic]').evaluate(e=>getComputedStyle(e).contentVisibility),'auto','closed menu must restore feed optimization');
   }
   assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
   assert.ok((await page.evaluate(()=>window.calls)).every(call=>['fixture forum read','fixture slots'].includes(call.action)),'fixture must not write forum, booking or profile data');
  }finally{await page.close()}
 });
});

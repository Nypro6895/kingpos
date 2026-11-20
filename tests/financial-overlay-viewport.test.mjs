import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';

const artifactDir='artifacts/financial-overlay-viewport-20261119';
const executablePath=[
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);
const origin='http://127.0.0.1:19839';
const staffCatalog={enabled:true,customerContactVisible:false,staffId:'fixture-staff',timezone:'America/Chicago',services:[{id:'fixture-service',name:'Manicure',price:25,minutes:30}],staff:[{id:'fixture-staff',name:'Alex'}],assignments:[{staffId:'fixture-staff',serviceId:'fixture-service'}]};
const checkState={businessDate:'2026-11-19',salonId:'fixture-salon',salonIssuer:'Audit salon',salonAddress:'',active:true,subscribed:true,settings:{issuer:'Audit salon',address:'',useSalon:true,bankName:'Fixture Bank',last4:'0000',nextNumber:1001,version:1,stock:'preprinted',offsetX:0,offsetY:0,stubs:{same:true,payee:[],salon:[]}},runs:[],selectedRun:null,lines:[],history:[],events:[]};

async function bundle(){
  const mocks={
    '@/components/workspace-language':`export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as:Tag='span',...props})=><Tag {...props}/>;export const useWorkspaceTranslation=()=>text=>text;`,
    'next/navigation':`import{useSyncExternalStore}from'react';const subscribe=f=>{window.addEventListener('popstate',f);return()=>window.removeEventListener('popstate',f)};const router={refresh(){},replace(url){history.replaceState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'))},push(url){history.pushState({},'',url);window.dispatchEvent(new PopStateEvent('popstate'))}};export const useRouter=()=>router;export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname,()=>'/pos/portable');export const useSearchParams=()=>new URLSearchParams();`,
    'next/link':`export default({prefetch,...props})=><a {...props}/>;`,
    'next/image':`export default({unoptimized,fill,...props})=><img {...props}/>;`,
    '@/lib/pos-workspace-sync':`export const subscribePosChanges=()=>()=>{};`,
    '@/lib/rewardlumi-client':`export const rewardTransport=()=>async()=>({installed:false,view:null});`,
  };
  const built=await build({
    stdin:{contents:readFileSync('tests/fixtures/financial-overlay-viewport-fixture.tsx','utf8'),resolveDir:process.cwd(),loader:'tsx'},
    bundle:true,write:false,outdir:'fixture',jsx:'automatic',
    plugins:[{name:'offline-financial-layout',setup(b){
      b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);
      b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
      b.onResolve({filter:/actions$/},a=>{
        const file=path.resolve(a.path.startsWith('@/')?a.path.slice(2):path.join(path.dirname(a.importer),a.path))+'.ts';
        return existsSync(file)?{path:file,namespace:'action'}:undefined;
      });
      b.onLoad({filter:/.*/,namespace:'action'},a=>({contents:[...readFileSync(a.path,'utf8').matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(([,name])=>`export async function ${name}(){window.financialMutationCalls.push('${name}');throw Error('Unexpected financial action: ${name}');}`).join('\n')}));
    }}],
  });
  const css=(await postcss([tailwind()]).process(readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css+'\n'+built.outputFiles.filter(f=>f.path.endsWith('.css')).map(f=>f.text).join('\n')+'\n'+readFileSync('app/settings/settings-controls.css','utf8')+'\nbody{margin:0;font-family:Arial,sans-serif}';
  return {js:built.outputFiles.find(f=>f.path.endsWith('.js')).text,css};
}

async function newPage(browser,fixture,viewport){
  const page=await browser.newPage({viewport});
  page.setDefaultTimeout(5000);
  const errors=[],unexpected=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const viewport=new EventTarget();
    Object.assign(viewport,{height:innerHeight,width:innerWidth,offsetTop:0,offsetLeft:0,scale:1});
    Object.defineProperty(window,'visualViewport',{value:viewport,configurable:true});
    window.setFinancialViewport=(height,offsetTop=0,scale=1)=>{
      Object.assign(viewport,{height,offsetTop,scale});
      viewport.dispatchEvent(new Event('resize'));viewport.dispatchEvent(new Event('scroll'));
    };
  });
  await page.route('**/*',r=>{
    const url=new URL(r.request().url());
    if(url.origin!==origin||r.request().method()!=='GET'){unexpected.push(r.request().method()+' '+url.href);return r.abort();}
    if(url.pathname==='/api/staff/create-appointment')return r.fulfill({json:staffCatalog});
    if(url.pathname==='/api/check-writer')return r.fulfill({json:checkState});
    if(url.pathname.endsWith('.js'))return r.fulfill({contentType:'text/javascript',body:fixture.js});
    return r.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fixture.css}</style><div id="root"></div><script src="/fixture.js"></script>`});
  });
  await page.goto(origin+'/pos/portable');
  await page.waitForFunction(()=>typeof window.showFinancialOverlay==='function');
  return {page,errors,unexpected};
}

async function show(page,kind){
  await page.evaluate(kind=>window.showFinancialOverlay(kind),kind);
  if(kind==='tip'||kind==='discount')await page.getByRole('button',{name:kind==='tip'?'Tip':'Discount',exact:true}).click();
  if(kind==='staff-create')await page.getByRole('button',{name:'Create appointment',exact:true}).click();
  if(kind==='receipt')await page.getByRole('button',{name:'Open',exact:true}).click();
  if(kind==='check-writer')await page.getByRole('button',{name:'Unlock Check Writer',exact:true}).click();
  if(kind==='tax-receipt'){
    await page.getByRole('tab',{name:'Receipts',exact:true}).click();
    await page.getByRole('button',{name:'＋ Add receipt',exact:true}).click();
  }
  if(kind.startsWith('relay')){
    await page.getByRole('button',{name:/Service tickets/}).click();
    if(kind==='relay-edit')await page.getByRole('button',{name:'Edit services & amounts',exact:true}).click();
  }
  const dialog=page.getByRole('dialog').last();await dialog.waitFor();
  const field=kind.startsWith('custom')?dialog.getByLabel('Service name',{exact:true}):kind==='profile'?dialog.getByLabel('Nickname',{exact:true}):kind==='tip'||kind==='discount'?dialog.getByLabel(kind==='tip'?'Tip amount':'Discount amount',{exact:true}):kind==='staff-create'?dialog.getByLabel('Customer name',{exact:true}):kind==='receipt'?dialog.getByLabel('Additional receipt footer',{exact:true}):kind==='check-writer'?dialog.getByLabel('Password',{exact:true}):kind==='tax-receipt'?dialog.locator('[name="description"]'):kind==='relay-edit'?dialog.getByLabel('POS amount 1',{exact:true}):dialog.getByLabel('Tip',{exact:true});
  const action=dialog.getByRole('button',{name:kind.startsWith('custom')?'Done':kind==='profile'?'Save Staff Profile':kind==='tip'||kind==='discount'?'Apply':kind==='staff-create'?'Create appointment':kind==='receipt'?'Save':kind==='check-writer'?'Verify':kind==='tax-receipt'?'Save receipt':kind==='relay-edit'?'Save ticket':'Payment collected · Submit',exact:true});
  const value=['tip','discount','relay-payment','relay-edit'].includes(kind)?'5':'Preserved draft';
  await field.fill(value);await field.focus();
  return {dialog,field,action,value};
}

async function setViewport(page,height,offsetTop=0,scale=1){
  await page.evaluate(({height,offsetTop,scale})=>window.setFinancialViewport(height,offsetTop,scale),{height,offsetTop,scale});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
}

async function hit(locator){return locator.evaluate(element=>{
  const box=element.getBoundingClientRect(),viewport=visualViewport;
  const target=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
  return {box:box.toJSON(),top:viewport.offsetTop,bottom:viewport.offsetTop+viewport.height,visible:box.top>=viewport.offsetTop-1&&box.bottom<=viewport.offsetTop+viewport.height+1,receivesClick:target===element||element.contains(target),target:target?.tagName};
});}
async function reachable(locator){
  await locator.scrollIntoViewIfNeeded();
  const actual=await hit(locator);
  assert.equal(actual.visible,true,JSON.stringify(actual));
  assert.equal(actual.receivesClick,true,JSON.stringify(actual));
}

async function close(page,kind,dialog){
  if(kind==='profile')await dialog.getByRole('button',{name:'Close Staff Profile settings',exact:true}).last().click();
  else if(kind==='staff-create')await dialog.getByRole('button',{name:'Close create appointment',exact:true}).click();
  else if(kind.startsWith('relay')||kind==='tax-receipt')await dialog.getByRole('button',{name:'Close',exact:true}).click();
  else await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(()=>!document.querySelector('[data-overlay-keyboard]'));
}

test('financial overlays retain actions and drafts through keyboard resize, pan, short height and restore',{
  skip:!executablePath,timeout:180000,
},async t=>{
  const fixture=await bundle();mkdirSync(artifactDir,{recursive:true});
  const browser=await chromium.launch({executablePath,headless:true});
  const evidence=[];
  try{
    for(const kind of['custom-touch','custom-system','profile','tip','discount','staff-create','receipt','check-writer','tax-receipt','relay-payment','relay-edit']){
      await t.test(kind,async()=>{
        for(const viewport of[{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:820,height:1180}]){
          const {page,errors,unexpected}=await newPage(browser,fixture,viewport);
          try{
            const {dialog,field,action,value}=await show(page,kind);
            const initial=await dialog.boundingBox();
            await reachable(action);
            assert.equal(await page.locator('[data-overlay-keyboard]').count(),0,'ordinary layout receives no keyboard overrides');
            if(viewport.width===390&&kind!=='custom-touch'){
              for(const [height,offsetTop] of [[360,0],[360,60],[220,0]]){
                await field.focus();await setViewport(page,height,offsetTop);
                assert.equal(await page.evaluate(()=>innerHeight),844,'visual keyboard must not resize the layout viewport');
                assert.equal((await hit(field)).visible,true,'focused input must be automatically revealed: '+JSON.stringify(await hit(field)));
                await reachable(action);
                assert.equal(await field.inputValue(),value,'viewport changes must retain typed input');
                assert.equal(await page.evaluate(()=>scrollY),0,'only modal panels may scroll');
                evidence.push({kind,...viewport,height,offsetTop,action:await hit(action)});
                await page.screenshot({path:`${artifactDir}/${kind}-keyboard-${height}-${offsetTop}.png`});
              }
              await setViewport(page,844);
              assert.equal(await page.locator('[data-overlay-keyboard]').count(),0,'keyboard dismissal must restore inline styles');
              const restored=await dialog.boundingBox();
              assert.ok(Math.abs(initial.height-restored.height)<=1&&Math.abs(initial.width-restored.width)<=1,JSON.stringify({initial,restored}));
              assert.equal(await field.inputValue(),value);
            }
            await reachable(action);
            await page.screenshot({path:`${artifactDir}/${kind}-${viewport.width}x${viewport.height}.png`});
            await close(page,kind,dialog);
            assert.equal(await page.locator('[data-overlay-keyboard]').count(),0,'closing must clean up fitted overlays');
            assert.deepEqual(await page.evaluate(()=>window.financialMutationCalls),[]);
            assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
          }finally{await page.close();}
        }
      });
    }
    await t.test('UI-only completion and cancel paths preserve boundaries',async()=>{
      const {page,errors,unexpected}=await newPage(browser,fixture,{width:390,height:844});
      try{
        let state=await show(page,'custom-system');await setViewport(page,360,60);await reachable(state.action);await state.action.click();
        assert.deepEqual(await page.evaluate(()=>window.financialUiResults),['Preserved draft']);
        await setViewport(page,844);state=await show(page,'tip');await state.action.click();
        assert.deepEqual(await page.evaluate(()=>window.financialUiResults),['Preserved draft',['tip','5','fixed_amount']]);
        state=await show(page,'receipt');await close(page,'receipt',state.dialog);await page.getByRole('button',{name:'Open',exact:true}).click();
        assert.equal(await page.getByLabel('Additional receipt footer',{exact:true}).inputValue(),'','Cancel must not save device preferences');
        await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
        state=await show(page,'check-writer');await close(page,'check-writer',state.dialog);await page.getByRole('button',{name:'Unlock Check Writer',exact:true}).click();
        assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'','Cancel must retain existing credential clearing');
        assert.deepEqual(await page.evaluate(()=>window.financialMutationCalls),[]);
        assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
      }finally{await page.close();}
    });
    await t.test('navigation and unmount remove fitted overlays without financial work',async()=>{
      const {page,errors,unexpected}=await newPage(browser,fixture,{width:390,height:844});
      try{
        for(const kind of ['profile','tip','discount','staff-create','receipt','relay-payment','relay-edit']){
          await setViewport(page,844);
          const {dialog,field,value}=await show(page,kind);
          await setViewport(page,360,60);
          assert.equal(await field.inputValue(),value);
          await page.evaluate(()=>document.dispatchEvent(new Event('reylumi:overlay-navigation')));
          await dialog.waitFor({state:'hidden'});
          // Native close events are queued after the top layer is hidden.
          await page.waitForFunction(()=>!document.querySelector('[data-overlay-keyboard]'));
          assert.equal(await page.locator('[data-overlay-keyboard]').count(),0,kind+' must remove fitted presentation on navigation');
        }
        for(const kind of ['custom-system','check-writer','tax-receipt']){
          await setViewport(page,844);
          const {dialog}=await show(page,kind);await setViewport(page,220);
          await page.evaluate(()=>window.showFinancialOverlay('closed'));
          await dialog.waitFor({state:'hidden'});
          assert.equal(await page.locator('[data-overlay-keyboard]').count(),0,kind+' must remove fitted presentation on unmount');
        }
        assert.deepEqual(await page.evaluate(()=>window.financialMutationCalls),[]);
        assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
        assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
      }finally{await page.close();}
    });
  }finally{await browser.close();writeFileSync(`${artifactDir}/metrics.json`,JSON.stringify(evidence,null,2));}
});

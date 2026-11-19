import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {chromium} from 'playwright-core';

const root=path.resolve(import.meta.dirname,'..');
const evidence=process.env.QA_FIX_EVIDENCE_DIR||path.join(root,'artifacts/android-overlay-avatar');
const bridge=fs.readFileSync(path.join(root,'android/app/src/main/assets/NativeBridge.js'),'utf8');
const origin='http://localhost:3119';

test('authored native overlay dismissal and avatar-only actions retain the real component contracts',{timeout:90000},async()=>{
  const contents=`import React,{useRef,useState}from'react';import{createRoot}from'react-dom/client';
    import{useNativeOverlayDismissal}from'@/components/overlay-dismissal';
    import{AccountProfileEditor}from'@/app/account/account-profile-editor';
    import{StaffBookingSettings}from'@/app/staff/appointments/staff-booking-settings-client';
    window.reylumiAndroid={postMessage(){}};window.attempts={top:0,lower:0};window.busy=true;
    const params=new URL(location.href).searchParams;window.translated=params.get('locale')==='vi';
    function Guarded(){const low=useRef(null),top=useRef(null);const[lower,L]=useState(true),[upper,U]=useState(true),[busy,B]=useState(true),[dirty,D]=useState(false);
      useNativeOverlayDismissal(low,()=>{window.attempts.lower++;L(false)},lower);
      useNativeOverlayDismissal(top,()=>{window.attempts.top++;if(!busy&&!dirty)U(false)},upper);
      return <><details open data-dismissible-popover><summary>More</summary>Keep menu</details>{lower&&<aside ref={low} role="dialog" aria-label="Lower"><input defaultValue="Lower draft"/></aside>}{upper&&<aside ref={top} role="dialog" aria-label="Upper"><input defaultValue="Unsaved draft"/><button onClick={()=>{B(false);D(true)}}>Finish pending</button><button onClick={()=>D(false)}>Allow close</button></aside>}</>}
    const user={id:'person',auth_user_id:'auth',display_name:'QA Avatar',first_name:'QA',last_name:'Avatar',email:'qa@example.invalid',phone:null,avatar_url:null,status:'active',language:'en',timezone:'America/Chicago',created_at:'2026-01-01'};
    const staff={id:'staff',displayName:'QA Staff',jobTitle:null,onlineBookingEnabled:true};
    const rules=Array.from({length:7},(_,day)=>({id:String(day),staff_id:'staff',is_active:true,rule_type:'working',day_of_week:day,starts_at_local:'08:00:00',ends_at_local:'20:00:00',timezone_iana:'America/Chicago'}));
    const view=params.get('view');function App(){return view==='guard'?<Guarded/>:view==='staff'?<StaffBookingSettings salonId="salon" assignedServices={[{id:'service',name:'Manicure',durationMinutes:30,onlineBookable:true}]} availabilityRules={rules} salonBookingStatus={{onlineBookingOpen:true,state:'active'}} staff={staff} timeBlocks={[]} timezone="America/Chicago" variant="toolbar"/>:view==='full'?<AccountProfileEditor user={user} createdAtLabel="Jan 1" embedded/>:<div className="settings-hub"><div aria-hidden="true" style={{minHeight:"100vh"}}/><div className="settings-child-pages" data-settings-child-open="true"><div className="settings-security-dialog" role="dialog" aria-modal="true" aria-label="Change avatar"><section><button>Close</button><AccountProfileEditor user={user} createdAtLabel="Jan 1" embedded avatarOnly/></section></div></div></div>}
    createRoot(document.getElementById('root')).render(<App/>);`;
  const unexpected=`async()=>{throw Error('Unexpected fixture mutation')}`;
  const mocks={
    'next/navigation':`export const useRouter=()=>({refresh(){},push(){},replace(){}});export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`,
    'next/link':`import React from'react';export default function Link(props){return <a {...props}/>}`,
    '@/components/workspace-language':`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>window.translated&&text==='Close booking settings'?'Đóng cài đặt đặt lịch':text;`,
    '@/components/salon-language-preferences':`export const LanguageSetting=()=>null;`,
    '@/components/time-zone-select':`export const TimeZoneSelect=()=>null;`,
    '@/app/account/phone-change-actions':`export const authorizePhoneChangeAction=${unexpected};`,
    '@/app/account/actions':`export const getAccountAvatarUploadSessionAction=${unexpected};export const sendAccountPhoneVerificationOtpAction=${unexpected};export const updateAccountProfileAction=${unexpected};export const verifyAccountPhoneOtpAction=${unexpected};`,
    '@/app/booking-setup/actions':`export const cancelStaffTimeBlockAction=${unexpected};export const createStaffTimeBlockAction=${unexpected};export const saveStaffWeeklyAvailabilityAction=${unexpected};`,
  };
  const bundle=await build({stdin:{contents,resolveDir:root,loader:'tsx'},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'server-boundaries',setup(b){
    b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:undefined);
    b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:root}));
  }}]});
  const utilityCss=await postcss([tailwind()]).process('@import "tailwindcss" source(none);\n@source "./app/account/account-profile-editor.tsx";\n@source "./app/staff/appointments/staff-booking-settings-client.tsx";',{from:path.join(root,'fixture.css')});
  const css=[utilityCss.css,bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text||'',fs.readFileSync(path.join(root,'app/settings/settings-hub.css'),'utf8'),fs.readFileSync(path.join(root,'app/settings/settings-compact-children.css'),'utf8'),fs.readFileSync(path.join(root,'app/staff/appointments/staff-appointments.css'),'utf8')].join('\n');
  fs.mkdirSync(evidence,{recursive:true});
  const browser=await chromium.launch(process.env.TEST_BROWSER_PATH?{executablePath:process.env.TEST_BROWSER_PATH,headless:true}:{channel:'chrome',headless:true});
  const errors=[];
  try{
    const page=await browser.newPage({viewport:{width:384,height:748},serviceWorkers:'block'});
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>{
      const u=new URL(r.request().url());
      if(u.origin!==origin)return r.abort('blockedbyclient');
      if(u.pathname==='/fixture.js')return r.fulfill({contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
      if(u.pathname==='/api/staff/booking-preferences'){
        assert.deepEqual(r.request().postDataJSON(),{salonId:'salon'});
        return r.fulfill({json:{ok:true,online:true,notifications:true}});
      }
      return r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'\nbody{margin:0;font-family:Arial}.workspace-mobile-nav{position:fixed;bottom:0;height:88px;width:100%}#root{min-height:100vh}</style><nav class="workspace-mobile-nav">Navigation</nav><div id="root"></div><script src="/fixture.js"></script>'});
    });
    const open=async query=>{await page.goto(origin+'/?'+query);await page.addScriptTag({content:bridge.replace("const trustedOrigin = 'https://reylumi.com';",`const trustedOrigin = '${origin}';`)});};
    await open('view=guard');await page.getByRole('dialog',{name:'Upper',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
    assert.equal(await page.getByRole('dialog',{name:'Upper',exact:true}).getByRole('textbox').inputValue(),'Unsaved draft');
    assert.deepEqual(await page.evaluate(()=>window.attempts),{top:1,lower:0});
    await page.getByRole('button',{name:'Finish pending'}).click();
    assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
    assert.equal(await page.getByRole('dialog',{name:'Upper',exact:true}).getByRole('textbox').inputValue(),'Unsaved draft');
    assert.deepEqual(await page.evaluate(()=>window.attempts),{top:2,lower:0});
    await page.getByRole('button',{name:'Allow close'}).click();
    assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
    await page.getByRole('dialog',{name:'Upper',exact:true}).waitFor({state:'detached'});
    assert.equal(await page.getByRole('dialog',{name:'Lower',exact:true}).count(),1);
    assert.equal(await page.locator('details').evaluate(e=>e.open),true);
    assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
    await page.getByRole('dialog',{name:'Lower',exact:true}).waitFor({state:'detached'});
    assert.deepEqual(await page.evaluate(()=>window.attempts),{top:3,lower:1});
    assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
    assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),false);
    for(const locale of ['en','vi']){
      await open('view=staff&locale='+locale);
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      const sheet=page.getByRole('dialog',{name:'Booking settings',exact:true});await sheet.waitFor();
      await sheet.evaluate(e=>e.scrollTop=e.scrollHeight);
      assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);
      await sheet.waitFor({state:'detached'});
      await page.getByRole('button',{name:'Settings',exact:true}).click();await sheet.waitFor();
      assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),true);await sheet.waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>window.__reylumiAndroidBack()),false);
    }
    const avatarResults=[];
    for(const size of [{width:384,height:748},{width:748,height:384}])for(const keyboard of [false,true]){
      await page.setViewportSize(size);await open('view=avatar');await page.getByRole('button',{name:'Change photo',exact:true}).waitFor();
      await page.evaluate(k=>{document.documentElement.dataset.keyboardOpen=String(k);document.documentElement.style.setProperty('--visible-viewport-height','300px')},keyboard);
      const geometry=await page.getByRole('button',{name:'Change photo',exact:true}).evaluate(photo=>{const p=photo.getBoundingClientRect();const save=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save profile');const s=save.getBoundingClientRect();const row=save.parentElement.parentElement;const hit=document.elementFromPoint(p.x+p.width/2,p.y+p.height/2);return {photo:{x:p.x,y:p.y,w:p.width,h:p.height},save:{x:s.x,y:s.y,w:s.width,h:s.height},position:getComputedStyle(row).position,bottom:getComputedStyle(row).bottom,hit:hit?.closest('button')===photo,hitTag:hit?.tagName,hitText:hit?.textContent?.slice(0,80)}});
      await page.screenshot({path:path.join(evidence,`avatar-${size.width}-${keyboard?'ime':'normal'}.png`)});
      assert.equal(geometry.position,'static');assert.equal(geometry.hit,true,JSON.stringify({size,keyboard,geometry}));
      const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Change photo',exact:true}).click();await(await chooser).setFiles([]);
      avatarResults.push({size,keyboard,geometry});
    }
    await page.setViewportSize({width:384,height:748});await open('view=full');await page.getByRole('button',{name:'Edit',exact:true}).click();
    const actionPosition=()=>page.getByRole('button',{name:'Save profile',exact:true}).evaluate(b=>{const s=getComputedStyle(b.parentElement.parentElement);return {position:s.position,bottom:s.bottom}});
    assert.deepEqual(await actionPosition(),{position:'sticky',bottom:'88px'});
    await page.evaluate(()=>{document.documentElement.dataset.keyboardOpen='true';document.documentElement.style.setProperty('--visible-viewport-height','400px')});
    assert.equal((await actionPosition()).position,'fixed');
    fs.writeFileSync(path.join(evidence,'runtime-results.json'),JSON.stringify({avatarResults,fullProfileFooter:'sticky88/fixed-with-keyboard-flag preserved',realNativeImeTested:false,pageErrors:errors},null,2));
    assert.deepEqual(errors,[]);
  }finally{await browser.close()}
});

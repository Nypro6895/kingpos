import assert from "node:assert/strict";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import test from "node:test";

test("approved profile surfaces, real/default/broken photos and thumbnail selection", {timeout:120000}, async()=>{
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{SalonWebsiteHome}from'./app/salon-profile/salon-website-home';
    import{SalonWebsiteHeader}from'./app/salon-profile/salon-website-header';
    import{SalonProfilePreferencesPanel}from'./app/settings/salon-profile-preferences-panel';
    import styles from './app/salon-profile/salon-website-header.module.css';
    window.events=[];
    function App(){const[config,setConfig]=useState({layout:'booking',mode:'empty'});window.configure=(layout,mode)=>setConfig({layout,mode});
      const profile={salonId:'king-nails',name:'King Nails Spa LLC',city:'Milwaukee',state:'WI',serviceCategories:['Nails'],tagline:'Nails in Milwaukee',description:config.mode==='full'?'Professional nail care in a welcoming, friendly environment.':null,coverImageUrl:config.mode==='own'?'/own.webp':config.mode==='broken'?'/broken.webp':null};
      const preferences={layout:config.layout,show_featured:config.mode!=='hidden',show_services:true,show_team:true,show_customer_reviews:true};
      const services=config.mode==='empty'?[]:[{id:'manicure',name:'Manicure',category:'Nails',basePrice:25,durationMinutes:30}];
      const posts=config.mode==='own'?[{id:'photo',title:'Our work',contentType:'look',publishedAt:'2026-10-29',imageUrl:'/own.webp',serviceId:'manicure',isPinned:true}]:[];
      if(config.mode==='settings')return <div className="settings"><SalonProfilePreferencesPanel onSaved={()=>window.events.push('saved')}/></div>;
      return <main className={styles.shell}><div className="wrap"><SalonWebsiteHeader profile={profile} layout={config.layout} tabs={[{id:'discover',label:'Overview'},{id:'gallery',label:'Gallery'},{id:'services',label:'Services'},{id:'team',label:'Team'}]} extraTabs={[]} selectedTab="discover" onTab={()=>{}} onTabKeyDown={()=>{}} canBook={services.length>0} introVisible={preferences.show_featured} onBook={()=>window.events.push('book')} canFollow={false} following={false} followPending={false} onFollow={()=>{}} onHours={()=>{}} canShare={false} onShare={()=>{}}/></div><section role="tabpanel" className="wrap"><SalonWebsiteHome key={config.layout+config.mode} data={{profile,services,staff:[],experiences:[],operatingHours:null}} preferences={preferences} posts={posts} canBook={services.length>0} onPost={()=>window.events.push('photo')} onGallery={()=>window.events.push('gallery')} onServices={()=>{}} onTeam={()=>{}} onBook={()=>window.events.push('book')}/></section></main>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,outdir:"fixture",jsx:"automatic",plugins:[{name:"fixture-server-boundaries",setup(b){
    b.onResolve({filter:/workspace-language$|post-actions$|operating-hours-actions|quick-booking-client$|salon-verification-panel$|salon-profile-preferences-actions$/},args=>({path:args.path,namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},()=>({loader:"tsx",resolveDir:process.cwd(),contents:`import React from "react";export function WorkspaceElement({as,children,...props}){return React.createElement(as,props,children)};export function WorkspaceText({text}){return text};export function useWorkspaceTranslation(){return text=>text};export function PostActions(){return null};export function preloadQuickBooking(){};export function SalonVerificationPanel(){return null};export async function loadVisibleProfileHours(){return {settings:null}};export async function loadSalonProfilePreferencesAction(){return {preferences:{layout:'balanced',show_featured:true,show_services:true,show_team:true,show_customer_reviews:false}}};export async function saveSalonProfilePreferencesAction(preferences){window.events.push('save:'+preferences.layout);return {preferences}};` }));
  }}]});
  const browser=await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  mkdirSync("artifacts/profile-layout-defaults/screenshots",{recursive:true});
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error('Fixture page error:',error.message)});
    const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
    await page.route('http://profile.test/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path==='/')return route.fulfill({contentType:'text/html',body:
        '<style>*{box-sizing:border-box}body{margin:0;font-family:Arial;color:#292524}h2,h3,h4,p{margin:0}button{font:inherit;cursor:pointer}.wrap{width:100%;max-width:1200px;margin:auto;padding:0 20px 24px}.settings{max-width:620px;padding:20px;margin:auto}.grid{display:grid}.gap-5{gap:20px}.gap-3{gap:12px}.flex{display:flex}.items-center{align-items:center}.items-start{align-items:flex-start}.shrink-0{flex-shrink:0}.min-w-0{min-width:0}.border{border:1px solid #e4e4e7}.rounded-xl{border-radius:12px}.rounded-2xl{border-radius:16px}.p-3{padding:12px}.p-4{padding:16px}.text-xs{font-size:12px}.text-sm{font-size:14px}.text-zinc-500{color:#71717a}.block{display:block}.mt-1{margin-top:4px}.border-brand-orange{border-color:#f26f3d}.bg-brand-orange-soft{background:#fff3ec}.settings label{cursor:pointer}.settings fieldset{min-width:0}.settings button[type=submit]{min-height:44px;background:#f26f3d;color:white;border:0;border-radius:8px;padding:12px}.settings input{accent-color:#f26f3d}'+css+'</style><div id="root"></div><script src="/app.js"></script>'});
      if(path==='/app.js')return route.fulfill({contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text});
      if(path==='/broken.webp')return route.fulfill({status:404,body:''});
      const local=path==='/own.webp'?'public/images/nail-defaults/nails-02.webp':'public'+path;
      return existsSync(local)?route.fulfill({contentType:'image/webp',body:readFileSync(local)}):route.fulfill({status:404,body:''});
    });
    await page.goto('http://profile.test/');
    const configure=async(layout,mode)=>{await page.evaluate(([l,m])=>window.configure(l,m),[layout,mode]);await page.locator(mode==='settings'?'.settings':'[data-layout="'+layout+'"]').first().waitFor();await page.waitForFunction(()=>[...document.images].every(i=>i.complete));};
    for(const width of [320,390,768,1280])for(const layout of ['booking','portfolio','balanced'])for(const mode of ['empty','full','own','broken','hidden']){
      await page.setViewportSize({width,height:900});await configure(layout,mode);
      const context=layout+'/'+mode+'/'+width;
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),context+' overflow');
      const feature=page.locator('[aria-label="Salon introduction"]');
      assert.equal(await feature.count(),Number(mode!=='hidden'),context);
      if(mode==='hidden')continue;
      const images=await feature.locator('img').evaluateAll(images=>images.map(i=>({src:i.getAttribute('src'),ok:i.complete&&i.naturalWidth>0})));
      assert.ok(images.length>0&&images.every(i=>i.ok),context+' missing/failing defaults');
      if(mode==='own'){
        assert.ok(images.some(i=>i.src==='/own.webp'),context+' did not replace default');
        assert.equal(await feature.getByText(/Illustrative image/).count(),0,context+' real photo labelled default');
      }else assert.ok(await feature.getByText(/Illustrative image/).count()>0,context+' missing credit');
      if(mode==='empty'){
        assert.equal(await page.getByRole('button',{name:/Book appointment/}).count(),0);
        assert.equal(await page.getByText(/Selected work|Latest from the salon|What our customers say/).count(),0);
      }
      if(width===390&&mode==='full')await page.screenshot({path:'artifacts/profile-layout-defaults/screenshots/'+layout+'.png',fullPage:true});
    }
    await page.setViewportSize({width:390,height:900});await configure('balanced','settings');
    const radios=page.getByRole('radio',{name:/[ABC] ·/});await radios.first().waitFor();assert.equal(await radios.count(),3);
    assert.equal(await page.locator('[aria-hidden=true][data-layout]').count(),3);
    await page.getByRole('radio',{name:/B · Visual portfolio/}).check();
    assert.equal(await page.getByRole('radio',{name:/B · Visual portfolio/}).isChecked(),true);
    assert.deepEqual(await page.evaluate(()=>window.events),[],'selection must not save before submission');
    await page.screenshot({path:'artifacts/profile-layout-defaults/screenshots/settings.png',fullPage:true});
    await page.getByRole('button',{name:'Save profile settings',exact:true}).click();
    await page.getByText('Profile settings saved.',{exact:true}).waitFor();
    assert.deepEqual(await page.evaluate(()=>window.events),['save:portfolio','saved']);
    for(const width of [320,390,1280]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'settings overflow '+width);}
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

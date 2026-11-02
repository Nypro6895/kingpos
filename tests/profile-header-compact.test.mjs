import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import test from 'node:test';

test('compact profile identity, owner controls, Experiences rail and publication state',async()=>{
  const bundle=await build({stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{SalonWebsiteHeader}from'./app/salon-profile/salon-website-header';
    import{SalonPublicationStatus}from'./components/salon-publication-status';
    import styles from './app/salon-profile/salon-website-header.module.css';
    window.events=[];
    function App(){const[config,setConfig]=useState({layout:'balanced',owner:true,long:false,public:true});const[tab,setTab]=useState('discover');const[open,setOpen]=useState(false);window.configure=c=>{setConfig(c);setTab('discover');setOpen(false)};
      const tabs=[{id:'discover',label:'Overview'},{id:'gallery',label:'Gallery'},{id:'services',label:'Services'},{id:'team',label:'Team'},{id:'experiences',label:'Experiences'}];
      const change=id=>{setTab(id);window.events.push(id)};
      return <main className={styles.shell}><div className="wrap"><SalonPublicationStatus publicHref={config.public?'/salon/test':null}/><SalonWebsiteHeader profile={{name:config.long?'King Nails Spa LLC '+('Very long business name ').repeat(5):'King Nails Spa LLC',city:'Milwaukee',state:'WI',operatingStatus:{kind:'closed',label:'Closed',detail:'Opens at 9 AM',isOpen:false}}} layout={config.layout} tabs={tabs} extraTabs={[{id:'about',label:'About'}]} selectedTab={tab} onTab={change} onTabKeyDown={e=>{if(e.key==='ArrowRight'){e.preventDefault();change(tabs[(tabs.findIndex(t=>t.id===tab)+1)%tabs.length].id)}}} tools={config.owner?<div><button type="button" aria-label="Profile settings" aria-expanded={open} onClick={()=>setOpen(!open)}>⚙</button>{open?<div className="settings-menu" role="menu"><button role="menuitem" onClick={()=>window.events.push('settings')}>Profile settings</button><button role="menuitem" onClick={()=>window.events.push('hours')}>Operating hours</button></div>:null}</div>:null} trust={<span>Building LUMI Trust · 0 visits · 0 opinions</span>} canBook={!config.owner} canFollow={!config.owner} following={false} followPending={false} onBook={()=>window.events.push('book')} onFollow={()=>window.events.push('follow')} onHours={()=>window.events.push('hours')} canShare={true} onShare={()=>window.events.push('share')}/><section role="tabpanel" id={'salon-profile-'+tab}>{tab==='experiences'?'No customer experiences yet.':'Profile content'}</section></div></main>;
    }createRoot(document.getElementById('root')).render(<App/>);
  `},bundle:true,write:false,outdir:'fixture',jsx:'automatic',plugins:[{name:'translation-fixture',setup(b){b.onResolve({filter:/workspace-language$/},()=>({path:'translation',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({loader:'tsx',contents:'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>x=>x;'}));}}]});
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  mkdirSync('artifacts/profile-header-compact/screenshots',{recursive:true});
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://header.test/**',route=>new URL(route.request().url()).pathname==='/app.js'?route.fulfill({contentType:'text/javascript',body:bundle.outputFiles.find(f=>f.path.endsWith('.js')).text}):route.fulfill({contentType:'text/html',body:'<style>*{box-sizing:border-box}body{margin:0;font-family:Arial}button{font:inherit;cursor:pointer}h2,p{margin:0}.wrap{padding:16px;max-width:1200px;margin:auto}.settings-menu{position:absolute;right:0;top:44px;background:white;z-index:99;display:grid;width:200px;border:1px solid #ddd}.settings-menu button{min-height:44px;text-align:left}[aria-label="Profile settings"]{height:44px;width:44px;background:transparent;border:0;font-size:26px}[role=tabpanel]{padding-top:20px}'+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text+'</style><div id="root"></div><script src="/app.js"></script>'}));
    await page.goto('http://header.test/');await page.getByRole('heading').waitFor();
    for(const width of [320,390,428,768,1280])for(const layout of ['booking','portfolio','balanced'])for(const long of [false,true]){
      await page.setViewportSize({width,height:926});await page.evaluate(c=>window.configure(c),{layout,owner:true,long,public:true});
      const heading=page.getByRole('heading');const settings=page.getByRole('button',{name:'Profile settings',exact:true});
      const h=await heading.boundingBox(),s=await settings.boundingBox();
      assert.ok(Math.abs(h.y-s.y)<12,'settings must align with name first line');
      assert.ok(s.x>=h.x+h.width-1,'settings must not overlap title');
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow');
      assert.equal(await page.getByRole('link',{name:/View public|View as customer/}).count(),0);
      assert.equal(await page.getByText('Nails $40').count(),0);
      assert.equal(await page.getByRole('tab',{name:'Experiences',exact:true}).count(),1);
      await settings.click();await page.getByRole('menuitem',{name:'Profile settings',exact:true}).click();assert.equal(await page.evaluate(()=>window.events.at(-1)),'settings');await settings.click();
      await page.getByRole('tab',{name:'Experiences',exact:true}).click();await page.getByText('No customer experiences yet.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('tab',{name:'Experiences',exact:true}).getAttribute('aria-selected'),'true');
      if(width===428&&layout==='balanced'&&!long){await page.getByRole('tab',{name:'Overview',exact:true}).click();await page.screenshot({path:'artifacts/profile-header-compact/screenshots/owner-header.png',fullPage:true});}
    }
    await page.evaluate(()=>window.configure({layout:'balanced',owner:false,long:false,public:true}));
    await page.getByRole('button',{name:'Book appointment',exact:false}).click();assert.equal(await page.evaluate(()=>window.events.at(-1)),'book');
    assert.equal(await page.getByRole('button',{name:'Profile settings',exact:true}).count(),0);
    await page.getByRole('button',{name:'+ Follow salon',exact:true}).click();assert.equal(await page.evaluate(()=>window.events.at(-1)),'follow');
    await page.evaluate(()=>window.configure({layout:'balanced',owner:true,long:false,public:false}));await page.getByText('Not public',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    // Ensure actual parent wiring promotes Experiences and has no extra header CTA.
    const view=readFileSync('app/salon-profile/salon-profile-view.tsx','utf8');
    const header=view.slice(view.indexOf('{isWebsiteView ? <SalonWebsiteHeader'),view.indexOf('/> : (',view.indexOf('{isWebsiteView ? <SalonWebsiteHeader')));
    assert.doesNotMatch(header,/priceHint|Read customer experiences/);
    assert.match(view,/isWebsiteView \? \["experiences"\]/);
    assert.doesNotMatch(readFileSync('app/salon-profile/salon-profile-studio.tsx','utf8'),/text="View public profile"/);
  }finally{await browser.close();}
});

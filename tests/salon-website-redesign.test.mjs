import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";

test("redesigned websites and identity header fit full, sparse, empty and long profiles; photos fail gracefully", {
  skip: !process.env.ESBUILD_MODULE_PATH, timeout: 120000,
}, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{SalonWebsiteHome}from'./app/salon-profile/salon-website-home';
    import{SalonWebsiteHeader}from'./app/salon-profile/salon-website-header';
    import{PostActions}from'./app/salon-profile/post-actions';
    import pageStyles from './app/salon-profile/salon-website-header.module.css';
    const status={kind:'open',isOpen:true,label:'Open now',detail:'Until 6 PM',localDate:'2026-10-05'};
    const hours={timeZone:'America/Chicago',status,weeklyHours:[1,2,3,4,5,6].map(dayOfWeek=>({dayOfWeek,opensAtLocal:'09:00',closesAtLocal:dayOfWeek===6?'17:00':'18:00'})),specialHours:[]};
    const services=[{id:'full-set',name:'Full set',basePrice:65,durationMinutes:60},{id:'gel',name:'Gel manicure',basePrice:45,durationMinutes:45},{id:'manicure',name:'Manicure',basePrice:35,durationMinutes:30},{id:'pedicure',name:'Pedicure',basePrice:50,durationMinutes:45}];
    const team=[{id:'tracy',displayName:'Tracy',jobTitle:'Nail artist',avatarUrl:null,specialties:['Gel manicure'],onlineBookingEnabled:true},{id:'tram',displayName:'Tram',jobTitle:'Nail artist',avatarUrl:null,onlineBookingEnabled:false}];
    const posts=Array.from({length:5},(_,i)=>({id:String(i),title:['Featured floral','Modern chrome','Soft neutrals','Everyday pink','Fine details'][i],caption:null,contentType:'look',imageUrl:'/work-'+i+'.webp',isPinned:i===0,publishedAt:'2026-10-'+String(5-i).padStart(2,'0'),serviceId:i===0?'full-set':null}));
    const experiences=[{id:'review',authorUserId:'customer',authorDisplayName:'Anna',body:'A welcoming team and a lovely manicure. I enjoyed my visit.',rating:5,feedbackState:'good',verificationStatus:'unverified',source:'experience',createdAt:'2026-10-01'}];
    window.events=[];
    function App(){const[config,setConfig]=useState({layout:'balanced',mode:'full'});const[selected,setSelected]=useState('discover');
      window.configure=(layout,mode='full')=>{setConfig({layout,mode});setSelected('discover')};
      const sparse=config.mode==='sparse',empty=config.mode==='empty',long=config.mode==='long';
      const profile={salonId:'salon',name:long?'King Nails & Beauty Studio '+('A very long business name ').repeat(5):'King Nails',city:empty?null:'Milwaukee',state:empty?null:'WI',tagline:sparse||empty?null:'Care for every detail.',description:sparse||empty?null:long?'Our salon story. '.repeat(100):'A welcoming neighborhood salon for everyday care and thoughtful details.',story:long?'Our team story. '.repeat(100):null,addressLine1:sparse||empty?null:'8333 W Appleton Ave',phone:sparse||empty?null:'414-555-0100',logoImageUrl:config.mode==='broken'?'/broken-logo.svg':null,operatingStatus:sparse||empty?{kind:'hours_unset'}:status};
      const content=sparse||empty?[]:config.mode==='small'?posts.map((post,i)=>i===0?{...post,imageUrl:'/small.svg'}:post):config.mode==='broken'?posts.map(post=>({...post,imageUrl:'/broken-'+post.id+'.svg'})):posts;
      const data={profile,services:empty?[]:sparse?services.slice(0,2):long?services.map(service=>({...service,name:service.name+' '+('Long service name ').repeat(10)})):services,staff:sparse||empty?[]:team,operatingHours:sparse||empty?null:hours,experiences:sparse||empty?[]:experiences};
      const preferences={layout:config.layout,show_featured:config.mode!=='hidden',show_services:true,show_team:true,show_customer_reviews:true,customer_review_count:2};
      const tabs=[{id:'discover',label:'Overview'},...(content.length?[{id:'gallery',label:'Gallery'}]:[]),...(data.services.length?[{id:'services',label:'Services'}]:[]),...(data.staff.length?[{id:'team',label:'Team'}]:[])];
      return <main className={pageStyles.shell}><div className="identity-wrap"><SalonWebsiteHeader profile={profile} layout={config.layout} tabs={tabs} extraTabs={empty||sparse?[]:[{id:'experiences',label:'Experiences'}]} selectedTab={selected} introVisible={config.mode!=="hidden"} onTab={id=>{setSelected(id);window.events.push('tab:'+id)}} onTabKeyDown={()=>{}} canBook={!empty} onBook={()=>window.events.push('book')} canFollow={!empty&&!sparse} following={false} followPending={false} onFollow={()=>window.events.push('follow')} onHours={()=>window.events.push('hours')} canShare={true} onShare={()=>window.events.push('share')}/></div>
      <section role="tabpanel" className="body-wrap"><SalonWebsiteHome key={config.layout+config.mode} data={data} preferences={preferences} posts={content} canBook={!empty}
        onPost={post=>window.events.push('post:'+post.id)} onGallery={()=>window.events.push('gallery')} onServices={()=>window.events.push('services')} onTeam={()=>window.events.push('team')} onStaff={member=>window.events.push('staff:'+member.id)} onReviews={()=>window.events.push('reviews')} onBook={context=>window.events.push('book:'+JSON.stringify(context))} renderPostActions={post=><PostActions onOpen={()=>window.events.push('post:'+post.id)} onShare={()=>window.events.push('share:'+post.id)}/>}/></section></main>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, outdir: "fixture", jsx: "automatic", plugins: [{ name: "server-stubs", setup(build) {
    build.onResolve({ filter: /operating-hours-actions|quick-booking-client$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ resolveDir: process.cwd(), loader: "tsx", contents: "export function preloadQuickBooking(){};export async function loadVisibleProfileHours(){return {settings:null,error:null}}" }));
  }}] });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  mkdirSync("work/profile-redesign-review", { recursive: true });
  try {
    const page = await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('http://redesign.test/',route=>route.fulfill({contentType:'text/html',body:`<style>*{box-sizing:border-box}body{margin:0;font-family:Arial;color:#292524}button{font:inherit;border:0;cursor:pointer}h2,h3,h4,p{margin:0}.identity-wrap,.body-wrap{width:100%;max-width:1200px;margin:auto;padding-left:24px;padding-right:24px}.body-wrap{padding-bottom:32px}@media(max-width:599px){.identity-wrap,.body-wrap{padding-left:16px;padding-right:16px}}${bundle.outputFiles.find(file=>file.path.endsWith('.css')).text}</style><div id="root"></div><script src="/app.js"></script>`}));
    await page.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',body:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text}));
    const filenames=['mockup-look-floral.webp','mockup-look-chrome.webp','mockup-look-nude.webp','mockup-look-softpink.webp','mockup-look-floral.webp'];
    for(let index=0;index<filenames.length;index++) await page.route('**/work-'+index+'.webp',route=>route.fulfill({contentType:'image/webp',body:readFileSync('public/explore/'+filenames[index])}));
    await page.route('**/small.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="90"><rect width="120" height="90" fill="#dec7bc"/></svg>'}));
    await page.route('**/broken-*.svg',route=>route.fulfill({status:404,body:''}));
    await page.goto('http://redesign.test/');
    await page.waitForFunction(()=>typeof window.configure==='function');
    for(const width of [320,390,768,1024,1440]) for(const layout of ['booking','portfolio','balanced']) for(const mode of ['full','sparse','empty','long','hidden']) {
      await page.setViewportSize({width,height:1000});
      await page.evaluate(({layout,mode})=>window.configure(layout,mode),{layout,mode});
      const home=page.locator('.body-wrap>[data-layout]');
      await home.locator('section').first().waitFor();
      await page.waitForFunction(({layout})=>document.querySelector('.body-wrap>[data-layout]')?.getAttribute('data-layout')===layout,{layout});
      const context=layout+'/'+width+'/'+mode;
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,context+' overflow');
      const boxes=await home.locator(':scope>section').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom}}));
      for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) assert.ok(!(boxes[i].x<boxes[j].right&&boxes[i].right>boxes[j].x&&boxes[i].y<boxes[j].bottom&&boxes[i].bottom>boxes[j].y),context+' overlapping sections');
      if(mode==='sparse'||mode==='empty') {
        assert.equal(await home.locator('img').count(),0,context);
        assert.equal(await home.getByRole('heading',{name:/Visit|Plan your visit|Our team|What our customers say|About/}).count(),0,context);
        assert.equal(await page.getByText(/Hours not set|Loading operating hours|Welcome to our salon/).count(),0,context);
        assert.equal(await page.getByRole('tab',{name:'Gallery',exact:true}).count(),0,context);
      }
      if(mode==='empty') assert.equal(await page.getByRole('button',{name:/Book/}).count(),0,context);
      if(width<600) assert.ok(boxes.every(box=>Math.abs(box.x-16)<1&&Math.abs(box.right-(width-16))<1),context+' mobile sections must use full width');
      if((width===390||width===1440)&&(mode==='full'||mode==='sparse')) {
        await page.evaluate(()=>window.scrollTo(0,0));
        await page.waitForFunction(()=>Array.from(document.querySelectorAll('.body-wrap img')).every(img=>img.complete));
        await page.screenshot({path:'work/profile-redesign-review/'+layout+'-'+mode+'-'+width+'.png',fullPage:true});
      }
    }
    await page.setViewportSize({width:390,height:1000});
    await page.evaluate(()=>window.configure('portfolio','small'));
    await page.waitForFunction(()=>document.querySelector('.body-wrap [aria-label="Salon introduction"] img')?.getAttribute('src')!=='/small.svg');
    assert.ok(await page.locator('.body-wrap img[src="/small.svg"]').count(), 'Small image remains available as a thumbnail');
    await page.evaluate(()=>window.configure('balanced','broken'));
    await page.waitForFunction(()=>document.querySelectorAll('.body-wrap img').length===0);
    await page.waitForFunction(()=>document.querySelector('[data-website-header] img')===null);
    assert.equal(await page.getByRole('button',{name:'Book Full set',exact:true}).count(),1);
    await page.getByRole('button',{name:'Book Full set',exact:true}).click();
    assert.match(await page.evaluate(()=>window.events.at(-1)),/full-set/);
    await page.getByRole('button',{name:'Book with Tracy',exact:true}).click();
    assert.match(await page.evaluate(()=>window.events.at(-1)),/tracy/);
    assert.equal(await page.getByRole('button',{name:'Book with Tram',exact:true}).count(),0);
    await page.getByRole('button',{name:'View salon operating hours',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.events.at(-1)),'hours');
    await page.getByRole('button',{name:'+ Follow salon',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.events.at(-1)),'follow');
    await page.getByLabel('More profile sections and actions').click();
    await page.getByRole('button',{name:'Share profile',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.events.at(-1)),'share');
    assert.equal(await page.locator('details[open]').count(),0);
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

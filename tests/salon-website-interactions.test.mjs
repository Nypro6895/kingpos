import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";

test("website layouts: settings save, owner composer, service/staff booking and opening posts", { skip: !process.env.ESBUILD_MODULE_PATH, timeout: 120000 }, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const view = readFileSync("app/salon-profile/salon-profile-view.tsx", "utf8");
  const composer = view.slice(view.indexOf("function ComposerCard("), view.indexOf("function PostSuggestionField("));
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{SalonWebsiteHome}from'./app/salon-profile/salon-website-home';import{PostActions}from'./app/salon-profile/post-actions';
    import{SalonProfilePreferencesPanel}from'./app/settings/salon-profile-preferences-panel';
    import{QuickBooking}from'./components/quick-booking';
    function Avatar(){return <span aria-hidden="true">KN</span>} ${composer}
    const data={profile:{name:'King Nails',salonId:'11111111-1111-4111-8111-111111111111',city:'Milwaukee',state:'WI',addressLine1:'8333 W Appleton Ave',phone:'4145550100',story:'A welcoming neighborhood salon.'},services:[{id:'full-set',name:'Full-Set',category:'Nails',basePrice:40,durationMinutes:45},{id:'manicure',name:'Manicure',category:'Nails',basePrice:45,durationMinutes:45}],staff:[{id:'tracy',displayName:'Tracy',avatarUrl:'/portrait.webp',jobTitle:'Nail artist',specialties:['Full-Set'],onlineBookingEnabled:true},{id:'tram',displayName:'Tram',avatarUrl:null,jobTitle:'Nail artist',onlineBookingEnabled:false}]};
    data.experiences=[{id:'review-1',authorUserId:'customer-1',authorDisplayName:'Anna',body:'Beautiful work and such a welcoming team. My nails look lovely.',rating:5,feedbackState:'good',verificationStatus:'verified',source:'experience',createdAt:'2026-10-02'},{id:'review-2',authorUserId:'customer-2',authorDisplayName:'Lisa',body:'A relaxing visit and a wonderful manicure. Thank you!',rating:5,feedbackState:'good',verificationStatus:'verified',source:'experience',createdAt:'2026-09-25'},{id:'review-3',authorUserId:'customer-3',authorDisplayName:'Kim',body:'Friendly service and a great selection of colors.',rating:4,feedbackState:'good',verificationStatus:'unverified',source:'experience',createdAt:'2026-09-20'}];
    const initial=[{id:'pinned',title:'Featured floral',imageUrl:'/nail.webp',serviceId:'full-set',contentType:'look',publishedAt:'2026-09-01',isPinned:true},{id:'new',title:'New chrome',imageUrl:'/chrome.webp',contentType:'look',publishedAt:'2026-10-02'},{id:'old',title:'Classic nude',imageUrl:'/nude.webp',contentType:'look',publishedAt:'2026-09-25'}];
    window.events=[];window.mixed=()=>{};
    function App(){const[preferences,setPreferences]=useState({layout:'balanced',show_customer_reviews:true,customer_review_count:3,show_featured:true,show_services:true,show_team:true,allow_staff_posts:true,allow_sharing:true,allow_saves:true,allow_comments:true});const[owner,setOwner]=useState(false);const[settings,setSettings]=useState(false);const[posts,setPosts]=useState(initial);
      window.mixed=()=>setPosts(initial.map((p,i)=>({...p,imageUrl:'/mixed-'+i+'.svg'})));window.configure=(layout,isOwner)=>{setPreferences(p=>({...p,layout}));setOwner(isOwner);setSettings(false)};window.publish=()=>setPosts(p=>[{...initial[1],id:'published',title:'Just published',publishedAt:'2026-10-03'},...p]);
      return <><button onClick={()=>setSettings(!settings)}>Open settings</button>{settings?<SalonProfilePreferencesPanel onSaved={p=>{setPreferences(p);window.saved=p;setSettings(false)}}/>:null}<SalonWebsiteHome data={data} preferences={preferences} posts={posts} canBook onPost={p=>window.events.push('post:'+p.id)} onStaff={s=>window.events.push('staff:'+s.id)} renderPostActions={post=><PostActions onOpen={()=>window.events.push('post:'+post.id)} onShare={()=>window.events.push('share:'+post.id)} onFeature={owner?()=>window.events.push('feature:'+post.id):undefined}/>} onReviews={()=>window.events.push('reviews')} onGallery={()=>window.events.push('gallery')} onServices={()=>window.events.push('services')} onTeam={()=>window.events.push('team')} onBook={ctx=>{const params=new URLSearchParams({source:'public_profile'});if(ctx.serviceId)params.set('serviceId',ctx.serviceId);if(ctx.staffId)params.set('staffId',ctx.staffId);window.dispatchEvent(new CustomEvent('reylumi:quick-book',{detail:{href:'/book/'+data.profile.salonId+'?'+params}}))}} composer={owner?<ComposerCard name="King Nails" logoUrl={null} onOpen={mode=>window.events.push('compose:'+mode)}/>:null}/><QuickBooking/></>}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, outdir: "fixture", jsx: "automatic", plugins: [{ name: "server-fixture", setup(build) {
    build.onResolve({filter:/salon-verification-panel$/},args=>({path:args.path,namespace:"verification-fixture"}));
    build.onLoad({filter:/.*/,namespace:"verification-fixture"},()=>({loader:"tsx",contents:"export function SalonVerificationPanel(){return null}"}));
    build.onResolve({filter:/operating-hours-actions|salon-profile-preferences-actions|public-booking-client$/}, args => ({path:args.path,namespace:"fixture"}));
    build.onLoad({filter:/.*/,namespace:"fixture"}, args => ({resolveDir:process.cwd(),loader:"tsx",contents:args.path.includes("public-booking-client") ? `import React from 'react';export function PublicBookingClient({data,onClose}){return <div><p>Selected service: {data.initialSelection.serviceId||'none'}</p><p>Selected staff: {data.initialSelection.staffId||'none'}</p><button onClick={onClose}>Close booking</button></div>}` : args.path.includes("preferences") ? `export async function loadSalonProfilePreferencesAction(){return {preferences:{layout:'balanced',show_customer_reviews:true,customer_review_count:3,show_featured:true,show_services:true,show_team:true,allow_staff_posts:true,allow_sharing:true,allow_saves:true,allow_comments:true}}}export async function saveSalonProfilePreferencesAction(preferences){return {preferences}}` : `export async function loadVisibleProfileHours(){return {settings:{timeZone:'America/Chicago',status:{isOpen:false,label:'Closed',detail:'Opens tomorrow at 9 AM',localDate:'2026-10-02'},weeklyHours:[{dayOfWeek:1,opensAtLocal:'09:00',closesAtLocal:'18:00'}],specialHours:[]}}}` }));
  }}] });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  mkdirSync("work/profile-layout-review",{recursive:true});
  try {
    const page = await browser.newPage(); const errors=[]; page.on("pageerror",e=>errors.push(e.message));
    await page.route("http://layout.test/",route=>route.fulfill({contentType:"text/html",body:`<style>*{box-sizing:border-box}body{margin:0;background:#f6f5f3;padding:12px;font-family:Arial}button{border:0;font:inherit;cursor:pointer}h3,h4,p{margin:0}${result.outputFiles.find(file=>file.path.endsWith('.css')).text}</style><div id="root"></div><script src="/app.js"></script>`}));
    await page.route("**/app.js",route=>route.fulfill({contentType:"text/javascript",body:result.outputFiles.find(file=>file.path.endsWith('.js')).text}));
    for(const[name,file]of Object.entries({"nail.webp":"mockup-look-floral.webp","chrome.webp":"mockup-look-chrome.webp","nude.webp":"mockup-look-nude.webp","portrait.webp":"mockup-look-softpink.webp"}))await page.route(`**/${name}`,route=>route.fulfill({contentType:"image/webp",body:readFileSync(`public/explore/${file}`)}));
    await page.route("**/api/public-booking/context?*",route=>{const url=new URL(route.request().url());return route.fulfill({json:{initialSelection:{serviceId:url.searchParams.get('serviceId'),staffId:url.searchParams.get('staffId')}}});});
    for(const [i,width,height] of [[0,600,900],[1,1200,700],[2,800,800]]) await page.route('**/mixed-'+i+'.svg',route=>route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#d9b2a7"/><text x="20" y="50" font-size="24">${width} × ${height}</text></svg>`}));
    await page.goto("http://layout.test/"); await page.getByRole("heading",{name:"Services",exact:true}).waitFor();
    for(const width of [320,390,1440])for(const layout of ["booking","portfolio","balanced"]){
      await page.setViewportSize({width,height:1000});await page.evaluate(layout=>window.configure(layout,false),layout);
      await page.locator(`[data-layout="${layout}"]`).waitFor();
      assert.equal(await page.getByRole('button',{name:'Create a photo post'}).count(),0);
      const actions=page.getByLabel('Post actions',{exact:true}).first();await actions.click();
      assert.equal(await page.getByRole('menuitem',{name:'Use as featured photo',exact:true}).count(),0);
      const bounds=await page.getByRole('menu').boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width);
      await page.getByRole('menuitem',{name:'Share post',exact:true}).click();assert.ok((await page.evaluate(()=>window.events.at(-1))).startsWith('share:'));
      await actions.click();await page.getByRole('menu').waitFor();await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'hidden'});assert.equal(await page.getByRole('menu').count(),0);
      await actions.click();await page.getByRole('menu').waitFor();await page.getByRole('button',{name:'Open settings',exact:true}).click();await page.getByRole('menu').waitFor({state:'hidden'});assert.equal(await page.getByRole('menu').count(),0);await page.getByRole('button',{name:'Open settings',exact:true}).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.getByRole('button',{name:'Book Full-Set',exact:true}).click();await page.getByText('Selected service: full-set').waitFor();await page.getByRole('button',{name:'Close booking',exact:true}).click();
      await page.getByRole('button',{name:'Book with Tracy',exact:true}).click();await page.getByText('Selected staff: tracy').waitFor();await page.getByRole('button',{name:'Close booking',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Book with Tram',exact:true}).count(),0);
      await page.getByRole('button',{name:"View Tracy's profile",exact:true}).click();assert.equal(await page.evaluate(()=>window.events.at(-1)),'staff:tracy');
      await page.locator('[id="look-new"]').click();assert.equal(await page.evaluate(()=>window.events.at(-1)),'post:new');
      if(width!==320)await page.screenshot({path:`work/profile-layout-review/${layout}-${width}.png`,fullPage:true});
      await page.evaluate(layout=>window.configure(layout,true),layout);await page.getByRole('button',{name:'Create a photo post'}).click();assert.equal(await page.evaluate(()=>window.events.at(-1)),'compose:look');assert.equal(await page.getByRole('button',{name:'Choose featured photo',exact:true}).count(),0);
      await page.getByLabel('Post actions',{exact:true}).first().click();await page.getByRole('menuitem',{name:'Use as featured photo',exact:true}).click();assert.ok((await page.evaluate(()=>window.events.at(-1))).startsWith('feature:'));
    }
    await page.evaluate(()=>window.mixed());
    for(const width of [320,390,768,1440])for(const layout of ['booking','portfolio','balanced']){
      await page.setViewportSize({width,height:1000});await page.evaluate(layout=>window.configure(layout,true),layout);
      await page.locator('[data-layout="'+layout+'"] img[alt="Featured floral"][data-orientation="portrait"]').first().waitFor();
      await page.locator('[id="look-new"] img[data-orientation="landscape"]').waitFor();
      await page.locator('[id="look-old"] img[data-orientation="square"]').waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,layout+'/'+width);
      const boxes=await page.locator('[data-layout] > section').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}}));
      for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.ok(!(boxes[i].x<boxes[j].right&&boxes[i].right>boxes[j].x&&boxes[i].y<boxes[j].bottom&&boxes[i].bottom>boxes[j].y),layout+'/'+width+' overlap');
      if(width===390||width===1440)await page.screenshot({path:`work/profile-layout-review/${layout}-mixed-${width}.png`,fullPage:true});
    }
    for(const[label,layout]of [["A · Booking first","booking"],["B · Visual portfolio","portfolio"],["C · Neighborhood homepage","balanced"]]){
      await page.getByRole('button',{name:'Open settings'}).click();await page.getByRole('radio',{name:new RegExp(label.replace('·','.*'))}).check();await page.getByRole('radio',{name:'2 reviews',exact:true}).check();await page.getByRole('button',{name:'Save profile settings'}).click();await page.locator(`[data-layout="${layout}"]`).waitFor();assert.equal(await page.evaluate(()=>window.saved.layout),layout);assert.equal(await page.evaluate(()=>window.saved.customer_review_count),2);await page.getByRole('button',{name:'All experiences',exact:true}).click();assert.equal(await page.evaluate(()=>window.events.at(-1)),'reviews');
    }
    await page.evaluate(()=>window.publish());await page.locator('[id="look-published"]').waitFor();assert.equal(await page.locator('[id="look-published"]').evaluate(el=>el.parentElement.firstElementChild===el),true);
    assert.equal(await page.getByRole('button',{name:'Choose featured photo',exact:true}).count(),0);
    await page.getByRole('button',{name:'Open settings'}).click();
    for(const label of ['Show featured section','Show Services tab','Show Team tab']) await page.getByRole('checkbox',{name:new RegExp(label)}).uncheck();
    await page.getByRole('button',{name:'Save profile settings'}).click();
    await page.getByRole('heading',{name:'Our work',exact:true}).waitFor({state:'hidden'});
    assert.equal(await page.getByRole('heading',{name:'Services',exact:true}).count(),0);
    assert.equal(await page.getByRole('heading',{name:'Our team',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.saved.show_featured),false);
    await page.setViewportSize({width:390,height:1000});
    await page.screenshot({path:'work/profile-layout-review/balanced-hidden-sections-390.png',fullPage:true});
    await page.route('**/*.webp',route=>route.fulfill({status:404,body:''}));
    await page.reload();
    await page.locator('[data-has-photos="false"]').waitFor();
    await page.getByRole('heading',{name:'Our work',exact:true}).waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelector('[data-layout]')?.querySelectorAll('img').length===0);
    assert.equal(await page.getByRole('button',{name:'Book Full-Set',exact:true}).count(),1);
    assert.equal(await page.getByRole('button',{name:"View Tracy's profile",exact:true}).count(),1);
    await page.screenshot({path:'work/profile-layout-review/balanced-missing-images-390.png',fullPage:true});
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

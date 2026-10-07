import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { chromium } from "playwright-core";

const moduleExports = {};
const require = createRequire(import.meta.url);
new Function("require", "exports", ts.transpileModule(readFileSync("app/salon-profile/website-photo-feed.tsx", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(name => name.endsWith(".css") ? { default: {} } : require(name), moduleExports);

test("photo feed excludes shown URLs, duplicates, drafts and missing images, newest first", () => {
  const photo = (id, imageUrl, publishedAt = "2026-10-01") => ({ id, imageUrl, publishedAt, title: id });
  const selected = moduleExports.selectWebsiteFeedPhotos([
    photo("old", "old"), photo("new", "new", "2026-10-05"), photo("duplicate", "new"),
    photo("already-shown", "hero"), photo("draft", "draft", null), photo("missing", ""),
  ], ["hero"]);
  assert.deepEqual(selected.map(photo => photo.id), ["new", "old"]);
  assert.deepEqual(moduleExports.selectWebsiteFeedPhotos([], []), []);
});

test("all layouts append photos on scroll, stop at the end, open photos and handle failures on mobile/desktop", {
  skip: !process.env.ESBUILD_MODULE_PATH, timeout: 120000,
}, async () => {
  const { build } = await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{SalonWebsiteHome}from'./app/salon-profile/salon-website-home';
    const posts=Array.from({length:27},(_,i)=>({id:String(i),title:'Photo '+i,imageUrl:'/photo-'+i+'.svg',contentType:'look',isPinned:i===0,publishedAt:'2026-10-'+String(28-i).padStart(2,'0'),serviceId:i===1?'service':null}));
    const data={profile:{name:'King Nails',salonId:'salon',city:'Milwaukee',state:'WI',story:'Our neighborhood salon.'},services:[{id:'service',name:'Manicure',basePrice:35,durationMinutes:30}],staff:[]};
    window.opened=[];
    function App(){const[layout,setLayout]=useState('booking');const[empty,setEmpty]=useState(false);const[hero,setHero]=useState(true);
      window.configure=(layout,empty=false,hero=true)=>{setLayout(layout);setEmpty(empty);setHero(hero)};
      return <SalonWebsiteHome key={layout+empty+hero} data={data} posts={empty?[]:posts} preferences={{layout,show_featured:hero,show_services:true,show_team:true,show_customer_reviews:false}} canBook={false} onPost={post=>window.opened.push(post.id)} onGallery={()=>{}} onServices={()=>{}} onTeam={()=>{}} onBook={()=>{}}/>;
    }createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, outdir: "fixture", jsx: "automatic", plugins: [{ name: "server-stubs", setup(build) {
    build.onResolve({ filter: /operating-hours-display|quick-booking-client$/ }, args => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ resolveDir: process.cwd(), loader: "tsx", contents: args.path.includes("hours")
      ? "import React from 'react';export function OperatingHoursDisplay(){return <p>Monday – Saturday, 9 AM – 6 PM</p>}"
      : "export function preloadQuickBooking(){}" }));
  }}] });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  mkdirSync("work/profile-feed-review", { recursive: true });
  try {
    const page = await browser.newPage();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("http://feed.test/", route => route.fulfill({ contentType: "text/html", body: `<style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#f6f5f3;font-family:Arial}h2,h3,h4,p{margin:0}button{font:inherit;border:0}${bundle.outputFiles.find(file=>file.path.endsWith('.css')).text}</style><div id="root"></div><script src="/app.js"></script>` }));
    await page.route("**/app.js", route => route.fulfill({ contentType: "text/javascript", body: bundle.outputFiles.find(file=>file.path.endsWith('.js')).text }));
    await page.route("**/photo-*.svg", route => route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="#dec7bc"/><text x="30" y="90" font-size="36">${route.request().url().split('/').at(-1)}</text></svg>` }));
    for (const width of [320,390,1440]) for (const layout of ["booking","portfolio","balanced"]) {
      await page.setViewportSize({ width, height: 600 });
      await page.goto("http://feed.test/");
      await page.waitForFunction(()=>typeof window.configure === 'function');
      await page.evaluate(layout=>window.configure(layout), layout);
      const feed=page.getByRole('region',{name:'More salon photos'});
      await feed.waitFor();
      assert.equal(await feed.locator('article').count(),0,layout+': feed must wait for scroll');
      await feed.getByRole('button',{name:'Explore more photos'}).scrollIntoViewIfNeeded();
      await page.waitForFunction(()=>document.querySelector('[aria-label="More salon photos"]').querySelectorAll('article').length===6);
      assert.ok(await feed.locator('article').count()<=6);
      await feed.getByRole('button',{name:/^Open Photo/}).first().click();
      assert.equal((await page.evaluate(()=>window.opened)).length,1);
      for(let attempt=0;attempt<10 && await feed.getByRole('button',{name:'Load more photos'}).count();attempt++) {
        await feed.getByRole('button',{name:'Load more photos'}).scrollIntoViewIfNeeded();
        await page.waitForTimeout(150);
      }
      await feed.getByRole('status').waitFor();
      const urls=await feed.locator('img').evaluateAll(images=>images.map(img=>img.getAttribute('src')));
      assert.equal(new Set(urls).size,urls.length);
      const above=await page.locator('[data-layout] > section:not([aria-label="More salon photos"]) img').evaluateAll(images=>images.map(img=>img.getAttribute('src')));
      assert.ok(urls.every(url=>!above.includes(url)),layout+': duplicate homepage image');
      assert.equal(new Set([...urls,...above]).size,27,layout+': all gallery photos accounted for');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(width===390)await page.screenshot({path:'work/profile-feed-review/'+layout+'-mobile.png',fullPage:true});
      await page.evaluate(layout=>window.configure(layout,true),layout);
      await feed.waitFor({state:'hidden'});
    }
    await page.route('**/photo-20.svg',route=>route.fulfill({status:404,body:''}));
    await page.reload();
    await page.waitForFunction(()=>typeof window.configure === 'function');
    await page.evaluate(()=>window.configure('balanced',false,false));
    const feed=page.getByRole('region',{name:'More salon photos'});
    await feed.waitFor();
    for(let attempt=0;attempt<10;attempt++){
      const more=feed.getByRole('button',{name:/Explore more photos|Load more photos/});
      if(!await more.count())break;
      await more.scrollIntoViewIfNeeded();await page.waitForTimeout(150);
    }
    await feed.getByRole('status').waitFor();
    await page.waitForFunction(()=>!document.querySelector('[aria-label="More salon photos"] img[src="/photo-20.svg"]'));
    assert.deepEqual(errors,[]);
  } finally { await browser.close(); }
});

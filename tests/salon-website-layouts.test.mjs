import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { chromium } from "playwright-core";

const source = readFileSync("app/salon-profile/salon-website-home.tsx", "utf8");
const exports = {};
const css = readFileSync("app/salon-profile/salon-website-home.module.css", "utf8");
const actionExports = {};
new Function("require","exports",ts.transpileModule(readFileSync("app/salon-profile/post-actions.tsx","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText)(createRequire(import.meta.url),actionExports);
const classes = Object.fromEntries([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9]*)/g)].map(match => [match[1], match[1]]));
function fixtureRequire(name) {
  if (name.includes("post-actions")) return actionExports;
  if (name.endsWith(".css")) return { default: classes };
  if (name.includes("quick-booking-client")) return { preloadQuickBooking() {} };
  if (name.includes("operating-hours-display")) return { OperatingHoursDisplay: () => React.createElement("p", null, "Monday 9 AM – 6 PM") };
  if (name.includes("nail-illustration-credit")) return { NailIllustrationCredit: () => null };
  const fixturePath = name.includes("website-photo-feed") ? "app/salon-profile/website-photo-feed.tsx"
    : name === "@/lib/salon-profile-content" ? "lib/salon-profile-content.ts"
    : name === "@/lib/default-nail-images" ? "lib/default-nail-images.ts" : null;
  if (!fixturePath) return createRequire(import.meta.url)(name);
  const loaded = {};
  new Function("require", "exports", ts.transpileModule(readFileSync(fixturePath, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText)(fixtureRequire, loaded);
  return loaded;
}
new Function("require", "exports", ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText)(fixtureRequire, exports);
const data = { profile: { name: "King Nails", salonId: "salon", city: "Milwaukee", state: "WI", description: "A neighborhood salon.", story: "Meet our local team." }, operatingHours: {weeklyHours:[{dayOfWeek:1,opensAtLocal:"09:00",closesAtLocal:"18:00"}],specialHours:[]}, services: [{ id: "service", name: "Full-Set", basePrice: 40, durationMinutes: 45 }], staff: [{ id: "staff", displayName: "Tracy", onlineBookingEnabled: true }] };
data.experiences = [
  {id:"positive-old",authorUserId:"customer-one",authorDisplayName:"Anna",body:"Beautiful work and attentive service.",rating:5,feedbackState:"good",verificationStatus:"verified",source:"experience",createdAt:"2026-09-01"},
  {id:"positive-new",authorUserId:"customer-two",authorDisplayName:"Lisa",body:"A lovely salon and a great manicure.",rating:5,feedbackState:"good",verificationStatus:"verified",source:"experience",createdAt:"2026-10-02"},
  {id:"positive-four",authorUserId:"customer-three",authorDisplayName:"Kim",body:"Friendly team, I will return.",rating:4,feedbackState:"good",verificationStatus:"unverified",source:"experience",createdAt:"2026-10-03"},
];
const posts = Array.from({ length: 5 }, (_, index) => ({ id: String(index), title: `Post ${index}`, contentType: "look", publishedAt: `2026-10-0${index + 1}`, isPinned: index === 0, imageUrl: `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='100'><text>${index}</text></svg>` }));
test("all three website layouts fit mobile and desktop, keep essentials, and show newest three posts", async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    for (const width of [320, 390, 1280]) for (const layout of ["booking", "portfolio", "balanced"]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const html = renderToStaticMarkup(React.createElement(exports.SalonWebsiteHome, { data, posts, preferences: { layout, show_services: true, show_team: true }, canBook: true, onPost() {}, onGallery() {}, onServices() {}, onTeam() {}, onBook() {} }));
      await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;padding:12px;font-family:Arial}h3,h4,p{margin:0}button{border:0;font:inherit;cursor:pointer}${css}</style>${html}`);
      assert.equal(await page.locator(".latest .post").count(), 3);
      assert.equal(await page.locator(".latest .post strong").first().textContent(), "Post 4");
      if (layout === "booking") assert.equal(await page.locator(".feature img").count(),0);
      else assert.equal(await page.locator(".feature img").first().getAttribute("alt"),"Post 0");
      for (const section of ["hours", "services", "team", "about"]) assert.equal(await page.locator(`.${section}`).count(), 1, `${section}/${layout}/${width}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${layout} overflows at ${width}`);
      const boxes = await page.locator(".home>section").evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}; }));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!(boxes[i].x < boxes[j].right && boxes[i].right > boxes[j].x && boxes[i].y < boxes[j].bottom && boxes[i].bottom > boxes[j].y), `${layout} sections overlap`);
      await page.close();
    }
    const html = renderToStaticMarkup(React.createElement(exports.SalonWebsiteHome, {data, posts: [], preferences:{layout:"balanced",show_services:false,show_team:false},canBook:false}));
    assert.doesNotMatch(html, /class="services"|class="team"|Book appointment/);
    const view = readFileSync("app/salon-profile/salon-profile-view.tsx", "utf8");
    assert.match(view, /!asTimeline && \(!manageData \|\| capabilities.isOwnSalon\)/);
    assert.match(view, /composer=\{capabilities.isOwnSalon && capabilities.canCreateContent/);
  } finally { await browser.close(); }
});

test("website reflows all visibility combinations with no, one, or several photos", async () => {
  const browser = await chromium.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
  const page = await browser.newPage();
  try {
    for (const width of [320,1280]) for (const layout of ["booking","portfolio","balanced"]) for (const show_services of [false,true]) for (const show_team of [false,true]) for (const show_featured of [false,true]) for (const count of [0,1,3]) {
      await page.setViewportSize({width,height:900});
      const samplePosts = count ? posts.slice(0,count) : [];
      const html = renderToStaticMarkup(React.createElement(exports.SalonWebsiteHome,{data,posts:samplePosts,preferences:{layout,show_services,show_team,show_featured},canBook:true}));
      await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;padding:12px;font-family:Arial}h2,h3,h4,p{margin:0}button{border:0;font:inherit}${css}</style>${html}`);
      const context = `${layout}/${width}/services:${show_services}/team:${show_team}/featured:${show_featured}/photos:${count}`;
      assert.equal(await page.locator(".services").count(),Number(show_services),context);
      assert.equal(await page.locator(".team").count(),Number(show_team),context);
      assert.equal(await page.locator(".feature").count(),Number(show_featured),context);
      assert.equal(await page.locator(".latest").count(),Number(show_featured && layout !== "booking" ? count>1 : count>0),context);
      assert.equal(await page.locator(".archive").count(),0,context);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),context);
      const grid = await page.locator(".home").evaluate(el=>getComputedStyle(el).gridTemplateAreas);
      assert.ok(!grid.includes("."),`Empty grid area: ${context}`);
      const areas = [...new Set(grid.replaceAll('"','').split(/\s+/))];
      for (const area of areas) assert.equal(await page.locator(`.home>.${area}`).count(),1,`Reserved space without content: ${context}/${area}`);
      const boxes = await page.locator(".home>section").evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
      for(let i=0;i<boxes.length;i++) for(let j=i+1;j<boxes.length;j++) assert.ok(!(boxes[i].x<boxes[j].right && boxes[i].right>boxes[j].x && boxes[i].y<boxes[j].bottom && boxes[i].bottom>boxes[j].y),`Overlapping sections: ${context}`);
    }
  } finally {await browser.close();}
});

test("review highlights prefer ratings, verification and recency without inventing stars", () => {
 const positive=data.experiences;
 const selected=exports.selectCustomerReviewHighlights({experiences:[...positive,
 {...positive[0],id:"empty",body:"   "},
 {...positive[0],id:"issue",feedbackState:"issue"},
 {...positive[0],id:"neutral",rating:3},
 {...positive[0],id:"duplicate",createdAt:"2026-08-01"},
 {...positive[0],id:"no-stars",authorUserId:"customer-four",rating:null,createdAt:"2026-08-01"}
 ]},3);
 assert.deepEqual(selected.map(review=>review.id),["positive-new","positive-old","positive-four"]);
 assert.equal(exports.selectCustomerReviewHighlights(data,2).length,2);
 const noStars=exports.selectCustomerReviewHighlights({experiences:[{...positive[0],rating:null}]},2);
 assert.equal(noStars[0].rating,null);
 const legacy=exports.selectCustomerReviewHighlights({reviews:[{...positive[0],id:"legacy"}]},3);
 assert.equal(legacy[0].source,"legacy_review");
 const hidden=renderToStaticMarkup(React.createElement(exports.SalonWebsiteHome,{data,posts:[],preferences:{layout:"balanced",show_services:false,show_team:false,show_customer_reviews:false},canBook:false}));
 assert.doesNotMatch(hidden,/class="reviews"/);
});

test("featured photo is explicitly pinned, stays stable on publish, and is absent from recent posts", () => {
 const props={data,preferences:{layout:"balanced",show_services:true,show_team:true},canBook:true};
 const newPost={...posts[4],id:"just-published",title:"Just published",publishedAt:"2026-10-09",isPinned:false};
 const html=renderToStaticMarkup(React.createElement(exports.SalonWebsiteHome,{...props,posts:[newPost,...posts]}));
 const feature=html.slice(html.indexOf('class="feature"'),html.indexOf('class="hours"'));
 assert.match(feature,/alt="Post 0"/);assert.doesNotMatch(feature,/Just published/);
 const recent=html.slice(html.indexOf('class="latest"'),html.indexOf('class="reviews"'));
 assert.match(recent,/Just published/);assert.doesNotMatch(recent,/Post 0/);
 const unpinned=posts.map(post=>({...post,isPinned:false}));
 const withoutPin=renderToStaticMarkup(React.createElement(exports.SalonWebsiteHome,{...props,posts:unpinned}));
 assert.match(withoutPin,/class="feature"/);
 const automatic=exports.selectWebsitePhotos(unpinned);assert.equal(automatic.featured.id,"0");
 const pinnedNew=renderToStaticMarkup(React.createElement(exports.SalonWebsiteHome,{...props,posts:[{...newPost,isPinned:true},...unpinned]}));
 assert.match(pinnedNew.slice(pinnedNew.indexOf('class="feature"'),pinnedNew.indexOf('class="hours"')),/alt="Just published"/);
});

test("automatic hero uses engagement, server daily choice, manual priority, and unique photographs",()=>{
 const list=posts.map((post,index)=>({...post,isPinned:false,saveCount:index,commentCount:0}));
 const best=exports.selectWebsitePhotos(list);assert.equal(best.featured.id,"4");
 const stable=exports.selectWebsitePhotos([{...list[0],id:"new-high",saveCount:999},...list],"2");assert.equal(stable.featured.id,"2");
 const manual=exports.selectWebsitePhotos([{...list[0],isPinned:true},...list.slice(1)],"2");assert.equal(manual.featured.id,"0");
 const shared=exports.selectWebsitePhotos([...list,{...list[4],id:"duplicate"}]);
 const urls=[...shared.photos,...shared.latest.filter(post=>post.imageUrl)].map(post=>post.imageUrl);assert.equal(new Set(urls).size,urls.length);
 const hidden=exports.selectWebsitePhotos(list,null,[],false);assert.equal(hidden.photos.length,0);assert.equal(hidden.latest.length,3);
 const broken=exports.selectWebsitePhotos(list,"4",[list[4].imageUrl]);assert.notEqual(broken.featured?.id,"4");
});

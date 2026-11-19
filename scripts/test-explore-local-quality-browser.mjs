// Actual local application UI; controlled API responses isolate browser lifecycle.
// SQL relevance and native concurrency are verified separately by the benchmark.
import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

const origin=process.env.EXPLORE_QA_ORIGIN??'http://127.0.0.1:3207';
if(!['127.0.0.1','localhost'].includes(new URL(origin).hostname))throw Error('Local QA only');
const output='artifacts/local-search-quality-20261118';mkdirSync(output,{recursive:true});
const uniqueMedia=process.env.EXPLORE_QA_UNIQUE_MEDIA==='1',suffix=uniqueMedia?'-unique-media':'';
const media=uniqueMedia?['chrome','floral','nude','pink','red','softpink'].map(name=>readFileSync(`public/explore/mockup-look-${name}.webp`)):[];
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const evidence={environment:'Local Chromium, actual application source with synthetic API responses; not live data or physical iOS',uniqueMedia,mediaScope:uniqueMedia?'Distinct local URLs per salon, six existing public WebP fixtures; not production media delivery':'Existing shared fallback media',cases:[]};
const row=(n,query)=>({id:`00000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`,name:`${query} ${n+1}`,city:'Milwaukee',state:'WI',country:'US',postalCode:'53218',addressLine1:'100 QA Street',addressLine2:null,
  serviceCategories:['Nails'],serviceNames:['Gel manicure'],activeServiceCount:1,profileCompleteness:90,description:'Synthetic QA salon',distanceMiles:1,latitude:43.04,longitude:-87.9,
  coverImageUrl:null,logoImageUrl:null,bookingEnabled:false,bookingHref:null,phone:null,hasPublicProfile:true,imageProvenance:'none',isNew:false,isPrimaryMatch:true,isReferenceMatch:false,
  matchType:'service',matchSource:'service',matchTier:5,relevanceScore:95,resultGroup:'best_match',searchScope:'A',scopeLabel:'Milwaukee, WI',operatingStatus:{kind:'hours_unset',label:'Hours not set'},
  averageRating:null,nextAvailabilityLabel:null,nextAvailableAt:null,featuredServiceCategory:null,featuredServiceName:null,latestMediaCreatedAt:null,mediaRevision:'qa',startingPrice:25,
  sharedExperienceCount:0,reviewCount:0,uniqueCustomerCount:0,verifiedVisitCount:0,reputationNoIssueRate:null,
  continuationCursor:{version:3,session:query,after:n+1},...(uniqueMedia?{coverImageUrl:`/api/explore/qa-media/${n}.webp`,imageProvenance:'salon_post',imageSourceSalonId:`00000000-0000-4000-8000-${String(n+1).padStart(12,'0')}`}:{})});
try{
 for(const viewport of [{width:390,height:844},{width:1280,height:900}]){
  const page=await browser.newPage({viewport});const errors=[],requests=[],mediaIds=new Set();
  if(uniqueMedia){
   const serve=async(route,source)=>{
    const n=Number(new URL(source,origin).pathname.match(/\/(\d+)\.webp$/)?.[1]);
    if(!Number.isInteger(n)||n<0||n>=600)throw Error('Invalid synthetic media request');
    mediaIds.add(n);await route.fulfill({status:200,contentType:'image/webp',body:media[n%media.length]});
   };
   await page.route('**/api/explore/qa-media/*.webp',route=>serve(route,route.request().url()));
   await page.route('**/_next/image?**',async route=>{
    const source=new URL(route.request().url()).searchParams.get('url');
    if(source?.includes('/api/explore/qa-media/'))await serve(route,source);else await route.continue();
   });
  }
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.__qaLongTasks=[];new PerformanceObserver(list=>window.__qaLongTasks.push(...list.getEntries().map(x=>({duration:x.duration,start:x.startTime})))).observe({entryTypes:['longtask']});
  });
  await page.route('**/api/explore/search',async route=>{
   const input=route.request().postDataJSON();requests.push(input);
   const query=input.query||'QA Nails';
   if(query==='Slow Nails')await new Promise(r=>setTimeout(r,800));
   const after=input.cursor?.after??0;
   const rows=!input.query?[]:input.hydrateIds?input.hydrateIds.map(id=>row(Number(id.slice(-12))-1,query)):Array.from({length:Math.min(12,600-after)},(_,n)=>row(after+n,query));
   const end=after+rows.length,hasMore=Boolean(input.query)&&!input.hydrateIds&&end<600;
   const b={...input,searchVersion:3,target:'salons',query,contentQuery:query,displayQuery:query,queryKind:'service',filters:{},category:'Nails',location:'Milwaukee, WI',locationOrigin:'query',locationSource:'manual',locationPriority:true,
    error:null,errorKind:null,results:rows,sections:{bestMatches:rows,nearby:[],recommended:[],reference:[]},groupCounts:{bestMatches:rows.length,nearby:0,recommended:0,reference:0},primaryCount:rows.length,referenceCount:0,totalCount:end,totalPages:2,page:1,pageSize:12,
    scope:{policy:'fixed',stage:'A',label:'Milwaukee, WI',expanded:false},sort:'relevance',appliedSort:'relevance',rankingBasis:'local_quality_indexed_lanes',sessionCursor:{version:3,session:query,after:end},nextCursor:hasMore?{version:3,session:query,after:end}:null,hasMore};
   try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(b)});}catch{/* old aborted query */}
  });
  await page.goto(`${origin}/explore`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('input[name="q"]')).some(node=>Object.keys(node).some(key=>key.startsWith('__reactProps$'))));
  const input=page.locator('input[name="q"]:visible').first();await input.fill('Slow Nails');
  const slowRequest=page.waitForRequest(r=>r.url().endsWith('/api/explore/search')&&r.postDataJSON().query==='Slow Nails');
  await input.press('Enter');await slowRequest;
  const started=performance.now();await input.fill('Fast Nails');await input.press('Enter');
  await page.locator('[data-salon-id]').filter({hasText:'Fast Nails'}).first().waitFor();
  await page.waitForTimeout(950);
  assert.equal(await page.locator('[data-salon-id]').filter({hasText:'Slow Nails'}).count(),0,'late old response must not replace active query');
  const searchMs=Math.round(performance.now()-started);
  // Traverse fifty pages without creating an unbounded refresh request.
  for(let turn=0;turn<200&&(await page.locator('[data-salon-id]').count())<600;turn++){
   await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(200);
  }
  const cards=await page.locator('[data-salon-id]').count();
  assert(cards>=600,`deep pagination expected600, got${cards}`);
  if(uniqueMedia){
   // Visit every loaded row so distinct lazy image URLs take part in the test.
   await page.evaluate(async()=>{
    for(const card of document.querySelectorAll('[data-salon-id]')){card.scrollIntoView({block:'center'});await new Promise(resolve=>setTimeout(resolve,16));}
   });
   await page.waitForFunction(()=>Array.from(document.querySelectorAll('img')).filter(img=>decodeURIComponent(img.currentSrc||img.src).includes('/qa-media/')&&img.complete&&img.naturalWidth>0).length>=550);
   assert(mediaIds.size>=550,'distinct local image URLs must actually load');
  }
  const interactionAt=await page.evaluate(()=>performance.now());
  await input.fill('Responsive Nails');
  assert.equal(await input.inputValue(),'Responsive Nails');
  const inputMs=await page.evaluate(t=>performance.now()-t,interactionAt);
  const hydrate=requests.filter(x=>x.hydrateIds),maxHydrate=Math.max(0,...hydrate.map(x=>x.hydrateIds.length));
  assert(maxHydrate<=36);assert(requests.filter(x=>x.query&&!x.cursor).every(x=>x.pageSize===12));assert.deepEqual(errors,[]);
  const longTasks=await page.evaluate(t=>window.__qaLongTasks.filter(x=>x.start>=t),interactionAt);
  assert(inputMs<1000,'typing must remain responsive after50 pages');
  await page.screenshot({path:`${output}/deep${suffix}-${viewport.width}.png`});
  evidence.cases.push({viewport,cards,searchMs,inputMs:Math.round(inputMs),maxHydrate,requests:requests.length,distinctMediaRequests:mediaIds.size,longTasksAfterInput:longTasks,errors});
  await page.close();
 }
 writeFileSync(`${output}/browser${suffix}.json`,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await browser.close();}

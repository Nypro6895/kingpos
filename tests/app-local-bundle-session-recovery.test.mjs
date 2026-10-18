import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';

const browserPath=process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const bundle=path.resolve('ios/Reylumi/LocalAppBundle');
const scope='v3:'+'a'.repeat(64);
const core={commentViewer:{identity:{name:'Guest',role:'personal',salonId:null,avatarUrl:null},canModerate:false,canReplyAsSalon:false,isAuthenticated:false,userId:null},discoveryContent:{shortcuts:[]},hasUrlLocation:true,homeContent:{error:null,inspiration:{error:null,hasMore:false,items:[],nextCursor:null},newSalons:[],popularServices:[],recommendedSalons:[]},initialFeed:{items:[],hasMore:false,nextCursor:null,sessionCursor:null},initialLocationSource:'manual',initialResponse:{query:'',displayQuery:'',category:'',location:'Chicago',locationSource:'manual',locationOrigin:'manual',page:1,pageSize:12,results:[],sections:{bestMatches:[],nearby:[],recommended:[]},totalCount:0,totalPages:1,hasMore:false,nextCursor:null,groupCounts:{bestMatches:0,nearby:0,recommended:0},target:'salons',sort:'relevance'},initialSearchMode:true,quickActions:[],workspaceLocation:{label:'Chicago',source:'manual'},deferred:{extras:false,feed:false,showcase:false}};

async function fixture(mode='reject'){
  const manifest=JSON.parse(fs.readFileSync(path.join(bundle,'manifest.json'),'utf8'));
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(bundle,'app.js'))).digest('hex'),manifest.files.find(row=>row.path==='app.js').sha256);
  const server=createServer((req,res)=>{
    const pathname=new URL(req.url,'http://fixture').pathname;
    const candidate=path.resolve(bundle,'.'+decodeURIComponent(pathname));
    if(!candidate.startsWith(bundle+path.sep)){res.writeHead(400).end();return;}
    const file=fs.existsSync(candidate)&&fs.statSync(candidate).isFile()?candidate:path.join(bundle,'index.html');
    const mime={'.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'};
    res.setHeader('Content-Type',mime[path.extname(file)]??'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:browserPath,headless:true,args:['--no-proxy-server']});
  const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
  const errors=[],origin='http://127.0.0.1:'+server.address().port;
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.addInitScript(({mode,scope,core})=>{
    window.fixtureMode=mode;window.fixtureCalls=[];
    window.__reylumiAppLocalContext={version:1,nonce:'11111111-1111-4111-8111-111111111111',scopeEpoch:1,generation:'fixture-device-generation'};
    window.__reylumiAppLocalTransport={async request(input){
      window.fixtureCalls.push({kind:input.kind,name:input.name,args:input.args});
      if(input.kind==='cache')return null;
      if(input.kind==='context'){
        if(window.fixtureMode==='reject')throw Object.assign(Error('Fixture context unavailable'),{status:503});
        if(window.fixtureMode==='hang')return new Promise(()=>{});
        return {schemaVersion:1,context:{scope,viewerId:null,workspaceId:'personal',salonId:null,permissionRevision:'guest',authenticated:false},grant:null,display:{name:'Guest',language:'en',role:'CUSTOMER'},access:{ownerWorkspace:false,staffWorkspace:false},onlineValidatedAt:Date.now()};
      }
      if(input.kind==='read'&&input.name==='page.explore')return {schemaVersion:1,status:200,scope,etag:'fixture-core',updatedAt:Date.now(),data:core};
      if(input.kind==='read')throw Object.assign(Error('Fixture optional read unavailable'),{status:503});
      throw Error('All write commands and hosted navigation are forbidden in this fixture');
    }};
  },{mode,scope,core});
  await page.clock.install();
  await page.goto(origin+'/explore?location=Chicago');
  return {page,errors,close:async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));}};
}

const contexts=page=>page.evaluate(()=>window.fixtureCalls.filter(row=>row.kind==='context').length);
const recover=async page=>{
  await page.evaluate(()=>window.fixtureMode='ready');
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await page.waitForFunction(()=>window.fixtureCalls.some(row=>row.name==='page.explore')&&!document.querySelector('[data-explore-startup]'));
};
test('actual packaged Explore retries initial context failure and retains entered search across a failed foreground validation',{skip:!fs.existsSync(browserPath),timeout:40000},async()=>{
  const app=await fixture();try{
    const {page}=app;
    await page.getByRole('button',{name:'Try again',exact:true}).waitFor();
    assert.equal(await contexts(page),1);
    assert.equal(await page.evaluate(()=>window.fixtureCalls.some(row=>row.name==='page.explore')),false);
    await recover(page);
    assert.equal(await contexts(page),2);
    const input=page.getByPlaceholder('Salons, services or ideas');await input.fill('Keep this search');
    await input.evaluate(node=>window.retainedInput=node);
    await page.evaluate(()=>{window.fixtureMode='reject';window.dispatchEvent(new Event('reylumi:foreground'));});
    await page.waitForFunction(()=>window.fixtureCalls.filter(row=>row.kind==='context').length===3);
    assert.equal(await input.inputValue(),'Keep this search');
    assert.equal(await input.evaluate(node=>node===window.retainedInput),true);
    assert.equal(await page.getByRole('button',{name:'Try again',exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.fixtureCalls.some(row=>row.kind==='command')),false);
    assert.deepEqual(app.errors,[]);
  }finally{await app.close();}
});
test('actual packaged Explore recovers by selecting the failed route again without command replay',{skip:!fs.existsSync(browserPath),timeout:40000},async()=>{
  const app=await fixture();try{
    await app.page.getByRole('button',{name:'Try again',exact:true}).waitFor();
    await app.page.evaluate(()=>{window.fixtureMode='ready';window.dispatchEvent(new CustomEvent('reylumi:app-local-navigate',{detail:{path:location.pathname+location.search}}));});
    await app.page.waitForFunction(()=>window.fixtureCalls.some(row=>row.name==='page.explore')&&!document.querySelector('[data-explore-startup]'));
    assert.equal(await contexts(app.page),2);
    assert.equal(await app.page.evaluate(()=>window.fixtureCalls.some(row=>row.kind==='command')),false);
    assert.deepEqual(app.errors,[]);
  }finally{await app.close();}
});
test('actual packaged Explore releases a lost context callback after its deadline and allows one explicit retry',{skip:!fs.existsSync(browserPath),timeout:40000},async()=>{
  const app=await fixture('hang');try{
    await app.page.locator('[data-explore-startup]').waitFor();
    await app.page.waitForFunction(()=>window.fixtureCalls.some(row=>row.kind==='context'));
    await app.page.clock.fastForward(25001);
    await app.page.getByRole('button',{name:'Try again',exact:true}).waitFor();
    assert.equal(await contexts(app.page),1);
    assert.equal(await app.page.evaluate(()=>window.fixtureCalls.filter(row=>row.kind==='cache'&&row.name==='cancel').length),1);
    await recover(app.page);
    assert.equal(await contexts(app.page),2);
    assert.equal(await app.page.evaluate(()=>window.fixtureCalls.some(row=>row.kind==='command')),false);
    assert.deepEqual(app.errors,[]);
  }finally{await app.close();}
});

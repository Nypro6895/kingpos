import {browserServerBoundary} from './helpers/browser-server-boundary.mjs';
import {scopedCampaignUiBoundary} from './helpers/scoped-campaign-ui-boundary.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {campaignTestDatabase,owner,salon,post} from './fixtures/campaign-test-database.mjs';

const original='30000000-0000-0000-0000-000000000001';
const sourceRoot=process.env.CAMPAIGN_TEST_SOURCE_ROOT?path.resolve(process.env.CAMPAIGN_TEST_SOURCE_ROOT):process.cwd();
const legacy=process.env.CAMPAIGN_TEST_EXPECT_LEGACY==='1';
const executablePath=process.env.TEST_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
const source=file=>fs.existsSync(path.join(sourceRoot,file))?path.join(sourceRoot,file):path.resolve(file);

function sourceOverlay(){return {name:'selected-source-overlay',setup(b){
 b.onResolve({filter:/^\.{1,2}\//},args=>{
  if(sourceRoot===process.cwd()||!args.importer.startsWith(sourceRoot+path.sep))return;
  const relative=path.relative(sourceRoot,path.resolve(path.dirname(args.importer),args.path));
  const found=['','.ts','.tsx','.js','.json'].map(suffix=>source(relative+suffix)).find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
  if(found)return {path:found};
 });
 b.onResolve({filter:/^@\//},args=>{
  const relative=args.path.slice(2),found=['','.ts','.tsx','.json'].map(suffix=>source(relative+suffix)).find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
  if(found)return {path:found};
 });
 b.onLoad({filter:/\.[cm]?[jt]sx?$/},args=>{
  const relative=path.relative(process.cwd(),args.path),selected=source(relative);
  if(selected!==args.path&&fs.existsSync(selected))return {contents:fs.readFileSync(selected,'utf8'),loader:selected.endsWith('tsx')?'tsx':'ts',resolveDir:path.dirname(args.path)};
 });
}}}

async function database({custom=false}={}){
 const db=await campaignTestDatabase();
 await db.exec(`
  create table platform_admin_roles(id uuid primary key default gen_random_uuid(),slug text unique);
  create table platform_admin_permissions(id uuid primary key default gen_random_uuid(),code text unique,name text,description text,category text);
  create table platform_admin_role_permissions(role_id uuid,permission_id uuid,unique(role_id,permission_id));
  create table platform_admin_audit_logs(actor_user_id uuid,action text,target_type text,target_id uuid,reason text,metadata jsonb);
  create function platform_admin_require_permission(text) returns table(actor_user_id uuid,actor_membership_id uuid,actor_role_slug text)
   language sql as $$select '${owner}'::uuid,null::uuid,'platform_owner'::text$$;
  create table beauty_post_media(id uuid primary key default gen_random_uuid(),post_id uuid,display_order integer,role text,object_path text,created_at timestamptz default now());
  alter table salon_profile_looks add column updated_at timestamptz default now();alter table salon_profile_looks add column media_path text;
  alter table owner_campaigns add column owner_paused_at timestamptz;alter table owner_campaigns add column archived_at timestamptz;
  alter table owner_campaigns add column pause_episode_id uuid;alter table owner_campaigns add column pause_origin text;
  insert into salon_profile_looks(id,salon_id,title,caption,status,author_user_id,media_path) values('${post}','${salon}','Approved manicure','Same approved content','published','${owner}','original.webp');
  insert into owner_campaign_creatives(id,salon_id,author_user_id,title,caption,media_path) values('20000000-0000-0000-0000-000000000002','${salon}','${owner}','Approved photo','Same approved content','photo.webp');
  select campaign_plugin_set('${salon}','${owner}',true);update campaign_wallets set available_credits=10000;
 `);
 await db.exec(fs.readFileSync('supabase/migrations/20261017235000_campaign_admin_operations.sql','utf8'));
 await db.exec(fs.readFileSync(source('supabase/migrations/20261023190000_campaign_run_again.sql'),'utf8'));
 await db.query("select campaign_create_versioned(1,$1,$2,$3,$4,$5,'city','Chicago','United States','Illinois','Chicago',500,3,250,false,false)",[original,salon,owner,custom?'custom':'salon_profile_look',custom?'20000000-0000-0000-0000-000000000002':post]);
 await db.query('select campaign_credit_fund($1,$2,$3)',[original,salon,owner]);
 await db.query('select owner_campaign_review($1,true)',[original]);
 await db.query("update owner_campaigns set ends_at=now()-interval '1 minute',status='completed' where id=$1",[original]);
 return db;
}

function clientFor(db,calls){return {
 async rpc(name,args){
  assert.ok(['campaign_run_again','campaign_create_versioned','campaign_credit_fund','campaign_credit_close_expired'].includes(name));calls.push(name);
  const keys=Object.keys(args);assert.ok(keys.every(key=>/^p_[a-z_]+$/.test(key)));
  try{const result=await db.query(`select ${name}(${keys.map((key,i)=>`${key}=>$${i+1}`).join(',')}) result`,keys.map(key=>args[key]));return {data:result.rows[0].result,error:null}}
  catch(error){return {data:null,error:{message:error.message}}}
 },
 from(table){
  assert.ok(['owner_campaigns','campaign_wallets'].includes(table));const filters=[],values=[];let fields='*',limit='',order='',active=false;
  const query={
   select(input){assert.match(input,/^[a-z_,*]+$/);fields=input;return query},
   eq(key,value){assert.match(key,/^[a-z_]+$/);values.push(value);filters.push(`${key}=$${values.length}`);return query},
   in(key,items){assert.match(key,/^[a-z_]+$/);values.push(items);filters.push(`${key}=any($${values.length}::text[])`);return query},
   or(){active=true;return query},order(){order=' order by created_at desc,id desc';return query},range(start,end){limit=` limit ${end-start+1} offset ${start}`;return query},
   async single(){const result=await run();return {...result,data:result.data?.[0]??null}},
   then(resolve,reject){return run().then(resolve,reject)},
  };
  async function run(){const where=[...filters,...(active?["status in ('awaiting_payment','pending_review','running','paused')"]:[])];try{return {data:(await db.query(`select ${fields} from ${table}${where.length?' where '+where.join(' and '):''}${order}${limit}`,values)).rows,error:null}}catch(error){return {data:null,error:{message:error.message}}}}
  return query;
 }
}}

async function actionModule(){
 const result=await build({entryPoints:[source('app/campaigns/actions.ts')],bundle:true,write:false,platform:'node',format:'esm',plugins:[scopedCampaignUiBoundary(),{name:'isolated-owner-and-cache',setup(b){
  b.onResolve({filter:/^(next\/cache|@\/lib\/owner-campaigns)$/},args=>({path:args.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>({loader:'js',contents:args.path==='next/cache'?'export function revalidatePath(){}':`export async function requireCampaignOwner(){const s=globalThis.__runAgainE2E;return{client:s.client,salonId:'${salon}',userId:'${owner}'}};export async function ownerCampaignSettings(){return globalThis.__runAgainE2E.settings()}`}));
 }},sourceOverlay()]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}

async function browserBundle(){
 const actionNames=['createOwnerCampaignAction','runAgainOwnerCampaignAction','loadOwnerCampaignsAction','changeOwnerCampaignAction','fundSavedCampaignAction','saveCampaignLimitAction','loadCampaignPostsAction'];
 const actionBridge=actionNames.map(name=>`export async function ${name}(...args){return call('${name}',args)}`).join(';')+`;export async function campaignWalletAction(){return call('wallet',[])}`;
 const result=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from'react';import{createRoot}from'react-dom/client';import{CampaignWorkspace}from'@/app/campaigns/campaign-workspace';fetch('/fixture-data').then(r=>r.json()).then(props=>createRoot(document.getElementById('root')).render(<CampaignWorkspace {...props}/>));`},bundle:true,write:false,outfile:'fixture.js',format:'iife',jsx:'automatic',plugins:[browserServerBoundary(),scopedCampaignUiBoundary(),{name:'browser-boundaries',setup(b){
  b.onResolve({filter:/^(next\/(link|image|navigation)|@\/components\/(workspace-language|workspace-navigation-icon)|@\/app\/campaigns\/(actions|credit-actions|creative-actions)|\.\/(actions|credit-actions|credit-panel|create-campaign|campaign-results|campaign-preview))$/},args=>({path:args.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},args=>{
   let contents;
   if(args.path==='next/navigation')contents="export function useSearchParams(){return new URLSearchParams()} export function useRouter(){return{refresh(){}}};export function usePathname(){return '/campaigns'}";
   else if(args.path==='next/link'||args.path==='next/image')contents="import React from'react';export default function Component({unoptimized,prefetch,...props}){return React.createElement('a',props,props.children)}";
   else if(args.path.endsWith('workspace-language'))contents="import React from'react';export function WorkspaceText({text}){return text};export function useWorkspaceTranslation(){return text=>text}";
   else if(args.path.endsWith('workspace-navigation-icon'))contents='export function WorkspaceNavigationIcon(){return null}';
   else if(/(actions|credit-actions)$/.test(args.path))contents=`async function call(name,args){const response=await fetch('/fixture-action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});const body=await response.json();if(body.error)throw Error(body.error);return body.result};${actionBridge}`;
   else contents='export function CreditPanel(){return null};export function CreateCampaign(){return null};export function CampaignResults(){return null};export function CampaignPreview(){return null}';
   return {contents,loader:'jsx',resolveDir:process.cwd()};
  });
 }},sourceOverlay()]});
 return {js:result.outputFiles.find(file=>file.path.endsWith('.js')).text,css:result.outputFiles.find(file=>file.path.endsWith('.css')).text};
}

test('Run again button retains approval through real server action, PostgreSQL reservation and delayed funding', {skip:!fs.existsSync(executablePath)},async()=>{
 const actions=await actionModule(),ui=await browserBundle(),browser=await chromium.launch({executablePath,headless:true});
 try{
  for(const scenario of legacy?[{width:390,entry:'history',credits:1000,custom:true}]:[{width:390,entry:'history',credits:1000,custom:true},{width:1280,entry:'details',credits:1000},{width:390,entry:'history',credits:0,custom:true},{width:1280,entry:'details',credits:1000,changed:true},{width:390,entry:'history',credits:1000,duplicate:true}]){
   const db=await database(scenario),calls=[],actionCalls=[];let server,context;
   try{
    await db.query('update campaign_wallets set available_credits=$1 where salon_id=$2',[scenario.credits,salon]);
    const settings=async()=>{const row=(await db.query('select config,version from owner_campaign_settings')).rows[0];return {...row.config,version:Number(row.version)}};
    const wallet=async()=>{const row=(await db.query('select * from campaign_wallets where salon_id=$1',[salon])).rows[0];return {...row,installed:true,payment_ready:false,has_payment_method:false}};
    globalThis.__runAgainE2E={client:clientFor(db,calls),settings};
    const before=(await db.query('select * from owner_campaigns where id=$1',[original])).rows[0];
    const noticeCount=async()=>Number((await db.query('select count(*) n from campaign_review_notices')).rows[0].n);
    if(scenario.duplicate){
     const copied=await actions.createOwnerCampaignAction({id:'30000000-0000-0000-0000-000000000002',settingsVersion:1,target:{sourceType:before.source_type,sourceId:before.source_id,salonId:salon,title:before.title},area:before.area,location:before.location,country:before.country,state:before.state,city:before.city,dailyViews:before.daily_views,days:before.days,creditLimit:250});
     assert.equal(copied.status,'pending_review');calls.length=0;actionCalls.length=0;
    }
    const notices=await noticeCount();
    const balanceBefore=(await db.query('select available_credits,reserved_credits from campaign_wallets where salon_id=$1',[salon])).rows[0];
    if(scenario.changed)await db.query("update salon_profile_looks set caption='Changed after approval' where id=$1",[post]);
    server=createServer(async(req,res)=>{
     try{
      if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(ui.js);return}
      if(req.url==='/fixture-data'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({initialCampaigns:[before],initialActive:[],initialError:'',initialTab:'history',wallet:await wallet(),settings:await settings(),location:{city:'Chicago',state:'Illinois',country:'United States'}}));return}
      if(req.url==='/fixture-action'){
       let raw='';for await(const part of req)raw+=part;const {name,args}=JSON.parse(raw);actionCalls.push(name);
       assert.ok(['wallet','createOwnerCampaignAction','runAgainOwnerCampaignAction','loadOwnerCampaignsAction','fundSavedCampaignAction'].includes(name));
       const result=name==='wallet'?await wallet():await actions[name](...args);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({result}));return;
      }
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font-family:Arial}*{box-sizing:border-box}${ui.css}</style><div id="root"></div><script src="/fixture.js"></script>`);
     }catch(error){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}))}
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));context=await browser.newContext({viewport:{width:scenario.width,height:900}});const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    if(scenario.entry==='details')await page.getByRole('button',{name:'Details',exact:true}).click();
    await (scenario.entry==='details'?page.getByRole('dialog'):page).getByRole('button',{name:'Run again',exact:true}).click();
    const dialog=page.getByRole('dialog');
    const refreshed=scenario.changed||scenario.duplicate?null:page.waitForResponse(response=>response.url().endsWith('/fixture-action')&&response.request().postDataJSON().name==='loadOwnerCampaignsAction');
    await dialog.getByRole('button',{name:legacy?'Save campaign':'Run again',exact:true}).click();
    if(scenario.duplicate){
     await dialog.getByRole('alert').filter({hasText:/already.*campaign/i}).waitFor();
     assert.equal((await db.query('select count(*)::int n from owner_campaigns')).rows[0].n,2);assert.equal(await noticeCount(),notices);
     assert.deepEqual((await db.query('select available_credits,reserved_credits from campaign_wallets where salon_id=$1',[salon])).rows[0],balanceBefore,'a legacy pending copy cannot cause a second reservation');
     assert.equal(actionCalls.includes('createOwnerCampaignAction'),false,'a blocked rerun never falls back to new creation');
    }else if(scenario.changed){
     await dialog.getByRole('alert').filter({hasText:/content changed/i}).waitFor();assert.equal((await db.query('select count(*)::int n from owner_campaigns')).rows[0].n,1);assert.equal(await noticeCount(),notices);
    }else{
     await refreshed;
     const after=(await db.query('select * from owner_campaigns where id<>$1',[original])).rows[0];assert.ok(after);
     if(legacy){assert.equal(after.status,'pending_review');assert.equal(after.run_again_of,null);assert.equal(await noticeCount(),notices+1);assert.ok(actionCalls.includes('createOwnerCampaignAction'))}
     else{
      assert.equal(after.status,scenario.credits?'running':'awaiting_payment');assert.equal(after.run_again_of,original);assert.equal(await noticeCount(),notices);assert.ok(actionCalls.includes('runAgainOwnerCampaignAction'));
      assert.equal(actionCalls.includes('createOwnerCampaignAction'),false);assert.equal(calls.includes('campaign_create_versioned'),false,'the UI must not route through normal creation');
      if(!scenario.credits){await db.query('update campaign_wallets set available_credits=1000 where salon_id=$1',[salon]);const funded=await actions.fundSavedCampaignAction(after.id);assert.equal(funded.ok,true);assert.match(funded.message,/running/i);assert.equal(await noticeCount(),notices)}
      const running=(await db.query('select * from owner_campaigns where id=$1',[after.id])).rows[0];assert.equal(running.status,'running');assert.equal(new Date(running.approved_at).getTime(),new Date(before.approved_at).getTime());assert.equal(running.reserved_credits,250);assert.ok(running.starts_at&&running.ends_at);
     }
    }
    assert.deepEqual((await db.query('select * from owner_campaigns where id=$1',[original])).rows[0],before,'old history is unchanged');assert.deepEqual(errors,[]);
   }finally{await context?.close();if(server)await new Promise(resolve=>server.close(resolve));await db.close();delete globalThis.__runAgainE2E}
  }
 }finally{await browser.close()}
});

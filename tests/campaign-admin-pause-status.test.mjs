import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {createCampaignCumulativeDb,ids,readCampaignMigration} from './fixtures/campaign-cumulative-db.mjs';

const before=['20261021040000_campaign_expiry_settlement.sql','20261021050000_campaign_accounting_read.sql','20261021060000_campaign_credit_queue_progress.sql','20261021070000_campaign_pause_lifecycle.sql'];
const migration=readCampaignMigration('20261021080000_campaign_admin_pause_status.sql');
const extras=['owner_paused_at','pause_episode_id','pause_origin'];
const {campaign,salon,owner}=ids;
const metadata=async db=>(await db.query(`select a.attnum,a.attname,a.atttypid::regtype::text type,a.attacl::text acl
 from pg_attribute a where a.attrelid='admin_campaign_list'::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`)).rows;
const access=async db=>(await db.query(`select relacl::text acl,relowner::regrole::text owner,reloptions options,
 has_table_privilege('anon',oid,'select') anon,has_table_privilege('authenticated',oid,'select') authenticated,
 has_table_privilege('service_role',oid,'select') service from pg_class where oid='admin_campaign_list'::regclass`)).rows[0];
const state=async db=>(await db.query(`select jsonb_build_object(
 'campaigns',(select jsonb_agg(to_jsonb(c) order by id) from owner_campaigns c),
 'wallets',(select jsonb_agg(to_jsonb(w) order by salon_id) from campaign_wallets w),
 'ledger',(select jsonb_agg(to_jsonb(l) order by id) from campaign_credit_ledger l),
 'reminders',(select jsonb_agg(to_jsonb(r) order by campaign_id,episode_id,milestone_hours) from campaign_pause_reminders r)
 ) result`)).rows[0].result;

test('admin view appends exact pause columns without changing existing order, rows, ACLs or accounting',async()=>{
 const db=await createCampaignCumulativeDb({migrations:before});
 try{
  await db.query("select owner_campaign_change($1,$2,$3,'pause')",[campaign,salon,owner]);
  const oldColumns=await metadata(db),oldAccess=await access(db),oldState=await state(db);
  const oldRows=(await db.query('select to_jsonb(v) row from admin_campaign_list v order by id')).rows;
  assert.equal(oldColumns.at(-1).attname,'salon_name');
  assert.ok(extras.every(key=>!Object.hasOwn(oldRows[0].row,key)),'before-fix real view loses the owner pause intent');
  assert.ok(oldState.campaigns[0].owner_paused_at);
  await db.exec(migration);
  const columns=await metadata(db);
  assert.deepEqual(columns.slice(0,-3),oldColumns);
  assert.deepEqual(columns.slice(-3).map(x=>[x.attname,x.type]),[['owner_paused_at','timestamp with time zone'],['pause_episode_id','uuid'],['pause_origin','text']]);
  assert.deepEqual(await access(db),oldAccess);assert.equal(oldAccess.anon,false);assert.equal(oldAccess.authenticated,false);assert.equal(oldAccess.service,true);
  const rows=(await db.query('select to_jsonb(v) row from admin_campaign_list v order by id')).rows;
  assert.deepEqual(rows.map(({row})=>({row:Object.fromEntries(Object.entries(row).filter(([key])=>!extras.includes(key)))})),oldRows);
  for(const key of extras)assert.deepEqual(rows[0].row[key],oldState.campaigns[0][key]);
  assert.deepEqual(await state(db),oldState);
  await db.exec(migration);assert.deepEqual(await metadata(db),columns);assert.deepEqual(await access(db),oldAccess);assert.deepEqual(await state(db),oldState);
  await db.exec('set role service_role');assert.equal((await db.query('select pause_origin from admin_campaign_list')).rows[0].pause_origin,'owner');await db.exec('reset role');
  for(const role of ['anon','authenticated']){
   await db.exec(`set role ${role}`);await assert.rejects(db.query('select * from admin_campaign_list'),/permission denied/);await db.exec('reset role');
  }
 }finally{await db.close();}
});

test('newer unrelated view projections/grants survive and partial pause projections fail atomically',async()=>{
 const db=await createCampaignCumulativeDb({migrations:before});
 try{
  const original=(await db.query("select pg_get_viewdef('admin_campaign_list'::regclass,true) definition")).rows[0].definition.trim().replace(/;$/,'');
  await db.exec(`create or replace view admin_campaign_list as select prior.*,42::integer review_extra from (${original}) prior;create role fixture_view_reader;grant select on admin_campaign_list to fixture_view_reader`);
  const columns=await metadata(db),acl=await access(db);
  await db.exec(migration);assert.deepEqual((await metadata(db)).slice(0,-3),columns);assert.deepEqual(await access(db),acl);
  assert.equal((await db.query('select review_extra from admin_campaign_list')).rows[0].review_extra,42);
  assert.equal((await db.query("select has_table_privilege('fixture_view_reader','admin_campaign_list','select') allowed")).rows[0].allowed,true);
  // An incompatible definition must fail before touching this newer view.
  await db.exec('alter view admin_campaign_list rename column pause_origin to unexpected_pause_origin');
  const changed=await metadata(db),snapshot=await state(db);
  await assert.rejects(db.exec(migration),/unsupported existing projection/);await db.exec('rollback');
  assert.deepEqual(await metadata(db),changed);assert.deepEqual(await access(db),acl);assert.deepEqual(await state(db),snapshot);
 }finally{await db.close();}
});

const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const allowed=new Set(['app/(app)/admin/plugins/campaigns/campaign-list.tsx','lib/campaign-status.ts','lib/campaign-credit-display.ts']);
const cache=new Map(),calls=[];
function load(file){
 if(cache.has(file))return cache.get(file);
 assert.ok(allowed.has(file),'unapproved runtime import '+file);
 const output=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText;
 const module={exports:{}};
 vm.runInNewContext(output,{module,exports:module.exports,Date,Intl,console,require(specifier){
  if(specifier==='react'||specifier==='react/jsx-runtime')return require(specifier);
  if(specifier==='next/navigation')return{useRouter:()=>({refresh:()=>calls.push('refresh')})};
  if(specifier==='next/image')return{default:props=>{const imageProps={...props};delete imageProps.unoptimized;return React.createElement('img',imageProps);}};
  if(specifier==='./actions')return{manageCampaignAction:()=>{calls.push('mutation');throw Error('SSR must not mutate');}};
  if(specifier.startsWith('@/'))return load(specifier.slice(2)+'.ts');
  throw Error('unapproved runtime dependency '+specifier);
 }},{filename:file});
 cache.set(file,module.exports);return module.exports;
}
const {CampaignList}=load('app/(app)/admin/plugins/campaigns/campaign-list.tsx');
const {campaignStatus}=load('lib/campaign-status.ts');
const base={id:campaign,salon_id:salon,source_type:'salon_profile_look',source_id:ids.post,title:'Fixture campaign',salonName:'Fixture salon',location:'Milwaukee',country:'US',area:'city',state:'WI',city:'Milwaukee',status:'running',created_at:'2026-10-01T00:00:00Z',updated_at:'2026-10-21T00:00:00Z',starts_at:'2020-01-01T00:00:00Z',ends_at:'2099-01-01T00:00:00Z',spent_cents:12,total_price_cents:300,views:2,likes:0,bookings:0,image:null,caption:'Fixture',href:null,owner_paused_at:null,pause_episode_id:null};
const render=c=>renderToStaticMarkup(React.createElement(CampaignList,{campaigns:[c]}));
const text=html=>html.replace(/<[^>]*>/g,'').replaceAll('&amp;','&').replaceAll('&#x27;',"'").replaceAll('&quot;','"');
const buttons=html=>[...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map(match=>text(match[1]));

test('real admin React render explains owner pause and never offers an override or hides the row',()=>{
 for(const [status,ends_at] of [['paused','2099-01-01T00:00:00Z'],['paused','2020-02-01T00:00:00Z'],['completed','2020-02-01T00:00:00Z']]){
  const c={...base,status,ends_at,owner_paused_at:'2020-01-02T00:00:00Z',pause_episode_id:ids.nonce};
  const html=render(c),controls=buttons(html);
  assert.ok(text(html).includes(campaignStatus(c).label),'shared truthful status rendered');
  assert.ok(text(html).includes('Owner must resume'),'admin gets an actionable explanation');
  assert.ok(!controls.includes('Resume'));assert.ok(!controls.includes('Pause'));
  assert.ok(controls.includes('Delete'));assert.ok(controls.includes('Details'));assert.ok(html.includes('<article'));
 }
 assert.deepEqual(calls,[],'initial rendering performs no action');
});

test('real admin React render retains valid period/review controls and blocks expired controls',()=>{
 assert.ok(buttons(render(base)).includes('Pause'));
 assert.ok(buttons(render({...base,status:'paused'})).includes('Resume'));
 for(const status of ['running','paused']){
  const c={...base,status,ends_at:'2020-02-01T00:00:00Z'},html=render(c),controls=buttons(html);
  assert.ok(text(html).includes(campaignStatus(c).label));
  assert.ok(!controls.includes('Pause'));assert.ok(!controls.includes('Resume'));assert.ok(controls.includes('Delete'));
 }
 for(const status of ['pending_review','awaiting_payment']){
  const controls=buttons(render({...base,status}));assert.ok(controls.includes('Edit'));assert.ok(controls.includes('Delete'));
  assert.equal(controls.includes('Approve'),status==='pending_review');assert.equal(controls.includes('Decline'),status==='pending_review');
 }
 const scheduled={...base,starts_at:'2098-01-01T00:00:00Z'};assert.ok(text(render(scheduled)).includes('Scheduled'));
 assert.deepEqual(calls,[]);
});

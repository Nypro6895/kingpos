// Real Next.js routes, Server Actions and current Platform Admin auth/shell.
// The loopback-only HTTP adapter replaces hosted Supabase, NOT the app guards.
// Role/permission SQL is loaded from the project's actual admin migration.
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {chromium} from 'playwright-core';

const root=process.cwd(),canonical=path.resolve(process.env.MEMBERSHIP_CANONICAL_ROOT||'C:/Reylumi/kingpos');
const output=path.resolve('artifacts/membership-next'),project=path.join(output,'candidate');
fs.mkdirSync(project,{recursive:true});
const slash=p=>p.replaceAll('\\','/');
const hash=s=>createHash('sha256').update(s).digest('hex');
const write=(file,text)=>{const p=path.join(project,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,text);};
const relative=(file,target)=>{const p=slash(path.relative(path.dirname(path.join(project,file)),target));return p.startsWith('.')?p:'./'+p;};
const sharedBefore=new Map();
function shared(file){const text=fs.readFileSync(path.join(canonical,file),'utf8');sharedBefore.set(file,hash(text));return text;}

// Overlay current shared files narrowly. Never replace or write the canonical files.
let shell=shared('app/(app)/admin/_components/admin-ui.tsx');
assert.ok(shell.includes('const ADMIN_NAV_ITEMS: AdminNavItem[] = ['));
shell=shell.replace('const ADMIN_NAV_ITEMS: AdminNavItem[] = [','const ADMIN_NAV_ITEMS: AdminNavItem[] = [\n  { href: "/admin/membership", label: "Membership", permission: PLATFORM_ADMIN_PERMISSIONS.membershipRead, group: "Platform management", icon: "◇" },');
assert.ok(shell.includes('"/admin/locations", "/admin/attention"'));shell=shell.replace('"/admin/locations", "/admin/attention"','"/admin/locations", "/admin/membership", "/admin/attention"');
shell=shell.replace(/from\s+(["'])(\.{1,2}\/[^"']+)\1/g,(_m,q,request)=>`from ${q}${slash(path.resolve(canonical,'app/(app)/admin/_components',request))}${q}`);
write('shared/admin-ui.tsx',shell);
let types=shared('types/platform-admin.ts');
types=types.replace('export const PLATFORM_ADMIN_PERMISSIONS = {','export const PLATFORM_ADMIN_PERMISSIONS = {\n membershipRead: "admin.membership.read", membershipConfigure: "admin.membership.configure", membershipManage: "admin.membership.manage",');
write('shared/platform-admin.ts',types);
let settings=shared('app/(app)/admin/settings/page.tsx');
assert.ok(settings.includes('MarketSystemWorkspace'),'Current Settings must keep Market & System.');
const settingsOverlay=settings.replace('return <MarketSystemWorkspace/>','return <><MembershipSettingsLinks/><MarketSystemWorkspace/></>');
assert.notEqual(settingsOverlay,settings,'Review the changed Settings source before applying the overlay.');
write('shared/settings-merged.tsx','import { MembershipSettingsLinks } from '+JSON.stringify(slash(path.join(root,'app/(app)/admin/membership/settings-links')))+';\n'+settingsOverlay);
write('package.json',JSON.stringify({name:'membership-next-verification',private:true,version:'0.0.0'}));
if(!fs.existsSync(path.join(project,'node_modules')))fs.symlinkSync(path.join(canonical,'node_modules'),path.join(project,'node_modules'),'junction');
const aliases={
 '@/types/platform-admin':path.join(project,'shared/platform-admin.ts'),
 '@/types/reylumi-membership':path.join(root,'types/reylumi-membership.ts'),
 '@/lib/membership-model':path.join(root,'lib/membership-model.ts'),
 '@/lib/platform-admin/membership':path.join(root,'lib/platform-admin/membership.ts'),
 '@/app/(app)/admin/_components/admin-ui':path.join(project,'shared/admin-ui.tsx'),
 '@':canonical,
};
write('next.config.mjs',`export default {cacheComponents:true,reactCompiler:true,experimental:{externalDir:true},typescript:{ignoreBuildErrors:true},webpack(config){Object.assign(config.resolve.alias,${JSON.stringify(aliases)});return config;}};`);
write('tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2017',lib:['dom','esnext'],jsx:'react-jsx',module:'esnext',moduleResolution:'bundler',allowJs:true,strict:true,skipLibCheck:true,esModuleInterop:true,resolveJsonModule:true,isolatedModules:true,paths:Object.fromEntries(Object.entries(aliases).map(([k,v])=>[k==='@'?'@/*':k,[slash(v)+(k==='@'?'/*':'')]]))},include:['app/**/*.tsx','shared/**/*.tsx'],exclude:['node_modules']},null,2));
write('postcss.config.mjs',fs.readFileSync(path.join(canonical,'postcss.config.mjs'),'utf8'));
write('app/layout.tsx',`import {Suspense} from 'react';import '@/app/globals.css';import '@/app/(app)/admin/admin.css';export default function Layout({children}){return <html lang="en"><body><Suspense fallback={<p>Loading admin…</p>}>{children}</Suspense></body></html>}`);
write('shared/experience.ts',`import {getAdminExperienceContext} from '@/lib/experience-context';export function fixtureScope(actor){return getAdminExperienceContext({scope:'fixture-admin:'+actor.userId,viewerId:actor.userId,workspaceId:'fixture-admin',salonId:null,permissionRevision:'fixture-workspace',authenticated:true},actor)}`);
write('app/admin/layout.tsx',`import {AdminShell} from '@/app/(app)/admin/_components/admin-ui';import {requirePlatformAdmin} from '@/lib/platform-admin/auth';import {ExperienceScopeProvider} from '@/components/experience-scope';import {fixtureScope} from '../../shared/experience';export default async function Layout({children}){const actor=await requirePlatformAdmin(undefined,{loginNextPath:'/admin/membership'});const context=fixtureScope(actor);return <ExperienceScopeProvider key={context.scope} context={context}><AdminShell context={actor}>{children}</AdminShell></ExperienceScopeProvider>}`);
write('app/api/experience/context/route.ts',`import {getVerifiedPlatformAdminContext} from '@/lib/platform-admin/auth';import {fixtureScope} from '../../../../shared/experience';export async function GET(){const actor=await getVerifiedPlatformAdminContext();return actor?Response.json(fixtureScope(actor)):new Response('{}',{status:403})}`);
for(const [file,target] of [['app/admin/membership/page.tsx','app/(app)/admin/membership/page.tsx'],['app/membership/page.tsx','app/(legal)/membership/page.tsx'],['app/admin/settings/membership/page.tsx','app/(app)/admin/settings/membership/page.tsx']])write(file,`export {default} from ${JSON.stringify(relative(file,path.join(root,target)))};`);
write('app/admin/verify-current-settings/page.tsx',`export {default} from ${JSON.stringify(relative('app/admin/verify-current-settings/page.tsx',path.join(root,'app/(app)/admin/settings/page')))};`);
write('app/login/page.tsx',`export default function Page(){return <h1>Sign in — local verification fixture</h1>}`);
write('app/admin/verification-links/page.tsx',`export {MembershipSettingsLinks as default} from ${JSON.stringify(relative('app/admin/verification-links/page.tsx',path.join(root,'app/(app)/admin/membership/settings-links')))};`);
write('app/admin/settings/page.tsx',`export {MembershipSettingsLinks as default} from ${JSON.stringify(relative('app/admin/settings/page.tsx',path.join(root,'app/(app)/admin/membership/settings-links')))};`);
write('app/page.tsx',`export default function Page(){return <a href="/membership">Membership</a>}`);

const db=new PGlite();const owner='00000000-0000-4000-8000-000000000001',reader='00000000-0000-4000-8000-000000000002',salon='00000000-0000-4000-8000-000000000010';
await db.exec(`create role anon;create role authenticated;
create table users(id uuid primary key,auth_user_id uuid,status text,display_name text);
insert into users values('${owner}','${owner}','active','Fixture Owner'),('${reader}','${reader}','active','Fixture Reader');
create table locations(id uuid primary key,name text,phone text,city text,status text);insert into locations values('${salon}','Fixture Salon','5551234567','Madison','active');
create table platform_admin_roles(id uuid default gen_random_uuid() primary key,slug text unique,name text);
insert into platform_admin_roles(slug,name)values('platform_owner','Platform Owner'),('auditor','Auditor');
create table platform_admin_permissions(id uuid default gen_random_uuid() primary key,code text unique,name text,description text,category text);
insert into platform_admin_permissions(code,name,category) values('admin.access','Access','system');
create table platform_admin_role_permissions(role_id uuid,permission_id uuid,unique(role_id,permission_id));
insert into platform_admin_role_permissions select r.id,p.id from platform_admin_roles r cross join platform_admin_permissions p;
create table platform_admin_memberships(id uuid default gen_random_uuid() primary key,user_id uuid,role_id uuid,status text);
insert into platform_admin_memberships(user_id,role_id,status)select '${owner}',id,'active' from platform_admin_roles where slug='platform_owner';
insert into platform_admin_memberships(user_id,role_id,status)select '${reader}',id,'active' from platform_admin_roles where slug='auditor';
create table platform_admin_audit_logs(actor_user_id uuid,action text,target_type text,target_id uuid,reason text,after_data jsonb);
create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('fixture.actor',true),'')::uuid$$;`);
const adminMigration=fs.readFileSync(path.join(canonical,'supabase/migrations/202608300004_platform_admin_current_schema.sql'),'utf8');
for(const name of ['platform_admin_has_permission','get_current_platform_admin_context','platform_admin_current_actor','platform_admin_require_permission']){
 const match=adminMigration.match(new RegExp('create or replace function public\\.'+name+'\\([\\s\\S]*?\\$\\$;'));
 assert.ok(match,`Missing real admin function: ${name}`);await db.exec(match[0]);
}
for(const file of ['202611030001_reylumi_membership_admin.sql','202611030002_membership_desktop_settings.sql'])await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));

const key=randomUUID(),jwtKey=randomUUID();
function token(actor){const a=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');const b=Buffer.from(JSON.stringify({sub:actor,role:'authenticated',exp:Math.floor(Date.now()/1000)+7200,session_id:randomUUID()})).toString('base64url');return a+'.'+b+'.'+createHmac('sha256',jwtKey).update(a+'.'+b).digest('base64url');}
const ownerToken=token(owner),readerToken=token(reader),tokens=new Map([[ownerToken,owner],[readerToken,reader]]);
function adminCookie(t,now=Date.now()){const payload=JSON.parse(Buffer.from(t.split('.')[1],'base64url').toString());const value=`${payload.session_id}|${now}|${now}`;return value+'|'+createHmac('sha256',key).update('admin-session:'+value).digest('hex');}
let queue=Promise.resolve();
function serialized(fn){const next=queue.then(fn,fn);queue=next.catch(()=>{});return next;}
async function rpc(name,args,actor){return serialized(async()=>{
 await db.query("select set_config('fixture.actor',$1,false)",[actor??'']);
 const input=Object.entries(args??{});const placeholders=input.map(([k],i)=>{if(!/^(p|p_[a-z_]+)$/.test(k))throw Error('Invalid argument');return `${k} => $${i+1}`;});
 const values=input.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v);
 if(name==='get_current_platform_admin_context')return (await db.query('select * from get_current_platform_admin_context()')).rows;
 return (await db.query(`select ${name}(${placeholders.join(',')}) as value`,values)).rows[0].value;
});}
const allowed=new Set(['get_current_platform_admin_context','reylumi_membership_workspace','reylumi_membership_detail','reylumi_membership_salons','reylumi_membership_command','reylumi_membership_activity','reylumi_membership_public','reylumi_membership_website_public']);
const requests=[];
const backend=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1'),t=String(req.headers.authorization??'').replace(/^Bearer /,''),actor=tokens.get(t);
  res.setHeader('Content-Type','application/json');
  if(url.pathname==='/auth/v1/user'){if(!actor){res.statusCode=401;res.end(JSON.stringify({message:'Invalid fixture token'}));return;}res.end(JSON.stringify({id:actor,aud:'authenticated',role:'authenticated',email:'fixture@example.test',user_metadata:{},app_metadata:{provider:'email'},created_at:new Date().toISOString()}));return;}
  if(url.pathname==='/rest/v1/users'&&actor){const user={id:actor,auth_user_id:actor,status:'active',display_name:actor===owner?'Fixture Owner':'Fixture Reader',language:'en',timezone:'America/Chicago'};res.end(JSON.stringify(String(req.headers.accept).includes('object')?user:[user]));return;}
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const name=url.pathname.split('/').at(-1);if(!allowed.has(name))throw Error('Unknown fixture RPC');
   if(!actor&&!['reylumi_membership_public','reylumi_membership_website_public'].includes(name)){res.statusCode=401;res.end(JSON.stringify({message:'Authentication required'}));return;}
   let body='';for await(const chunk of req)body+=chunk;if(body.length>150000)throw Error('Payload too large');
   requests.push({name,actor:actor??'anonymous'});let result=await rpc(name,body?JSON.parse(body):{},actor);
   if(name==='get_current_platform_admin_context'&&String(req.headers.accept).includes('object'))result=result[0]??null;
   res.end(JSON.stringify(result));return;
  }
  res.statusCode=404;res.end(JSON.stringify({message:'Unsupported local fixture endpoint'}));
 }catch(error){res.statusCode=400;res.end(JSON.stringify({code:'P0001',message:error.message,details:null,hint:null}));}
});
await new Promise(r=>backend.listen(0,'127.0.0.1',r));
const backendUrl=`http://127.0.0.1:${backend.address().port}`;
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(PATH|Path|SystemRoot|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|ComSpec|PATHEXT|NUMBER_OF_PROCESSORS)$/i.test(k)));
Object.assign(env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:backendUrl,NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture-anon-key',ANTISPAM_SIGNING_KEY:key});
const next=path.join(canonical,'node_modules/next/dist/bin/next');
let server,browser,page;const log=[];
async function run(args){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[next,...args],{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [child.stdout,child.stderr])stream.on('data',b=>log.push(b.toString()));child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Next ${args[0]} failed (${code}).`)));});}
try{
 console.log('Building isolated Next.js candidate with current Admin shell and real Server Actions…');
 await run(['build','--webpack']);fs.writeFileSync(path.join(output,'build.log'),log.join(''));console.log('Next.js production build passed. Starting loopback verification…');
 server=spawn(process.execPath,[next,'start','-H','127.0.0.1','-p',String(port)],{cwd:project,env,windowsHide:true,stdio:['ignore','pipe','pipe']});for(const stream of [server.stdout,server.stderr])stream.on('data',b=>log.push(b.toString()));
 const base=`http://127.0.0.1:${port}`;let ready=false;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/login')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}assert.ok(ready,'Local Next server did not start');
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();let capturedAction;page.on('request',r=>{if(r.method()==='POST'&&r.headers()['next-action']&&!capturedAction)capturedAction={url:r.url(),headers:r.headers(),body:r.postDataBuffer()};});
 await page.goto(base+'/admin/membership');await page.getByRole('heading',{name:/Sign in/}).waitFor();assert.match(page.url(),/\/login\?/);
 await context.addCookies([{name:'sb-access-token',value:ownerToken,url:base},{name:'reylumi-admin-session',value:adminCookie(ownerToken),url:base}]);
 await page.goto(base+'/admin/membership');await page.getByRole('heading',{name:'Membership',exact:true}).waitFor();await page.getByRole('navigation',{name:'Admin',exact:true}).getByRole('link',{name:'Membership',exact:true}).waitFor();
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByLabel('growth monthly price',{exact:true}).fill('49.00');await page.getByRole('button',{name:'SMS & credit',exact:true}).click();await page.getByLabel('growth sms allowance',{exact:true}).fill('100');
 await page.getByRole('button',{name:'Plans & pricing',exact:true}).click();await page.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Enrollment',exact:true})}).getByRole('checkbox').nth(1).check();
 await page.getByRole('button',{name:'Save & publish',exact:true}).click();await page.getByRole('status').getByText(/Saved/).waitFor();
 await page.getByRole('button',{name:'Manage',exact:true}).click();await page.getByRole('button',{name:'+ Add salon',exact:true}).click();await page.getByLabel('Find active salon · name, ID or permitted phone').fill('Fixture');await page.getByRole('button',{name:/Fixture Salon Madison/}).click();await page.getByRole('button',{name:'Confirm membership',exact:true}).click();
 const row=page.getByRole('region',{name:'Salon memberships'}).getByRole('row').filter({has:page.getByRole('button',{name:'Fixture Salon',exact:true})});await row.waitFor();await row.getByRole('button',{name:'Add credit',exact:true}).click();await page.getByLabel('Credit adjustment',{exact:true}).fill('25');await page.getByRole('button',{name:'Apply adjustment',exact:true}).click();await row.getByRole('cell',{name:'125',exact:true}).waitFor();
 await row.getByRole('button',{name:'Renew',exact:true}).click();await page.getByRole('button',{name:'Confirm membership',exact:true}).click();await row.getByText(/Renewal scheduled through/).waitFor();assert.equal(await page.getByRole('region',{name:'Salon memberships'}).getByRole('row').count(),2);
 await page.screenshot({path:path.join(output,'admin-shell-manage.png'),fullPage:true});
 await page.goto(base+'/admin/verification-links');await page.getByRole('region',{name:'Membership settings links'}).getByRole('link',{name:'Manage membership →',exact:true}).click();await page.getByRole('heading',{name:'Membership',exact:true}).waitFor();
 await page.goto(base+'/admin/settings/membership');await page.getByRole('heading',{name:'Membership',exact:true}).waitFor();assert.equal(new URL(page.url()).pathname,'/admin/membership');
 const readerContext=await browser.newContext({viewport:{width:1440,height:1000}});await readerContext.addCookies([{name:'sb-access-token',value:readerToken,url:base},{name:'reylumi-admin-session',value:adminCookie(readerToken),url:base}]);const readerPage=await readerContext.newPage();await readerPage.goto(base+'/admin/membership');await readerPage.getByRole('button',{name:'Settings',exact:true}).click();assert.ok(await readerPage.getByLabel('growth monthly price',{exact:true}).isDisabled());assert.equal(await readerPage.getByRole('button',{name:'+ Add salon',exact:true}).count(),0);
 assert.ok(capturedAction,'Capture an actual owner Server Action');const eventsBeforeReplay=(await db.query('select count(*) n from reylumi_membership_events')).rows[0].n;const replay=await readerContext.request.post(capturedAction.url,{headers:{'Next-Action':capturedAction.headers['next-action'],'Content-Type':capturedAction.headers['content-type'],Origin:base,Accept:'text/x-component'},data:capturedAction.body});const replayText=await replay.text();assert.ok(replay.status()===404||replayText.includes('NEXT_HTTP_ERROR_FALLBACK;404'),'Reader must be denied at the actual Server Action boundary');assert.equal((await db.query('select count(*) n from reylumi_membership_events')).rows[0].n,eventsBeforeReplay);
 const before=await db.query('select count(*) n from reylumi_membership_events');await assert.rejects(rpc('reylumi_membership_command',{p:{action:'save_website',request_id:randomUUID(),reason:'Denied test'}},reader),/permission denied/);assert.deepEqual(await db.query('select count(*) n from reylumi_membership_events'),before);
 await readerPage.getByRole('navigation',{name:'Admin',exact:true}).getByRole('link',{name:'Settings',exact:true}).click();await readerPage.getByRole('region',{name:'Membership settings links'}).waitFor();await new Promise(r=>setTimeout(r,5500));await db.query("update platform_admin_memberships set status='revoked' where user_id=$1",[reader]);await readerPage.goBack();await readerPage.getByRole('heading',{name:'This page could not be found.'}).waitFor();
 await context.addCookies([{name:'reylumi-admin-session',value:adminCookie(ownerToken,Date.now()-31*60*1000),url:base}]);await page.goto(base+'/admin/membership');await page.getByRole('heading',{name:/Sign in/}).waitFor();
 await context.clearCookies({name:'reylumi-admin-session'});await page.goto(base+'/admin/membership');await page.getByRole('heading',{name:/Sign in/}).waitFor();
 for(const [file,beforeHash]of sharedBefore)assert.equal(hash(fs.readFileSync(path.join(canonical,file),'utf8')),beforeHash,`Canonical file changed: ${file}`);
 fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({status:'passed',scope:'Isolated real Next.js production build, current AdminShell/auth/session and Server Actions; loopback auth/PostgREST fixture with actual platform permission SQL. Not hosted acceptance.',checks:['anonymous redirect','signed admin session','actual Server Action publication','salon allocation','credit adjustment','queued renewal without duplicate salon row','authorized Settings links','settings redirect','read-only role','actual Server Action replay denial','revoked role hides retained page on Back after existing 5-second refresh window','expired admin-session denial','permission denial without mutation','missing admin-session denial','canonical source preserved'],sharedFiles:[...sharedBefore].map(([file,sha256])=>({file,sha256})),requests:requests.map(x=>x.name)},null,2));
 console.log('PASS: Next build, actual Admin shell/auth/session, Server Action publish/grant/credit, readonly role and session denial. Canonical files preserved.');
}catch(error){if(page){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure-page.txt'),await page.locator('body').innerText().catch(()=>''));}fs.writeFileSync(path.join(output,'failure.log'),log.join(''));console.error(log.join('').slice(-10000));throw error;}
finally{await browser?.close();server?.kill();await new Promise(r=>backend.close(r));await db.close();}

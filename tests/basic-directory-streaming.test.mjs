import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import React from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { chromium } from 'playwright-core';

const mocks = {
  '@/components/experience-page': 'export const withExperiencePage=Page=>Page;',
  '@/components/workspace-language': `import React from'react';export const WorkspaceText=({text})=>text;export const WorkspaceElement=({as='div',...props})=>React.createElement(as,props);`,
  '@/components/loading-feedback': `import React from'react';export const LoadingStatus=({text})=><p role="status">{text}</p>;`,
  '@/components/workspace-link': `import React from'react';export const WorkspaceLink=props=><a {...props}/>;`,
  '@/components/submit-button': `import React from'react';export function SubmitButton({pendingLabel,...props}){return <button {...props}/>;}`,
  '@/components/salon-member-badge': 'export const SalonName=({name})=>name;',
  '@/app/activity/my-reviews': 'export const MyReviews=()=>null;',
  'next/link': `import React from'react';export default props=><a {...props}/>;`,
  'next/form': `import React from'react';export default props=><form {...props}/>;`,
  'next/image': `import React from'react';export default function Image({fill,priority,...props}){return <img {...props}/>;}`,
  'next/navigation': `export const redirect=href=>{throw Error('REDIRECT:'+href)};export const notFound=()=>{throw Error('NOT_FOUND')};`,
  'next/cache': `export const revalidatePath=()=>{throw Error('No writes permitted')};`,
  '@/lib/workspace-language-server': 'export const getWorkspaceTranslation=async()=>text=>text;',
  '@/lib/customer-date-time': 'export const formatCustomerDateTime=value=>value??"No visits";',
  '@/lib/salon-business-clock': 'export const getContextBusinessTimezone=async()=>"America/Chicago";',
  '@/lib/route-context-guards': `export async function requireSalonManagePageContext(){const f=globalThis.__directory;f.admissions++;if(!f.context.user)throw Error('REDIRECT:/login');return f.context;}`,
  '@/lib/permissions': `export const hasPermission=async()=>globalThis.__directory.manage;export async function requirePermission(permission,context){const f=globalThis.__directory;f.permissionChecks.push({permission,context});if(!f.view)throw Error('Directory access denied');}`,
  '@/lib/customers': `export const CUSTOMER_PERMISSIONS={view:'customers.view'};export async function getCurrentSalonCustomerList(input){const f=globalThis.__directory;f.reads.push({type:'customers',input});await f.held;return{context:f.context,customers:f.customers,pagination:{count:1,page:1,pageCount:1,pageSize:30}};}`,
  '@/app/customers/automatic-customer-merge': 'export const AutomaticCustomerMerge=()=>null;',
  '@/app/customers/duplicate-merge-forms': 'export const DuplicateMergeForms=()=>null;',
  '@/lib/current-context': `export async function getCurrentBusinessContext(){const f=globalThis.__directory;f.admissions++;return f.context;}`,
  '@/lib/account-social': `export async function getAccountSavedPosts(input){const f=globalThis.__directory;f.reads.push({type:'saved',input});await f.held;return f.posts;}export async function getAccountFollowing(input){const f=globalThis.__directory;f.reads.push({type:'following',input});await f.held;return f.following;}const forbid=()=>{throw Error('No writes permitted')};export const removeAccountBeautyProfileFollow=forbid,removeAccountFavoriteShop=forbid,removeAccountSavedPost=forbid;`,
};
const built = await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`export {default as Customers} from './app/(app)/customers/page';export {default as MoreSection} from './app/(app)/more/[section]/page';`},bundle:true,platform:'node',format:'esm',write:false,packages:'external',jsx:'automatic',plugins:[{name:'directory-read-transports',setup(b){
  b.onResolve({filter:/.*/},a=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:undefined);
  b.onResolve({filter:/\.module\.css$/},a=>({path:a.path,namespace:'style'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx',resolveDir:process.cwd()}));
  b.onLoad({filter:/.*/,namespace:'style'},()=>({contents:'export default new Proxy({},{get:(_,key)=>String(key)});',loader:'js'}));
}}]});
// Write no fixture source: resolve React imports through the current repository.
const source=built.outputFiles[0].text.replaceAll('from "react"',`from ${JSON.stringify(import.meta.resolve('react'))}`).replaceAll('from "react/jsx-runtime"',`from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`);
const pages=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function fixture(){
  let release;
  const f={held:new Promise(resolve=>release=resolve),release:()=>release(),context:{user:{id:'owner-a'},currentSalon:{id:'salon-a'}},manage:true,view:true,admissions:0,permissionChecks:[],reads:[],errors:[],
    customers:[{id:'customer-a',name:'Private customer result',status:'active',source:'pos',phone:null,duplicate_signal:false,metrics:{cancelled_count:0,no_show_count:0,last_visit_at:null,appointment_count:0,finalized_spend:0,active_pos_ticket_count:0}}],
    posts:[{id:'saved-a',sourceId:'post-a',sourceType:'beauty_post',salonId:null,title:'Private saved result',href:'/beauty/post-a',imageUrl:null,contentLabel:'Beauty post',salonName:null}],
    following:{filter:'shop',items:[{id:'follow-a',targetId:'salon-b',targetType:'shop',name:'Private following result',href:'/book/salon-b',imageUrl:null,secondaryLabel:null}],page:1,pageSize:10,query:'Lumi',totalCount:1,totalPages:1}};
  globalThis.__directory=f;return f;
}
let browser,server,origin;
test.before(async()=>{
  const executablePath=[process.env.TEST_BROWSER_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&existsSync(p));assert(executablePath);
  browser=await chromium.launch({executablePath,headless:true});
  server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');if(url.pathname==='/favicon.ico'){res.end();return;}
    const props={searchParams:Promise.resolve(Object.fromEntries(url.searchParams)),params:Promise.resolve({section:url.pathname.split('/').at(-1)})};
    try{
      const element=await (url.pathname==='/customers'?pages.Customers(props):pages.MoreSection(props));
      const stream=renderToPipeableStream(React.createElement('html',null,React.createElement('body',null,element)),{onShellReady(){res.setHeader('Content-Type','text/html; charset=utf-8');stream.pipe(res);},onShellError(error){res.statusCode=500;res.end(error.message);},onError(error){globalThis.__directory.errors.push(error.message);}});
    }catch(error){globalThis.__directory.errors.push(error.message);res.statusCode=403;res.end('Denied');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
});
test.after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});

for(const scenario of [
  {path:'/customers?q=Anna',heading:'Customers',input:'Search customers',pending:'Loading customers…',result:'Private customer result',type:'customers'},
  {path:'/more/saved-post?filter=beauty_post&q=Lumi&page=3',input:'Search saved posts',pending:'Loading saved posts…',result:'Private saved result',type:'saved'},
  {path:'/more/following?filter=shop&q=Lumi',input:'Search following',pending:'Loading following…',result:'Private following result',type:'following'},
])test(`Real ${scenario.type} search/filter chrome streams before its held rows and retains the same DOM on completion`,async()=>{
  const f=fixture(),page=await browser.newPage({viewport:{width:390,height:844}});page.setDefaultTimeout(5000);page.setDefaultNavigationTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(origin+scenario.path,{waitUntil:'commit'});
    await page.getByRole('status').filter({hasText:scenario.pending}).waitFor();
    assert.equal(f.reads.length,1);assert.equal(f.reads[0].type,scenario.type);assert.ok(f.admissions>0);
    assert.equal(await page.getByText(scenario.result,{exact:true}).count(),0);
    if(scenario.heading)await page.getByRole('heading',{name:scenario.heading,exact:true}).waitFor();
    const input=page.getByRole('searchbox',{name:scenario.input,exact:true});await input.fill('Unsubmitted local search');
    await page.evaluate(()=>{window.retainedSearch=document.querySelector('input[type="search"]');window.retainedFilters=document.querySelector('nav');});
    f.release();await page.getByText(scenario.result,{exact:true}).first().waitFor();
    assert.equal(await input.inputValue(),'Unsubmitted local search');
    assert.equal(await page.evaluate(()=>window.retainedSearch===document.querySelector('input[type="search"]')&&window.retainedSearch.isConnected&&window.retainedFilters===document.querySelector('nav')),true);
    assert.equal(await page.getByRole('searchbox',{name:scenario.input,exact:true}).count(),1,'A streamed body must not duplicate its controls');
    if(scenario.type==='customers'){assert.equal(f.permissionChecks[0].permission,'customers.view');assert.deepEqual(f.reads[0].input,{page:undefined,search:'Anna'});await page.getByRole('link',{name:'Create customer',exact:true}).waitFor();}
    if(scenario.type==='saved')assert.deepEqual(f.reads[0].input,{filter:'beauty_post',limit:11,offset:20,query:'Lumi'});
    if(scenario.type==='following'){assert.deepEqual(f.reads[0].input,{filter:'shop',page:1,pageSize:10,query:'Lumi'});await page.getByRole('button',{name:'Unfollow Private following result',exact:true}).waitFor();}
    assert.deepEqual(f.errors,[]);assert.deepEqual(errors,[]);
  }finally{f.release();await page.close();}
});

test('Directory admission and view permission still reject before a row loader or actionable toolbar is returned',async()=>{
  const f=fixture();f.view=false;
  await assert.rejects(pages.Customers({searchParams:Promise.resolve({})}),/Directory access denied/);
  assert.deepEqual(f.reads,[]);
  f.context.user=null;
  await assert.rejects(pages.MoreSection({params:Promise.resolve({section:'saved-post'}),searchParams:Promise.resolve({})}),/REDIRECT:\/login/);
  assert.deepEqual(f.reads,[]);f.release();
});

test('Read-only Customer permission does not render Create/Edit controls while its rows stream',async()=>{
  const f=fixture();f.manage=false;const page=await browser.newPage();
  try{await page.goto(origin+'/customers',{waitUntil:'commit'});await page.getByRole('status').filter({hasText:'Loading customers…'}).waitFor();assert.equal(await page.getByRole('link',{name:'Create customer',exact:true}).count(),0);f.release();await page.getByText('Private customer result',{exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Edit Private customer result',exact:true}).count(),0);}finally{f.release();await page.close();}
});

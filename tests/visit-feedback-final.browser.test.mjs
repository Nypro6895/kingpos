import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import ts from 'typescript';
import {chromium} from 'playwright-core';

test('real feedback components: compact rows, one-shot form, two-sided review and customer resolution',{timeout:90000},async()=>{
 const root=process.cwd(),out='artifacts/visit-feedback-final/browser';fs.mkdirSync(out,{recursive:true});
 const bundle=await build({bundle:true,write:false,outdir:'fixture',format:'iife',jsx:'automatic',stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';
 import{CustomerJourney}from'./app/activity/customer-journey';
 import{MyReviewsList}from'./app/activity/my-reviews-list';
 import{VisitExperiencePrompt}from'./app/activity/visit-experience-prompt';
 import{VisitReplyControls}from'./app/activity/visit-reply-controls';
 const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
 const salon={id:id(1),name:'King Nails Spa LLC',location:'Milwaukee',imageUrl:null,coverUrl:null};
 const purchase={type:'purchase',id:'purchase-1',ticketId:id(2),ticketNumber:'1042',occurredAt:'2026-10-29T19:30:00Z',timezone:'America/Chicago',currency:'USD',status:'completed',salon,services:[{id:id(3),name:'Gel manicure',staffName:null}],title:'Visit',total:45,visitType:'walk_in',verifiedVisit:{status:'verified',experienceState:null,experienceBody:null,experienceCreatedAt:null,countsTowardReputation:true,windowDays:10}};
 const saved={...purchase,id:'purchase-2',ticketId:id(4),ticketNumber:'1038',occurredAt:'2026-10-28T16:00:00Z',total:30,verifiedVisit:{...purchase.verifiedVisit,experienceState:'good',experienceId:id(5)}};
 const review={id:id(6),salon_id:id(1),salon_name:salon.name,ticket_id:id(2),feedback_state:'issue',body:'My gel polish chipped the next day.',issue_status:'acknowledged',created_at:'2026-10-29T20:00:00Z',edited_at:null,reply_body:'Please call us to arrange a touch-up.',reply_created_at:'2026-10-30T15:00:00Z',verified:true,salon_public:true,customer_resolved_at:null};
 window.calls=[];window.routes=[];window.fail=false;window.reads=[];window.scope='customer-a';
 window.server=async(name,args)=>{window.calls.push({name,args});await new Promise(r=>setTimeout(r,30));if(window.fail)return{error:'Please try again.'};return{error:null,experienceId:id(6),countsTowardReputation:true,salonId:id(1)}};
 const app=createRoot(document.getElementById('root'));let revision=0;
 window.showView=(view,options={})=>app.render(<React.Fragment key={++revision}>{view==='history'?<CustomerJourney initialTab='history' activity={{history:[purchase,saved],upcoming:[],salonCount:1,totalCount:2}}/>:view==='form'?<main className='fixtureMain'><h1>Share experience</h1><p>King Nails Spa LLC · Oct 29, 2026</p><VisitExperiencePrompt ticketId={id(2)} salonName={salon.name} countsTowardReputation windowDays={10}/></main>:view==='salon'?<main className='fixtureMain'><VisitReplyControls salonId={id(1)} experienceId={id(6)} hasReply={options.replied??true} issueStatus='acknowledged' onChanged={()=>{}}/></main>:<main className='fixtureMain'><MyReviewsList rows={options.empty?[]:[{...review,...options}, {...review,id:id(5),feedback_state:'good',body:null,reply_body:null,issue_status:'resolved'}]} page={1} focused={false} error={null}/></main>}</React.Fragment>);
 window.showView('history');
 `},plugins:[{name:'isolated-boundaries',setup(b){
  const stubs={
   'experience-scope':`export function useExperienceScope(){return{context:{authenticated:true,scope:window.scope}}}`,
   'workspace-language':`export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;`,
   'overlay-dismissal':`export function useCloseOnNavigation(){};export function useNativeDialogNavigation(){};export function useTransientOverlay(){}`,
   'use-persistent-read-view':`export function usePersistentReadView(){}`,
   'customer-history-client':`export async function loadCustomerHistoryRead(scope,input){window.reads.push({scope,input});return{error:'No detail read expected'}}`,
   'next/link':`export default function Link({href,children,prefetch,...props}){return <a href={href} {...props} onClick={e=>{e.preventDefault();window.routes.push(href)}}>{children}</a>}`,
   'next/navigation':`export function useRouter(){return{refresh:()=>{},replace:href=>window.routes.push(href)}}`,
  };
  b.onResolve({filter:/(?:^next\/(?:link|navigation)$|\/(?:experience-scope|workspace-language|overlay-dismissal|use-persistent-read-view|customer-history-client)$)/},a=>({path:a.path.startsWith('next/')?a.path:a.path.split('/').at(-1),namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'tsx',resolveDir:root}));
  b.onLoad({filter:/\.[tj]sx?$/},async a=>{if(a.path.includes('node_modules'))return;const text=await fs.promises.readFile(a.path,'utf8');if(!/^\s*["']use server["'];/.test(text))return;const source=ts.createSourceFile(a.path,text,ts.ScriptTarget.Latest,true);const names=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)).map(n=>n.name.text);return{loader:'js',contents:names.map(name=>`export async function ${name}(...args){return window.server(${JSON.stringify(name)},args)}`).join('\n')};});
 }}]});
 const js=bundle.outputFiles.find(x=>x.path.endsWith('.js')).text,modules=bundle.outputFiles.find(x=>x.path.endsWith('.css')).text;
 const files=['app/activity/customer-journey.tsx','app/activity/my-reviews-list.tsx','app/activity/visit-experience-prompt.tsx','app/activity/visit-reply-controls.tsx'];
 const tw=await compile(fs.readFileSync('app/globals.css','utf8'),{base:root,onDependency:()=>{}});
 const css=tw.build(files.flatMap(file=>fs.readFileSync(file,'utf8').split(/[\s"'`<>{}=;(),]+/)))+modules;
 const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:white;color:#241f25;font-family:Arial,sans-serif}.fixtureMain{padding:16px;max-width:700px;margin:auto}.fixtureMain h1{font-size:24px;font-weight:650}.fixtureHeader{height:90px;display:flex;align-items:center;justify-content:space-between;padding:20px 16px;border-bottom:1px solid #eee}.fixtureNav{position:fixed;bottom:0;left:0;right:0;height:70px;background:white;border-top:1px solid #eee;display:flex;justify-content:space-around;align-items:center;z-index:50;color:#777;font-size:12px}#root{padding-bottom:80px}</style><header class="fixtureHeader"><b>Nene</b><b style="color:#16827d">REYLUMI</b></header><div id="root"></div><nav class="fixtureNav"><span>Explore</span><span>Bookings</span><span>Beauty</span><span>Library</span><span>More</span></nav><script>${js}</script>`;
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html)});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const checks=[];
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  for(const width of [320,390,430,768,1280]){
   await page.setViewportSize({width,height:900});await page.getByRole('link',{name:'Share experience',exact:true}).waitFor();
   const metrics=await page.getByRole('link',{name:'Share experience',exact:true}).evaluate(el=>{const status=el.parentElement.querySelector('[data-tone]'),a=el.getBoundingClientRect(),b=status.getBoundingClientRect();return{delta:Math.abs((a.top+a.bottom-b.top-b.bottom)/2),height:a.height,row:el.closest('div[class*="row"]')?.getBoundingClientRect().height}});
   assert.ok(metrics.delta<2,JSON.stringify(metrics));assert.ok(metrics.height>=44);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:out+'/history-'+width+'.png',fullPage:true});
  }checks.push('Status and feedback link share one baseline at 320/390/430/768/1280px, with 44px target and no overflow.');
  await page.getByRole('link',{name:'Share experience',exact:true}).click();assert.match((await page.evaluate(()=>window.routes)).at(-1),/\/activity\/receipts\/.*\/experience/);assert.equal(await page.evaluate(()=>window.reads.length),0);await page.getByRole('link',{name:'View experience',exact:true}).click();assert.match((await page.evaluate(()=>window.routes)).at(-1),/\/more\/reviews\?experience=/);checks.push('History actions directly target form or exact review without opening receipt drawer.');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.showView('form'));await page.getByRole('heading',{name:'How was your visit?'}).waitFor();assert.equal(await page.getByRole('button',{name:'Share experience',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Good',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.length),0);await page.getByRole('textbox').fill('Draft stays if save fails.');await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Share experience',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('textbox').inputValue(),'Draft stays if save fails.');await page.screenshot({path:out+'/form-retry.png',fullPage:true});
  await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Share experience',exact:true}).dblclick();await page.getByText('Your experience has been shared.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.name==='recordVisitExperienceAction').length),2);assert.equal(await page.getByRole('textbox').count(),0);checks.push('Explicit one-shot submit; failed draft retained; double-click retry produces one successful call and exact review redirect.');
  await page.evaluate(()=>window.showView('reviews'));await page.getByRole('heading',{name:'My experiences',exact:true}).waitFor();assert.equal(await page.getByText('Verified visit',{exact:false}).count(),0);assert.equal(await page.getByRole('textbox').count(),0);assert.equal(await page.getByRole('button',{name:/edit|reply|conversation/i}).count(),0);assert.equal(await page.getByRole('button',{name:'Mark as resolved',exact:true}).count(),1);
  for(const width of [320,390,430,768]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'/reviews-'+width+'.png',fullPage:true});}
  await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Mark as resolved',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByText('Resolved · Confirmed by you',{exact:true}).count(),0);await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Mark as resolved',exact:true}).click();await page.getByText('Resolved · Confirmed by you',{exact:true}).waitFor();assert.ok(await page.getByText('My gel polish chipped the next day.',{exact:true}).isVisible());checks.push('Both sides visible; optional customer resolution preserves Issue and original text; error does not falsely resolve.');
  await page.evaluate(()=>window.showView('reviews',{reply_body:null}));await page.getByText('Awaiting salon reply.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Mark as resolved',exact:true}).count(),0);
  await page.evaluate(()=>window.showView('salon'));await page.waitForTimeout(50);assert.equal(await page.getByRole('button').count(),0);await page.evaluate(()=>window.showView('salon',{replied:false}));await page.getByRole('textbox').waitFor();await page.getByRole('textbox').fill('Please call us.');await page.getByRole('button',{name:'Reply',exact:true}).click();await page.getByRole('textbox').waitFor({state:'detached'});assert.equal(await page.getByRole('button').count(),0);checks.push('No resolution before a salon reply; salon has a single reply and no status controls after posting.');
  await page.evaluate(()=>window.showView('reviews',{empty:true}));await page.getByText('No shared experiences yet.',{exact:true}).waitFor();assert.equal(await page.locator('article').count(),0);checks.push('My experiences only lists submitted feedback, never pending-review visit cards.');
  assert.deepEqual(errors,[]);fs.writeFileSync(out+'/results.json',JSON.stringify({passed:true,checks,errors,limits:'Actual client components with isolated server/action boundaries. Not authenticated production or physical iPhone evidence.'},null,2));console.log(checks.join('\n'));
 } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});

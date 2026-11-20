import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {build} from 'esbuild';
import {compile} from '@tailwindcss/node';
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
const source=fs.readFileSync('app/salon-profile/salon-profile-view.tsx','utf8');
test('approved experiences: real cards, combined filters, drafts, moderation and one-shot replies', {timeout:60000}, async()=>{
 const root=process.cwd(),out='artifacts/experiences-approved/browser';fs.mkdirSync(out,{recursive:true});
 const functions=source.slice(source.indexOf('function ReviewReplyForm('),source.indexOf('function LookDetailDialog('));
 const render=source.slice(source.indexOf('  function renderExperiences()'),source.indexOf('  function renderAbout()'));
 const bundle=await build({bundle:true,write:false,outdir:'fixture',format:'iife',jsx:'automatic',stdin:{resolveDir:root,loader:'tsx',contents:`
 import React,{useState,useTransition} from 'react';import{createRoot}from'react-dom/client';
 import{ExperienceReplyComposer,ExperienceReplyGroup}from'./components/experience-reply-composer';
 import{VisitReplyControls}from'./app/activity/visit-reply-controls';
 import experienceStyles from './app/salon-profile/experiences.module.css';
 const WorkspaceText=({text})=>text,useWorkspaceTranslation=()=>x=>x;
 const timeAgo=()=> '2 days ago';
 const BlockUserButton=()=> <button>Block user</button>;
 const SocialTextReportButton=()=> <button onClick={()=>window.reports++}>Report</button>;
 const ExperienceSummaryPanel=()=>null;
 const EmptyState=({title,children})=><div><h3>{title}</h3>{children}</div>;
 const createSalonProfileReviewReplyAction=async args=>window.server('legacy',args);
 window.calls=[];window.reports=0;window.fail=false;window.server=async(name,args)=>{window.calls.push({name,args});await new Promise(r=>setTimeout(r,100));return {error:window.fail?'Please try again.':null}};
 ${functions}
 function App(){
 const __vt=x=>x;
 const [experienceFilter,setExperienceFilter]=useState('all'),[verifiedExperiencesOnly,setVerifiedExperiencesOnly]=useState(false);
 const capabilities={canReplyAsSalon:true,currentUserId:'owner'};
 const data={reputationSummary:{},experiences:[
 {id:'1',salonId:'salon',source:'experience',authorDisplayName:'Nene',createdAt:'2026-11-10T12:00:00Z',feedbackState:'good',verificationStatus:'verified'},
 {id:'2',salonId:'salon',source:'legacy_review',authorDisplayName:'Mia',authorUserId:'mia',createdAt:'2026-11-10T12:00:00Z',feedbackState:'good',verificationStatus:'unverified',body:'Friendly team and a lovely visit.'},
 {id:'3',salonId:'salon',source:'experience',authorDisplayName:'Nene',createdAt:'2026-11-10T12:00:00Z',feedbackState:'issue',verificationStatus:'verified',body:'Please help with my visit.',issueStatus:'open'}]};
 const refresh=()=>{};
 ${render}
 return renderExperiences();
 }
 createRoot(document.getElementById('root')).render(<App/>);
 `},plugins:[{name:'boundaries',setup(b){
 b.onResolve({filter:/workspace-language$/},()=>({path:'translation',namespace:'fixture'}));
 b.onResolve({filter:/\.\/experience-actions$/},()=>({path:'actions',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',contents:a.path==='translation'?'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>x=>x;':'export async function replyToVisitExperienceAction(args){return window.server("visit",args)}'}));
 }}]});
 const tw=await compile(fs.readFileSync('app/globals.css','utf8'),{base:root,onDependency:()=>{}});
 const css=tw.build(source.split(/[\s"'`<>{}=;(),]+/))+bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
 const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
 const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;background:#f6f5f3;font-family:Arial,sans-serif}#root{padding:16px;max-width:1100px;margin:auto}</style><div id="root"></div><script>${js}</script>`;
 const server=createServer((req,res)=>res.end(html));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 const first=page.locator('#experience-1'),second=page.locator('#experience-2');
 await first.getByRole('button',{name:'Reply',exact:true}).waitFor();assert.equal(await page.getByRole('textbox').count(),0);
 for(const width of [320,390,430,768,1280]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:out+'/list-'+width+'.png',fullPage:true});}
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'Positive',exact:true}).click();assert.equal(await page.locator('article').count(),2);
 await page.getByRole('checkbox',{name:'Verified visits only'}).check();assert.equal(await page.locator('article').count(),1);
 await page.getByRole('button',{name:'Concerns',exact:true}).click();assert.equal(await page.locator('article').count(),1);await page.getByText('Please help with my visit.').waitFor();
 await page.getByRole('checkbox').uncheck();await page.getByRole('button',{name:'All',exact:true}).click();
 await first.getByRole('button',{name:'Reply',exact:true}).click();assert.equal(await first.getByRole('button',{name:'Send reply',exact:true}).isDisabled(),true);
 await first.getByRole('textbox').fill('Draft retained.');await first.getByRole('button',{name:'Cancel',exact:true}).click();await first.getByRole('button',{name:'Reply',exact:true}).click();assert.equal(await first.getByRole('textbox').inputValue(),'Draft retained.');
 await second.getByRole('button',{name:'Reply',exact:true}).click();assert.equal(await page.getByRole('textbox').count(),1);await second.getByRole('textbox').fill('Legacy draft.');
 await first.getByRole('button',{name:'Reply',exact:true}).click();assert.equal(await first.getByRole('textbox').inputValue(),'Draft retained.');
 await page.screenshot({path:out+'/reply-390.png',fullPage:true});
 await page.evaluate(()=>window.fail=true);await first.getByRole('button',{name:'Send reply',exact:true}).click();await first.getByText('Please try again.').waitFor();assert.equal(await first.getByRole('textbox').inputValue(),'Draft retained.');
 await page.evaluate(()=>window.fail=false);await first.getByRole('button',{name:'Send reply',exact:true}).click();await first.getByRole('textbox').waitFor({state:'hidden'});assert.equal(await first.getByRole('button',{name:'Reply',exact:true}).count(),0);
 const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,2);assert.equal(calls[0].args.requestId,calls[1].args.requestId);assert.equal(calls[0].args.experienceId,'1');
 await second.getByRole('button',{name:'Reply',exact:true}).click();assert.equal(await second.getByRole('textbox').inputValue(),'Legacy draft.');await second.getByRole('button',{name:'Send reply',exact:true}).click();await second.getByText('Reply posted.').waitFor();assert.equal(await second.getByRole('button',{name:'Send reply',exact:true}).count(),0);
 await second.locator('summary').click();await second.getByRole('button',{name:'Report',exact:true}).click();assert.equal(await page.evaluate(()=>window.reports),1);assert.deepEqual(errors,[]);
 fs.writeFileSync(out+'/results.json',JSON.stringify({passed:true,widths:[320,390,430,768,1280],checks:['combined sentiment and verification filters','collapsed by default','one composer open','cancel and cross-card draft retention','empty send disabled','failed reply retains draft and idempotency key','verified and legacy dispatch targets','report available in options'],limits:'Actual extracted source components, isolated actions and moderation boundary. Not authenticated app or physical device evidence.'},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
});

import React from 'react';
import {createRoot} from 'react-dom/client';
import {ReportCaseView, type ReportCaseData} from '../../app/(app)/admin/reports/report-case-view';
import type {ExactTextModerationState, ExactTextVisibilityInput, ExactTextVisibilityResult} from '../../types/admin-exact-text-moderation';

const id=(n:number)=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const makeState=():ExactTextModerationState=>({status:'available',availabilityVerified:true,kind:'comment',contentId:id(3),parentId:id(4),salonId:id(5),body:'Synthetic reported comment for UI verification.',evidenceVersion:'version-one-not-for-display',revision:0,moderationStatus:'visible',canHide:true,canRestore:false,heldByThisCase:false,otherHoldCount:0,blockedReason:null,history:[]});
type Options={state?:ExactTextModerationState|null;reportId?:string;membershipId?:string;permissions?:string[];social?:boolean};
type Fixture={
 state:ExactTextModerationState;loadState:ExactTextModerationState|null;mode:'success'|'unknown'|'throw'|'stale'|'permission'|'deferred';
 calls:ExactTextVisibilityInput[];loads:string[];caseCalls:Record<string,string>[];refreshes:number;resolveDecision:(()=>void)|null;deferLoad:boolean;resolveLoad:(()=>void)|null;
 render:(options?:Options)=>void;perform:(input:ExactTextVisibilityInput)=>Promise<ExactTextVisibilityResult>;load:(id:string)=>Promise<ExactTextModerationState>;
};
declare global {interface Window {exactTextFixture:Fixture}}
const root=createRoot(document.getElementById('root')!);
const fixture:Fixture={state:makeState(),loadState:null,mode:'success',calls:[],loads:[],caseCalls:[],refreshes:0,resolveDecision:null,deferLoad:false,resolveLoad:null,
 render(options={}){
  if(options.state)fixture.state=options.state;
  const reportId=options.reportId??id(1),social=options.social!==false;
  const data:ReportCaseData={detail:{assignee:null,notes:[],reporter:{id:id(2),display_name:'Synthetic customer',status:'active'},subject:null,timeline:[],report:{id:reportId,report_number:'CASE-DEMO',category:social?'review_dispute':'booking',priority:'normal',status:'under_review',summary:'Synthetic report',description:'Please review this reported content.',source:'user_support',social_content_report:social,reporter_user_id:id(2),subject_user_id:null,subject_organization_id:null,subject_location_id:null,assigned_membership_id:null,resolution:null,created_by_user_id:id(2),resolved_by_user_id:null,closed_by_user_id:null,created_at:'2026-11-18T12:00:00Z',updated_at:'2026-11-18T12:00:00Z',resolved_at:null,closed_at:null}},preview:null,conversation:null,post:null,errors:[],socialContent:social?{status:'available',kind:'comment',contentId:id(3),parentId:id(4),salonId:id(5),body:'Previously recorded synthetic text.'}:null,exactTextModeration:options.state===null?null:fixture.state};
  root.render(<ReportCaseView data={data} permissions={options.permissions??['admin.reports.read','admin.reports.update','admin.reports.resolve']} assignees={[]} membershipId={options.membershipId??id(10)} roleSlug="moderator"/>);
 },
 async perform(input){
  fixture.calls.push(JSON.parse(JSON.stringify(input)) as ExactTextVisibilityInput);
  if(fixture.mode==='throw')throw Error('Synthetic lost response');
  if(fixture.mode==='unknown')return{ok:false,code:'unknown',message:'Unconfirmed'};
  if(fixture.mode==='stale')return{ok:false,code:'stale',message:'The content changed. Refresh before deciding.',state:{...fixture.state,evidenceVersion:'version-two-not-for-display',revision:1}};
  if(fixture.mode==='permission')return{ok:false,code:'permission',message:'Your role can no longer record content decisions.'};
  if(fixture.mode==='deferred')await new Promise<void>(resolve=>{fixture.resolveDecision=resolve;});
  const hidden=input.action==='hide'||(fixture.state.otherHoldCount??0)>0;
  fixture.state={...fixture.state,revision:fixture.state.revision+1,evidenceVersion:`version-${fixture.state.revision+1}-not-for-display`,moderationStatus:hidden?'hidden':'visible',heldByThisCase:input.action==='hide',canHide:input.action==='restore',canRestore:input.action==='hide',history:[...fixture.state.history,{id:id(100+fixture.state.revision),action:input.action,reason:input.reason,actorName:'Synthetic reviewer',createdAt:'2026-11-18T13:00:00Z',revision:fixture.state.revision+1}]};
  return{ok:true,state:fixture.state};
 },
 async load(reportId){fixture.loads.push(reportId);const response=fixture.loadState??fixture.state;if(fixture.deferLoad)await new Promise<void>(resolve=>{fixture.resolveLoad=resolve;});return response;},
};
window.exactTextFixture=fixture;
fixture.render();

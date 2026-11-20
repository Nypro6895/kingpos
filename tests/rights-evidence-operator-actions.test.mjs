import test from 'node:test';import assert from 'node:assert/strict';import{build}from'esbuild';
const CASE='84000000-0000-4000-8000-000000000001',OBJECT='84000000-0000-4000-8000-000000000002',EVIDENCE='84000000-0000-4000-8000-000000000003',REQUEST='84000000-0000-4000-8000-000000000004';
async function bundle(entry,mocks={}){const b=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'no-real-auth-or-signing',setup(b){b.onResolve({filter:/.*/},a=>a.path==='server-only'||Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]??'',loader:'ts',resolveDir:process.cwd()}));}}]});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const authMock={'@/lib/supabase/server':`export async function createAuthenticatedSupabaseServerClient(){globalThis.__rightsAction.constructions++;return globalThis.__rightsAction.client;}`};
const helpers=await bundle('lib/platform-admin/rights-evidence.ts',authMock),actions=await bundle('app/(app)/admin/post-safety/rights-evidence-actions.ts',authMock);
function state(change={}){return{id:EVIDENCE,caseId:CASE,status:'evidence_ready',version:'a'.repeat(64),captured:true,originRemoved:false,safetyClassification:'ordinary',retainUntil:null,hasLegalHold:false,legalHoldReviewAt:null,canRequestRemoval:true,removalBlockedReason:null,...change};}
function workspace(change={}){return{caseId:CASE,policyEnabled:true,canCapture:false,blockedReason:null,photos:[{objectId:OBJECT,evidenceId:EVIDENCE,state:state()}],...change};}
function fixture({data=workspace(),error=null,origin={ok:true,state:state()},identity=state(),throwTransport=false}={}){const f={constructions:0,calls:[],client:{async rpc(name,args){f.calls.push({name,args});if(throwTransport)throw Error('PRIVATE upstream path/key');if(error)return{data:null,error:{code:error,message:'PRIVATE upstream path/key'}};return{error:null,data:name==='get_admin_rights_case_evidence'?data:name==='get_admin_rights_image_evidence_state'?identity:name==='request_rights_origin_removal'?origin:{id:EVIDENCE,status:'capture_queued'}};}}};globalThis.__rightsAction=f;return f;}
const capture={caseId:CASE,objectId:OBJECT,requestId:REQUEST,reason:'Ordinary rights case reviewed.',ordinaryConfirmed:true};
const removal={caseId:CASE,evidenceId:EVIDENCE,requestId:REQUEST,expectedVersion:'a'.repeat(64),reason:'Remove original after reviewed claim.'};

test('case DTO validates IDs/state coherence and strips unexpected private metadata before client serialization',()=>{
 const parsed=helpers.parseRightsCaseEvidence(workspace({rawPath:'PRIVATE',photos:[{objectId:OBJECT,evidenceId:EVIDENCE,state:{...state(),secret:'PRIVATE'},sourcePath:'PRIVATE'}]}),CASE);assert(parsed);assert(!JSON.stringify(parsed).includes('PRIVATE'));
 for(const value of [null,workspace({caseId:OBJECT}),workspace({photos:[{objectId:OBJECT,evidenceId:EVIDENCE,state:{id:EVIDENCE,canRequestRemoval:false}}]}),workspace({photos:[{objectId:OBJECT,evidenceId:EVIDENCE,state:state({caseId:OBJECT})}]}),workspace({photos:[{objectId:OBJECT,evidenceId:null,state:state()}]}),workspace({policyEnabled:false,canCapture:true}),workspace({photos:[{objectId:OBJECT,evidenceId:EVIDENCE,state:state({version:'invalid'})}]})])assert.equal(helpers.parseRightsCaseEvidence(value,CASE),null);
 assert(helpers.parseRightsCaseEvidence(workspace({photos:[{objectId:OBJECT,evidenceId:EVIDENCE,state:null}]}),CASE),'contended status stays null/read-only');
});

test('capture requires literal affirmative ordinary triage/reason before auth and sends only canonical IDs with removal false',async()=>{
 try{const f=fixture();for(const input of [{...capture,ordinaryConfirmed:false},{...capture,ordinaryConfirmed:undefined},{...capture,reason:' '},{...capture,objectId:'invalid'}])assert.equal((await actions.captureRightsEvidenceAction(input)).ok,false);assert.equal(f.constructions,0);
  const result=await actions.captureRightsEvidenceAction(capture);assert.equal(result.ok,true);assert.deepEqual(f.calls.map(c=>c.name),['request_rights_image_evidence','get_admin_rights_case_evidence']);assert.deepEqual(f.calls[0].args,{p_case_id:CASE,p_object_id:OBJECT,p_request_id:REQUEST,p_safety_classification:'ordinary',p_reason:capture.reason,p_remove_origin:false});
 }finally{delete globalThis.__rightsAction;}
});

test('origin identity is case-bound; SQL receives the frozen UUID/version/reason before current mutable admission',async()=>{
 try{const denied=fixture({identity:state({caseId:OBJECT})});assert.equal((await actions.requestRightsOriginRemovalAction(removal)).code,'permission');assert.equal(denied.calls.length,1);
  const f=fixture({identity:state({canRequestRemoval:false,removalBlockedReason:'already_requested',version:'b'.repeat(64)})});const result=await actions.requestRightsOriginRemovalAction(removal);assert.equal(result.ok,true);assert.deepEqual(f.calls.map(c=>c.name),['get_admin_rights_image_evidence_state','request_rights_origin_removal','get_admin_rights_case_evidence']);assert.equal(f.calls[1].args.p_expected_version,removal.expectedVersion);assert.equal(f.calls[1].args.p_request_id,REQUEST);
 }finally{delete globalThis.__rightsAction;}
});

test('uncertain/malformed/lost readbacks remain unknown, typed stale/permission errors remain bounded and leak no upstream details',async()=>{
 try{
  for(const config of [{throwTransport:true},{error:'502'},{data:null}]){fixture(config);const r=await actions.captureRightsEvidenceAction(capture);assert.equal(r.code,'unknown');assert(!JSON.stringify(r).includes('PRIVATE'));}
  fixture({error:'42501'});assert.equal((await actions.captureRightsEvidenceAction(capture)).code,'permission');
  fixture({origin:{ok:false,code:'stale',state:state()}});assert.equal((await actions.requestRightsOriginRemovalAction(removal)).code,'stale');
  fixture({origin:{ok:false,code:'unexpected'}});assert.equal((await actions.requestRightsOriginRemovalAction(removal)).code,'unknown');
 }finally{delete globalThis.__rightsAction;}
});

test('known minor-safety cases never generate privileged Storage signed URLs in either existing loader',async()=>{
 const signed=[],item={id:CASE,reason:'minor_safety',platform_report_id:null,media:[{bucket:'beauty-profile-media',path:'synthetic-public-photo',url:'OLD-URL'}]};
 const loader=await bundle('lib/platform-admin/post-safety.ts',{'@/lib/platform-admin/rpc':`export const callPlatformAdminRpc=(name,args)=>globalThis.__minorTransport(name,args);`,'@/lib/abuse-server':`export const abuseServiceClient=()=>({storage:{from:bucket=>({createSignedUrl:async path=>{globalThis.__minorSigned.push({bucket,path});return{data:{signedUrl:'SYNTHETIC'},error:null};}})}});`});
 globalThis.__minorSigned=signed;globalThis.__minorTransport=async name=>name==='get_admin_post_safety_cases'?[item]:name==='get_admin_post_review_workspace'?{cases:[item]}:{};
 try{assert.equal((await loader.loadAdminPostSafetyCases())[0].media[0].url,null);assert.equal((await loader.loadAdminPostReviewWorkspace()).cases[0].media[0].url,null);assert.deepEqual(signed,[]);item.reason='intellectual_property';assert.equal((await loader.loadAdminPostSafetyCases())[0].media[0].url,'SYNTHETIC');assert.equal(signed.length,1,'ordinary existing moderation path preserved');}finally{delete globalThis.__minorSigned;delete globalThis.__minorTransport;}
});

const recovery=await bundle('lib/rights-evidence-intent.ts');
function store(){const data=new Map();return{get length(){return data.size;},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};}
test('pending intent is actor/case/source bound, immutable across retry, TTL-limited and compare-cleared by exact UUID',()=>{
 const s=store(),intent={kind:'capture',objectId:OBJECT,input:capture},now=1000000;
 const first=recovery.saveRightsEvidenceIntent(s,REQUEST,CASE,intent,now);assert.equal(first.expiresAt-now,1800000);assert.deepEqual(recovery.readRightsEvidenceIntent(s,REQUEST,CASE,now).value.attempt,intent);assert.equal(recovery.readRightsEvidenceIntent(s,OBJECT,CASE,now).status,'none');
 assert.equal(recovery.saveRightsEvidenceIntent(s,REQUEST,CASE,intent,now+1000).expiresAt,first.expiresAt,'retry does not extend TTL');assert.throws(()=>recovery.saveRightsEvidenceIntent(s,REQUEST,CASE,{...intent,input:{...capture,reason:'Changed reason'}},now+1000));
 assert.equal(recovery.clearRightsEvidenceIntent(s,REQUEST,CASE,OBJECT),false);assert.equal(s.length,1);assert.equal(recovery.clearRightsEvidenceIntent(s,REQUEST,CASE,REQUEST),true);
 recovery.saveRightsEvidenceIntent(s,REQUEST,CASE,intent,now);assert.equal(recovery.readRightsEvidenceIntent(s,REQUEST,CASE,now+1800000).status,'expired');assert.equal(s.length,0);
});
test('pending recovery refuses paths/extra fields, unavailable storage and eviction of a fifth active case',()=>{
 const s=store(),intent={kind:'capture',objectId:OBJECT,input:capture};assert.throws(()=>recovery.saveRightsEvidenceIntent(s,REQUEST,CASE,{...intent,privateUrl:'PRIVATE'}));
 const broken={...s,setItem(){throw Error('private quota detail');}};assert.throws(()=>recovery.saveRightsEvidenceIntent(broken,REQUEST,CASE,intent),{message:'Recovery storage is unavailable. No new request was sent.'});
 for(let n=1;n<=4;n++){const c=`85000000-0000-4000-8000-${String(n).padStart(12,'0')}`;recovery.saveRightsEvidenceIntent(s,REQUEST,c,{...intent,input:{...capture,caseId:c}},1000000);}
 assert.throws(()=>recovery.saveRightsEvidenceIntent(s,REQUEST,CASE,intent,1000000));assert.equal(s.length,4,'active receipts never evicted to make a new decision');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {createClient} from '@supabase/supabase-js';

const built=await build({entryPoints:['lib/rights-evidence-worker.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'no-live-environment',setup(b){b.onResolve({filter:/^server-only$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:''}));}}]});
const worker=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const USER='82000000-0000-4000-8000-000000000001',ID='82000000-0000-4000-8000-000000000002',CASE='82000000-0000-4000-8000-000000000003',OBJECT='82000000-0000-4000-8000-000000000004',LEASE='82000000-0000-4000-8000-000000000005';
const NOW=Date.parse('2026-11-19T04:30:00Z'),bytes=Buffer.from('Synthetic exact published WebP fixture bytes'),sha256=createHash('sha256').update(bytes).digest('hex');
const blob=(body=bytes)=>new Blob([body],{type:'image/webp'});
function job(stage='capture',changes={}){return{id:ID,case_id:CASE,stage,source_bucket:'beauty-profile-media',source_path:`${USER}/beauty/image/${ID}.webp`,source_object_id:OBJECT,source_version:'source-v1',source_etag:'source-etag',sha256,bytes:bytes.length,mime:'image/webp',evidence_bucket:'rights-review-evidence',evidence_path:`v1/${CASE}/${ID}.webp`,private_object_id:stage==='capture'?null:OBJECT,private_version:stage==='capture'?null:'private-v1',private_etag:stage==='capture'?null:'private-etag',lease_token:LEASE,leased_until:new Date(NOW+300000).toISOString(),retain_until:stage==='purge'?new Date(NOW-1).toISOString():null,...changes};}
function client({items=[],gate=true,privateBlob=blob(),sourceBlob=blob(),upload='success',remove='success',finish=true,onCall}={}){
 const calls=[];
 const record=call=>{calls.push(call);onCall?.(call);};
 return{calls,storage:{from(bucket){return{
  async download(key){record({op:'download',bucket,key});return{data:bucket==='rights-review-evidence'?privateBlob:sourceBlob,error:null};},
  async upload(key,data,options){record({op:'upload',bucket,key,bytes:Buffer.from(data),options});if(upload==='throw')throw Error('private upstream detail');return{data:null,error:upload==='error'?{message:'unknown duplicate detail'}:null};},
  async remove(keys){record({op:'remove',bucket,keys});if(remove==='throw')throw Error('private remove detail');return{data:[],error:remove==='error'?{message:'private upstream detail'}:null};},
 };}},async rpc(name,args){record({op:'rpc',name,args});
  if(name==='claim_rights_image_evidence')return{data:items,error:null};
  if(name==='revalidate_rights_image_evidence')return{data:typeof gate==='function'?gate(calls):gate,error:null};
  if(name==='fail_rights_image_evidence')return{data:true,error:null};
  return{data:finish,error:null};
 }};
}
const storageCalls=c=>c.calls.filter(x=>x.op!=='rpc');

test('policy/operator/risk deny, malformed pins and wrong scopes stop before every Storage operation',async t=>{
 t.mock.method(Date,'now',()=>NOW);
 for(const stage of ['capture','remove_origin','purge']){const c=client({gate:false});assert.equal(await worker.processRightsImageEvidence(c,job(stage),stage,NOW+45000),'blocked');assert.deepEqual(storageCalls(c),[]);}
 for(const bad of [null,{},job('capture',{source_bucket:'tax-documents'}),job('capture',{source_path:`${USER}/beauty/avatar/${ID}.webp`}),job('capture',{evidence_path:`v1/${USER}/${ID}.webp`}),job('capture',{bytes:512001}),job('capture',{mime:'image/jpeg'}),job('capture',{source_version:null}),job('capture',{private_version:'partial'}),job('capture',{leased_until:new Date(NOW).toISOString()}),job('capture',{retain_until:new Date(NOW-1).toISOString()})]){
  const c=client();assert.equal(await worker.processRightsImageEvidence(c,bad,'capture',NOW+45000),'failed');assert.deepEqual(c.calls,[]);
 }
 for(const patch of [{private_object_id:null},{private_version:null},{private_etag:null},{retain_until:null},{retain_until:new Date(NOW+1).toISOString()}]){const c=client();assert.equal(await worker.processRightsImageEvidence(c,job('purge',patch),'purge',NOW+45000),'failed');assert.deepEqual(c.calls,[]);}
});

test('capture copies exact bytes immutably, reads back full private bytes, then checkpoints; never deletes source',async t=>{
 t.mock.method(Date,'now',()=>NOW);const c=client(),j=job();assert.equal(await worker.processRightsImageEvidence(c,j,'capture',NOW+45000),'captured');
 assert.deepEqual(c.calls.map(x=>x.name??x.op),['revalidate_rights_image_evidence','download','revalidate_rights_image_evidence','upload','revalidate_rights_image_evidence','download','finish_rights_image_evidence_capture']);
 const upload=c.calls.find(x=>x.op==='upload');assert.deepEqual(upload.bytes,bytes);assert.equal(upload.bucket,'rights-review-evidence');assert.equal(upload.key,j.evidence_path);assert.deepEqual(upload.options,{contentType:'image/webp',upsert:false,cacheControl:'0',metadata:{sha256}});assert.equal(c.calls.some(x=>x.op==='remove'),false);
});

test('source/private corruption cannot checkpoint or remove, while ambiguous upload needs an actual matching private readback',async t=>{
 t.mock.method(Date,'now',()=>NOW);
 for(const [changes,error] of [[{sourceBlob:blob(Buffer.from('wrong'))},'source_mismatch'],[{privateBlob:blob(Buffer.from('wrong'))},'private_mismatch']]){
  const c=client(changes);assert.equal(await worker.processRightsImageEvidence(c,job(),'capture',NOW+45000),'failed');assert.equal(c.calls.at(-1).args.p_error,error);assert(!c.calls.some(x=>x.name?.startsWith('finish_')||x.op==='remove'));
 }
 for(const upload of ['error','throw']){const c=client({upload});assert.equal(await worker.processRightsImageEvidence(c,job(),'capture',NOW+45000),'captured');assert.equal(c.calls.filter(x=>x.op==='download').length,2);}
 const lost=client({finish:false});assert.equal(await worker.processRightsImageEvidence(lost,job(),'capture',NOW+45000),'failed');assert(!lost.calls.some(x=>x.op==='remove'));
});

test('transient source/private Storage failures remain retryable rather than permanent byte-conflict classifications',async t=>{
 t.mock.method(Date,'now',()=>NOW);
 for(const [stage,changes]of [['capture',{sourceBlob:null}],['capture',{privateBlob:null}],['remove_origin',{privateBlob:null}]]){
  const c=client(changes);assert.equal(await worker.processRightsImageEvidence(c,job(stage),stage,NOW+45000),'failed');assert.equal(c.calls.at(-1).name,'fail_rights_image_evidence');assert.equal(c.calls.at(-1).args.p_error,'storage_failed');assert(!c.calls.some(x=>x.op==='remove'||x.name?.startsWith('finish_')));
 }
});

test('origin removal first verifies private complete bytes and revalidates again; copy alone never means removal',async t=>{
 t.mock.method(Date,'now',()=>NOW);const j=job('remove_origin'),c=client();assert.equal(await worker.processRightsImageEvidence(c,j,'remove_origin',NOW+45000),'removed');
 assert.deepEqual(c.calls.map(x=>x.name??x.op),['revalidate_rights_image_evidence','download','revalidate_rights_image_evidence','remove','finish_rights_image_evidence_removal']);assert.deepEqual(c.calls.find(x=>x.op==='remove'),{op:'remove',bucket:j.source_bucket,keys:[j.source_path]});
 const corrupt=client({privateBlob:blob(Buffer.from('wrong'))});assert.equal(await worker.processRightsImageEvidence(corrupt,j,'remove_origin',NOW+45000),'failed');assert(!corrupt.calls.some(x=>x.op==='remove'));
 let n=0;const revoked=client({gate:()=>++n===1});assert.equal(await worker.processRightsImageEvidence(revoked,j,'remove_origin',NOW+45000),'blocked');assert(!revoked.calls.some(x=>x.op==='remove'));
 for(const remove of ['error','throw']){const failed=client({remove});assert.equal(await worker.processRightsImageEvidence(failed,j,'remove_origin',NOW+45000),'failed');assert.equal(failed.calls.at(-1).args.p_error,'storage_failed');assert(!failed.calls.some(x=>x.name==='finish_rights_image_evidence_removal'));}
 const lost=client({finish:false});assert.equal(await worker.processRightsImageEvidence(lost,j,'remove_origin',NOW+45000),'failed');
});

test('expiry purges only the exact pinned private key; open/null retention and future dates never purge',async t=>{
 t.mock.method(Date,'now',()=>NOW);const j=job('purge'),c=client();assert.equal(await worker.processRightsImageEvidence(c,j,'purge',NOW+45000),'purged');
 assert.deepEqual(storageCalls(c),[{op:'remove',bucket:'rights-review-evidence',keys:[j.evidence_path]}]);assert.equal(c.calls.at(-1).name,'finish_rights_image_evidence_purge');
});

test('request margin/deadline is checked again after metadata RPC and between every byte operation',async t=>{
 let now=NOW;t.mock.method(Date,'now',()=>now);
 const c=client({onCall:call=>{if(call.name==='revalidate_rights_image_evidence')now+=46000;}});assert.equal(await worker.processRightsImageEvidence(c,job(),'capture',NOW+45000),'blocked');assert.deepEqual(storageCalls(c),[]);
 now=NOW;const short=client();assert.equal(await worker.processRightsImageEvidence(short,job('capture',{leased_until:new Date(NOW+12000).toISOString()}),'capture',NOW+45000),'deferred');assert.deepEqual(short.calls,[]);
 now=NOW;const partial=client({onCall:call=>{if(call.op==='download')now+=46000;}});assert.equal(await worker.processRightsImageEvidence(partial,job(),'capture',NOW+45000),'deferred');assert.equal(storageCalls(partial).length,1);assert(!partial.calls.some(x=>x.name?.startsWith('finish_')));
});

test('one explicit stage per pass returns only aggregate counts; malformed claim never becomes success',async t=>{
 t.mock.method(Date,'now',()=>NOW);const c=client({items:[job()]});assert.deepEqual(await worker.runRightsImageEvidence('capture',c),{claimed:1,captured:1,removed:0,purged:0,failed:0,deferred:0,blocked:0});assert.deepEqual(c.calls[0].args,{p_stage:'capture',p_limit:1});
 const empty=client({items:[]});assert.equal((await worker.runRightsImageEvidence('capture',empty)).claimed,0);assert.deepEqual(storageCalls(empty),[]);
 await assert.rejects(worker.runRightsImageEvidence('capture',client({items:[job(),job()]})),{message:'Private evidence work could not be read.'});
});

test('actual Supabase SDK with injected fetch uses exact read/upload/read/checkpoint operations and no live network',async t=>{
 t.mock.method(Date,'now',()=>NOW);const requests=[];const j=job();
 const sdk=createClient('https://rights-fixture.supabase.co','fixture-only-not-a-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  const url=new URL(input);requests.push({method:init.method,path:url.pathname,body:init.body});
  if(url.pathname.endsWith('/revalidate_rights_image_evidence')||url.pathname.endsWith('/finish_rights_image_evidence_capture'))return Response.json(true);
  if(init.method==='GET')return new Response(bytes,{headers:{'Content-Type':'image/webp'}});
  if(init.method==='POST'&&url.pathname.startsWith('/storage/'))return Response.json({Key:j.evidence_path,Id:OBJECT});
  throw Error('Unexpected synthetic operation');
 }}});
 assert.equal(await worker.processRightsImageEvidence(sdk,j,'capture',NOW+45000),'captured');assert.equal(requests.length,7);assert.equal(requests.filter(r=>r.method==='DELETE').length,0);assert(requests.every(r=>!r.path.includes('sign')));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';

async function isolatedBundle(entry,mocks={}){
 const result=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'isolated-rights-boundaries',setup(b){b.onResolve({filter:/.*/},a=>a.path==='server-only'||Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'fixture'}:null);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path]??'',loader:'ts',resolveDir:process.cwd()}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const helpers=await isolatedBundle('lib/rights-evidence-storage.ts');
const USER='81000000-0000-4000-8000-000000000001',SALON='81000000-0000-4000-8000-000000000002',ID='81000000-0000-4000-8000-000000000003';

test('evidence path/identity bounds accept only canonical normalized own Beauty/Salon post assets',()=>{
 for(const purpose of ['image','before','after'])assert.equal(helpers.isRightsEvidencePublicPath('beauty-profile-media',`${USER}/beauty/${purpose}/${ID}.webp`,USER,null),true);
 for(const tail of [`looks/${USER}/${ID}.webp`,`updates/${ID}.webp`])assert.equal(helpers.isRightsEvidencePublicPath('salon-profile-media',`${SALON}/${tail}`,USER,SALON),true);
 for(const args of [
  ['tax-documents',`${USER}/beauty/image/${ID}.webp`,USER,null],
  ['beauty-profile-media',`${SALON}/beauty/image/${ID}.webp`,USER,null],
  ['beauty-profile-media',`${USER}/beauty/avatar/${ID}.webp`,USER,null],
  ['beauty-profile-media',`${USER}/beauty/image/${ID}.jpg`,USER,null],
  ['beauty-profile-media',`${USER}/beauty/image/../${ID}.webp`,USER,null],
  ['beauty-profile-media',`${USER}/beauty/image%2F${ID}.webp`,USER,null],
  ['salon-profile-media',`${SALON}/updates/${ID}.webp`,USER,USER],
  ['salon-profile-media',`${SALON}/cover/${ID}.webp`,USER,SALON],
 ])assert.equal(helpers.isRightsEvidencePublicPath(...args),false);
 for(const n of [0,-1,512001,NaN,Infinity,'100',1.5])assert.equal(helpers.isRightsEvidenceBytes(n),false);
 for(const v of ['',null,'\nversion','v'.repeat(1025)])assert.equal(helpers.isRightsEvidenceVersion(v),false);
});

test('complete private/source bytes must match expected size, image MIME and exact SHA before release',async()=>{
 const bytes=Buffer.from('synthetic fixture bytes'),hash=createHash('sha256').update(bytes).digest('hex');
 assert.deepEqual(await helpers.verifiedRightsEvidenceBytes(new Blob([bytes],{type:'image/webp'}),bytes.length,hash),bytes);
 for(const args of [
  [new Blob([bytes],{type:'text/html'}),bytes.length,hash],
  [new Blob([bytes],{type:'image/webp'}),bytes.length+1,hash],
  [new Blob([bytes],{type:'image/webp'}),bytes.length,'0'.repeat(64)],
  [new Blob([bytes],{type:'image/webp'}),bytes.length,hash.toUpperCase()],
 ])await assert.rejects(helpers.verifiedRightsEvidenceBytes(...args),{message:'Private evidence storage is temporarily unavailable.'});
 let read=false;class LargeBlob extends Blob{async arrayBuffer(){read=true;throw Error('must not read');}}
 await assert.rejects(helpers.verifiedRightsEvidenceBytes(new LargeBlob([new Uint8Array(512001)],{type:'image/webp'}),512001,hash));assert.equal(read,false);
});

test('only one satisfiable bounded byte range is accepted, including suffix and open-ended forms',()=>{
 for(const [header,expected] of [[null,{start:0,end:99}],['bytes=0-9',{start:0,end:9}],['bytes=90-',{start:90,end:99}],['bytes=-7',{start:93,end:99}],['bytes=-1000',{start:0,end:99}],['bytes=90-1000',{start:90,end:99}]])assert.deepEqual(helpers.rightsEvidenceRange(header,100),expected);
 for(const header of ['bytes=0-1,3-4','bytes=-0','bytes=-','bytes=100-','bytes=10-9','bytes=0-9007199254740992','items=0-1','bytes=0-1\n','bytes='+ '9'.repeat(101)+'-'])assert.equal(helpers.rightsEvidenceRange(header,100),null);
});

test('bounded service transport never forwards credentials to another origin/path or permits upsert/prefix deletion',async()=>{
 const origin='https://rights-fixture.supabase.co',key=`v1/${USER}/${ID}.webp`,publicKey=`${USER}/beauty/image/${ID}.webp`,calls=[];
 const bounded=helpers.createRightsEvidenceFetch(origin,async(input,init)=>{calls.push({url:String(input),init});return new Response('fixture',{headers:{'Content-Type':'image/webp'}});});
 await bounded(`${origin}/storage/v1/object/authenticated/rights-review-evidence/${key}`,{method:'GET',headers:{Authorization:'Bearer fixture-only'}});
 assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.cache,'no-store');assert.equal(calls[0].init.referrerPolicy,'no-referrer');assert(calls[0].init.signal instanceof AbortSignal);
 const bad=[
  ['https://other.test/storage/v1/object/authenticated/rights-review-evidence/'+key,{method:'GET'}],
  [origin+'/storage/v1/object/authenticated/tax-documents/'+publicKey,{method:'GET'}],
  [origin+'/storage/v1/object/sign/rights-review-evidence/'+key,{method:'POST'}],
  [origin+'/rest/v1/rpc/erase_account',{method:'POST'}],
  [origin+'/storage/v1/object/rights-review-evidence/'+key,{method:'POST',body:Buffer.from('image'),headers:{'Content-Type':'image/webp','x-upsert':'true'}}],
  [origin+'/storage/v1/object/beauty-profile-media',{method:'DELETE',body:JSON.stringify({prefixes:[publicKey,publicKey]})}],
  [origin+'/storage/v1/object/rights-review-evidence',{method:'DELETE',body:JSON.stringify({prefixes:['v1/../something.webp']})}],
 ];
 for(const [url,init]of bad)await assert.rejects(bounded(url,init),{message:'Private evidence storage is temporarily unavailable.'});
 assert.equal(calls.length,1);
});

test('bounded service transport rejects oversized headers/body, redirects and timeout before SDK receives a Blob',async()=>{
 const origin='https://rights-fixture.supabase.co',url=origin+`/storage/v1/object/authenticated/rights-review-evidence/v1/${USER}/${ID}.webp`;
 for(const response of [new Response('x',{headers:{'Content-Length':'512001'}}),new Response('x',{headers:{'Content-Length':'invalid'}}),new Response(new Uint8Array(512001))]){
  const fetcher=helpers.createRightsEvidenceFetch(origin,async()=>response);await assert.rejects(fetcher(url),{message:'Private evidence storage is temporarily unavailable.'});
 }
 const redirect=new Response('x');Object.defineProperty(redirect,'redirected',{value:true});await assert.rejects(helpers.createRightsEvidenceFetch(origin,async()=>redirect)(url));
 let cancelled=false;const stream=new ReadableStream({cancel(){cancelled=true;}});
 await assert.rejects(helpers.createRightsEvidenceFetch(origin,async()=>new Response(stream),5)(url),{message:'Private evidence storage is temporarily unavailable.'});assert.equal(cancelled,true);
});

test('actual bounded service SDK factory accepts only the intended immutable operations with injected transport',async()=>{
 const calls=[],path=`v1/${USER}/${ID}.webp`,bytes=Buffer.from('synthetic copy');
 const sdk=helpers.rightsEvidenceServiceClient({url:'https://rights-fixture.supabase.co',serviceKey:'fixture-only-not-a-key',fetchImpl:async(input,init)=>{
  const url=new URL(input);calls.push({method:init.method,path:url.pathname,body:init.body});
  if(url.pathname.startsWith('/rest/v1/rpc/'))return Response.json(true);
  if(init.method==='GET')return new Response(bytes,{headers:{'Content-Type':'image/webp'}});
  return Response.json(init.method==='DELETE'?[]:{Key:path,Id:ID});
 }});
 assert.equal((await sdk.rpc('revalidate_rights_image_evidence',{p_id:ID,p_lease:USER})).data,true);
 assert.equal((await sdk.storage.from('rights-review-evidence').upload(path,bytes,{contentType:'image/webp',upsert:false})).error,null);
 assert.deepEqual(Buffer.from(await(await sdk.storage.from('rights-review-evidence').download(path)).data.arrayBuffer()),bytes);
 assert.equal((await sdk.storage.from('rights-review-evidence').remove([path])).error,null);
 assert.equal(calls.length,4);
 assert((await sdk.storage.from('rights-review-evidence').createSignedUrl(path,60)).error);assert((await sdk.storage.from('tax-documents').download('private')).error);assert.equal(calls.length,4,'signing/private financial paths stop before injected transport');
});

const access=await isolatedBundle('lib/rights-evidence-access.ts',{'@/lib/supabase/server':`export async function createAuthenticatedSupabaseServerClient(){throw Error('Real cookie/auth construction forbidden in isolated tests');}`});
const CONTENT=Buffer.from('Synthetic private evidence bytes'),HASH=createHash('sha256').update(CONTENT).digest('hex');
function grant(changes={}){return{id:ID,case_id:USER,stage:'read',source_bucket:'beauty-profile-media',source_path:`${USER}/beauty/image/${ID}.webp`,source_object_id:SALON,source_version:'source-v1',source_etag:'source-etag',sha256:HASH,bytes:CONTENT.length,mime:'image/webp',evidence_bucket:'rights-review-evidence',evidence_path:`v1/${USER}/${ID}.webp`,private_object_id:SALON,private_version:'private-v1',private_etag:'private-etag',lease_token:null,leased_until:null,retain_until:null,...changes};}
function boundary({grants=[grant(),grant()],body=new Blob([CONTENT],{type:'image/webp'})}={}){const calls=[];return{calls,authenticatedClient:{async rpc(name,args){calls.push({op:'authorize',name,args});return{data:grants[Math.min(calls.filter(x=>x.op==='authorize').length-1,grants.length-1)],error:null};}},serviceClient:{storage:{from(bucket){return{async download(key){calls.push({op:'download',bucket,key});return{data:body,error:null};}};}}}};}
const request=range=>new Request('https://app.test/api/admin/rights-evidence/'+ID,{headers:range?{Range:range}:{}});

test('no grant, policy/minor-safety gate, malformed/expired/private pins stop before Storage and expose no path',async()=>{
 for(const candidate of [null,{},grant({stage:'capture'}),grant({private_version:null}),grant({evidence_path:`v1/${SALON}/${ID}.webp`}),grant({retain_until:'2000-01-01T00:00:00Z'})]){
  const b=boundary({grants:[candidate]});const response=await access.serveRightsImageEvidence(request(),ID,b);assert.equal(response.status,404);assert(!b.calls.some(x=>x.op==='download'));const text=await response.text();assert(!text.includes('v1/')&&!text.includes(HASH));
 }
 const b=boundary();assert.equal((await access.serveRightsImageEvidence(request(),'invalid-id',b)).status,404);assert.deepEqual(b.calls,[]);
 assert.equal((await access.serveRightsImageEvidence(request(),ID,{authenticatedClient:null})).status,404);
});

test('authorized server response verifies full hash, reauthorizes identical pins and returns only no-store bytes',async()=>{
 const b=boundary(),response=await access.serveRightsImageEvidence(request(),ID,b);
 assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),CONTENT);assert.deepEqual(b.calls.map(x=>x.op),['authorize','download','authorize']);
 assert(b.calls.filter(x=>x.op==='authorize').every(x=>x.name==='authorize_rights_image_evidence_read'&&x.args.p_id===ID));
 assert.equal(response.headers.get('Cache-Control'),'private, no-store, max-age=0');assert.equal(response.headers.get('Content-Type'),'image/webp');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');assert.equal(response.headers.get('Cross-Origin-Resource-Policy'),'same-origin');assert.equal(response.headers.get('Location'),null);assert.equal(response.headers.get('ETag'),null);assert(!JSON.stringify([...response.headers]).includes('source-v1'));
});

test('single range is served only after complete-byte verification; unsatisfiable/multiple ranges cause no download',async()=>{
 const b=boundary(),response=await access.serveRightsImageEvidence(request('bytes=2-5'),ID,b);assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),CONTENT.subarray(2,6));assert.equal(response.headers.get('Content-Range'),`bytes 2-5/${CONTENT.length}`);assert.equal(b.calls.filter(x=>x.op==='download').length,1);
 for(const range of ['bytes=999-','bytes=0-1,4-5']){const denied=boundary(),r=await access.serveRightsImageEvidence(request(range),ID,denied);assert.equal(r.status,416);assert(!denied.calls.some(x=>x.op==='download'));}
 const corrupt=boundary({body:new Blob([Buffer.alloc(CONTENT.length)],{type:'image/webp'})});assert.equal((await access.serveRightsImageEvidence(request('bytes=0-1'),ID,corrupt)).status,503);assert.equal(corrupt.calls.filter(x=>x.op==='authorize').length,1);
});

test('revoked role/case, changed pins or expired grant after download cannot release any image bytes',async()=>{
 for(const after of [null,grant({private_version:'changed'}),grant({sha256:'0'.repeat(64)}),grant({retain_until:'2000-01-01T00:00:00Z'})]){
  const b=boundary({grants:[grant(),after]}),r=await access.serveRightsImageEvidence(request(),ID,b);assert.equal(r.status,404);assert.equal(b.calls.filter(x=>x.op==='download').length,1);assert.equal(r.headers.get('Content-Type'),'application/json');assert(!(await r.text()).includes('Synthetic private evidence bytes'));
 }
});

test('actual dynamic GET route forwards only the awaited opaque ID; HEAD performs no evidence work',async()=>{
 globalThis.__rightsRouteCalls=[];
 try{
  const route=await isolatedBundle('app/api/admin/rights-evidence/[evidenceId]/route.ts',{'@/lib/rights-evidence-access':`export async function serveRightsImageEvidence(request,id){globalThis.__rightsRouteCalls.push({id,method:request.method});return new Response('synthetic route');}`});
  assert.equal(await(await route.GET(request(),{params:Promise.resolve({evidenceId:ID})})).text(),'synthetic route');assert.deepEqual(globalThis.__rightsRouteCalls,[{id:ID,method:'GET'}]);assert.equal((await route.HEAD()).status,405);assert.equal(globalThis.__rightsRouteCalls.length,1);
 }finally{delete globalThis.__rightsRouteCalls;}
});

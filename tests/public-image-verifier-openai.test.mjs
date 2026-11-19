import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import sharp from 'sharp';

// This test bundle replaces the env expression before evaluating the source.
// It never reads the machine's OPENAI_API_KEY and every transport is synthetic.
const compiled=await build({entryPoints:['lib/public-image-verifier-openai.ts'],bundle:true,write:false,platform:'node',format:'cjs',packages:'external',
 define:{'process.env.OPENAI_API_KEY':'globalThis.__fixtureOpenAIKey','fetch':'globalThis.__blockedFixtureFetch'},
 plugins:[{name:'server-boundary',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'',loader:'js'}));}}]});
assert.doesNotMatch(compiled.outputFiles[0].text,/process\.env\.OPENAI_API_KEY|require\(["']\.\/public-image-safety/);
globalThis.__blockedFixtureFetch=async()=>assert.fail('Unmocked provider transport is forbidden in this suite.');
after(()=>{delete globalThis.__blockedFixtureFetch;});
const module={exports:{}};
new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {createOpenAIPublicPostVerifier,verifyOpenAIPublicPostImage,OPENAI_PUBLIC_PHOTO_MODEL,OPENAI_PUBLIC_PHOTO_POLICY_VERSION}=module.exports;
const image=await sharp({create:{width:12,height:9,channels:3,background:'#638e91'}}).webp().toBuffer();
const imageCategories=['sexual','self-harm','self-harm/intent','self-harm/instructions','violence','violence/graphic'];
const allCategories=[...imageCategories,'sexual/minors','harassment','harassment/threatening','hate','hate/threatening','illicit','illicit/violent'];
function result(){return {id:'modr-synthetic',model:OPENAI_PUBLIC_PHOTO_MODEL,results:[{flagged:false,
 categories:Object.fromEntries(allCategories.map(c=>[c,false])),category_scores:Object.fromEntries(allCategories.map(c=>[c,0.001])),
 category_applied_input_types:Object.fromEntries(allCategories.map(c=>[c,imageCategories.includes(c)?['image']:[]]))}]};}
const response=(body=result(),headers={})=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json',...headers}});
const generic=e=>e instanceof Error&&e.message==='Photo safety checks are temporarily unavailable. Your draft is kept. Please try again.'&&!e.cause;
function fixture(reply=()=>response()){
 const calls=[];
 const verify=createOpenAIPublicPostVerifier({apiKey:'fixture-placeholder-never-live',fetchImpl:async(...args)=>{calls.push(args);return reply(...args);}});
 return {verify,calls};
}

test('only complete normalized bytes go to the fixed official endpoint; credentials/metadata never enter payload or verdict',async()=>{
 const f=fixture();const verdict=await f.verify(image);assert.equal(f.calls.length,1);
 const [url,request]=f.calls[0];assert.equal(url,'https://api.openai.com/v1/moderations');assert.equal(request.method,'POST');
 assert.equal(request.redirect,'error');assert.equal(request.cache,'no-store');assert.equal(request.referrerPolicy,'no-referrer');
 assert.deepEqual(Object.keys(request.headers).sort(),['Authorization','Content-Type']);
 assert.equal(request.headers.Authorization,'Bearer fixture-placeholder-never-live');
 assert.deepEqual(JSON.parse(request.body),{model:OPENAI_PUBLIC_PHOTO_MODEL,input:[{type:'image_url',image_url:{url:'data:image/webp;base64,'+image.toString('base64')}}]});
 assert.deepEqual(verdict,{allowed:true,provider:'openai',model:OPENAI_PUBLIC_PHOTO_MODEL,policyVersion:OPENAI_PUBLIC_PHOTO_POLICY_VERSION});
 assert.equal(request.signal.aborted,true,'controller is disposed after the bounded request');
});

test('actual supported returned snapshot identity is preserved in attestation',async()=>{
 const body=result();body.model='omni-moderation-2024-09-26';
 assert.equal((await fixture(()=>response(body)).verify(image)).model,body.model);
});

test('normalized transparent and lossless WebP pixels are accepted without metadata',async()=>{
 for(const bytes of [await sharp({create:{width:3,height:2,channels:4,background:{r:5,g:80,b:110,alpha:0.4}}}).webp().toBuffer(),await sharp(image).webp({lossless:true}).toBuffer()]){
  assert.equal((await fixture().verify(bytes)).allowed,true);
 }
});

test('top-level and per-category explicit flags reject, including inconsistent aggregate false',async()=>{
 for(const flagged of ['aggregate',...allCategories]){
  const body=result();if(flagged==='aggregate')body.results[0].flagged=true;else body.results[0].categories[flagged]=true;
  const verdict=await fixture(()=>response(body)).verify(image);assert.equal(verdict.allowed,false,flagged);assert.equal(verdict.provider,'openai');
 }
});

test('missing key is fail-closed and env is read only when the exported verifier is invoked',async()=>{
 let reads=0;
 Object.defineProperty(globalThis,'__fixtureOpenAIKey',{configurable:true,get(){reads++;return undefined;}});
 try{
  const verify=createOpenAIPublicPostVerifier({fetchImpl:async()=>{assert.fail('must not fetch without key');}});
  assert.equal(reads,0);await assert.rejects(verify(image),generic);assert.equal(reads,1);
  await assert.rejects(verifyOpenAIPublicPostImage(image),generic);assert.equal(reads,2);
 }finally{delete globalThis.__fixtureOpenAIKey;}
});

test('invalid/oversized/non-WebP/animated/metadata-bearing/unnormalized inputs never reach transport',async()=>{
 const png=await sharp(image).png().toBuffer();
 const metadata=await sharp(image).withMetadata().webp().toBuffer();
 const large=await sharp({create:{width:1601,height:1,channels:3,background:'#111111'}}).webp().toBuffer();
 // A two-frame synthetic WebP; no external image or sensitive fixture.
 const gif=Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b','hex');
 const animated=await sharp(gif,{animated:true}).webp().toBuffer();
 assert.equal((await sharp(animated).metadata()).pages,2);
 const unknownChunk=Buffer.concat([image,Buffer.from('JUNK'),Buffer.from([4,0,0,0]),Buffer.from('text')]);unknownChunk.writeUInt32LE(unknownChunk.length-8,4);
 for(const input of [null,'https://example.invalid/private.webp',Buffer.alloc(0),Buffer.alloc(500*1024+1),png,metadata,large,animated,Buffer.from('RIFF0000WEBPcorrupt'),Buffer.concat([image,Buffer.from('trailing private detail')]),unknownChunk]){
  const f=fixture();await assert.rejects(f.verify(input),generic);assert.equal(f.calls.length,0);
 }
});

test('unrecognized model, missing/extra categories, wrong input coverage, scores and incomplete response never approve',async()=>{
 const mutations=[
  x=>{x.model='unknown-model';},x=>{x.results=[];},x=>{x.results.push(x.results[0]);},x=>{delete x.id;},x=>{x.error={message:'raw provider detail'};},
  x=>{x.results[0].flagged='false';},x=>{delete x.results[0].categories.sexual;},x=>{x.results[0].categories.future=false;},
  x=>{x.results[0].categories.sexual=0;},x=>{x.results[0].category_scores.sexual=-0.01;},x=>{x.results[0].category_scores.sexual=1.01;},
  x=>{x.results[0].category_scores.sexual='0';},x=>{delete x.results[0].category_scores.sexual;},
  x=>{x.results[0].category_applied_input_types.sexual=[];},x=>{x.results[0].category_applied_input_types.sexual=['text'];},
  x=>{x.results[0].category_applied_input_types.sexual=['image','text'];},x=>{x.results[0].category_applied_input_types['sexual/minors']=['image'];},
  x=>{delete x.results[0].category_applied_input_types;},x=>{x.results[0].unreviewed=true;},
 ];
 for(const mutate of mutations){const body=result();mutate(body);await assert.rejects(fixture(()=>response(body)).verify(image),generic);}
});

test('HTTP error/rate-limit/redirect, network and invalid JSON expose only the generic draft-kept error',async()=>{
 const replies=[
  ...[204,301,401,403,429,500,503].map(status=>()=>new Response(status===204?null:'private raw failure with secret headers',{status,headers:{'Content-Type':'application/json','x-private-detail':'do-not-emit'}})),
  ()=>Promise.reject(Error('private fetch request headers and credentials must not escape')),
  ()=>new Response('{not-json raw-detail',{status:200,headers:{'Content-Type':'application/json'}}),
  ()=>new Response(JSON.stringify(result()),{status:200,headers:{'Content-Type':'text/html'}}),
  ()=>Object.defineProperty(response(),'redirected',{value:true}),
  ()=>Object.defineProperty(response(),'url',{value:'https://other.invalid/redirected'}),
 ];
 for(const reply of replies)await assert.rejects(fixture(reply).verify(image),generic);
});

test('response is bounded by declared length and streamed bytes, including UTF-8 and mid-stream failures',async()=>{
 const replies=[
  ()=>response(result(),{'Content-Length':'32769'}),()=>response(result(),{'Content-Length':'not-a-number'}),
  ()=>new Response(' '.repeat(32769),{headers:{'Content-Type':'application/json'}}),
  ()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([0xff,0xff]));c.close();}}),{headers:{'Content-Type':'application/json'}}),
  ()=>new Response(new ReadableStream({start(c){c.error(Error('raw body I/O detail'));}}),{headers:{'Content-Type':'application/json'}}),
 ];
 for(const reply of replies)await assert.rejects(fixture(reply).verify(image),generic);
});

test('deadline bounds both stalled transport and stalled response body without retry',async()=>{
 let cancelled=false;
 for(const fetchImpl of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({start(){},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}})]){
  let signal,calls=0;
  const verify=createOpenAIPublicPostVerifier({apiKey:'fixture-placeholder-never-live',timeoutMs:20,fetchImpl:(...args)=>{signal=args[1].signal;calls++;return fetchImpl(...args);}});
  const started=Date.now();await assert.rejects(verify(image),generic);assert.ok(Date.now()-started<1500);assert.equal(signal.aborted,true);assert.equal(calls,1);
 }
 assert.equal(cancelled,true,'a stalled body reader is cancelled at the deadline');
});

test('invalid credentials/deadline configuration cannot call the transport',async()=>{
 for(const options of [{apiKey:''},{apiKey:'contains\nnewline'},{apiKey:' '.repeat(5)},{apiKey:'x'.repeat(513)},{timeoutMs:0},{timeoutMs:12001},{timeoutMs:1.5},{timeoutMs:Infinity}]){
  const verify=createOpenAIPublicPostVerifier({apiKey:'fixture-placeholder-never-live',fetchImpl:async()=>assert.fail('invalid configuration reached transport'),...options});
  await assert.rejects(verify(image),generic);
 }
});

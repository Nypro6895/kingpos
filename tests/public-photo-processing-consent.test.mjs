import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Browser bundle must not pull the server-only verifier, image decoder, credentials or transport.
const bundled=await build({entryPoints:['lib/public-photo-processing-consent.ts'],bundle:true,write:false,platform:'browser',format:'esm'});
const source=bundled.outputFiles[0].text;
assert.doesNotMatch(source,/server-only|node:|OPENAI_API_KEY|api\.openai\.com|sharp|createClient|public-image-safety/);
const {PUBLIC_PHOTO_PROCESSING_NOTICE_VERSION, PUBLIC_PHOTO_PROCESSING_NOTICE, PUBLIC_PHOTO_PROCESSING_CHECKBOX_LABEL,
 PUBLIC_PHOTO_PROCESSING_DECLINE_NOTICE, PUBLIC_PHOTO_PROCESSING_PRIVACY_HREF,
 assertPublicPhotoProcessingConsent,withPublicPhotoProcessingConsent}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const current=()=>({provider:'openai',noticeVersion:PUBLIC_PHOTO_PROCESSING_NOTICE_VERSION,accepted:true});
const invalid=[
 undefined,null,false,true,'accepted',[],{},
 {accepted:true},{...current(),accepted:false},{...current(),accepted:'true'},{...current(),accepted:1},
 {...current(),noticeVersion:'stale-version'},{...current(),noticeVersion:''},{...current(),noticeVersion:null},
 {...current(),provider:'another-ai'},{...current(),provider:'OpenAI'},{...current(),provider:null},
 {...current(),allUploads:true},Object.create(current()),
];
const refusal=e=>e instanceof Error&&/agree to the OpenAI photo safety check for this post/.test(e.message);

test('missing, declined, stale, other-provider and generic/inherited permission fail synchronously before preparation/transport',async()=>{
 for(const consent of invalid){
  const calls=[];
  const provider=async()=>{calls.push('provider');return {allowed:true,provider:'openai',model:'synthetic',policyVersion:'test'};};
  const prepare=async({verify})=>{calls.push('private-read');return verify(Buffer.from('synthetic'));};
  assert.throws(()=>prepare({verify:withPublicPhotoProcessingConsent(consent,provider)}),refusal);
  assert.deepEqual(calls,[],'invalid consent must reject before the preparation call itself');
  assert.throws(()=>assertPublicPhotoProcessingConsent(consent),refusal);
 }
});

test('accepted current notice returns exact callback identity, invokes nothing and does not mutate or broaden consent',async()=>{
 const calls=[],consent=Object.freeze(current());
 const provider=async image=>{calls.push(image);return {allowed:true,provider:'openai',model:'synthetic',policyVersion:'test'};};
 assert.equal(assertPublicPhotoProcessingConsent(consent),undefined);
 assert.equal(withPublicPhotoProcessingConsent(consent,provider),provider);
 assert.deepEqual(calls,[],'constructing the consent boundary never performs a transfer');
 const image=Buffer.from('this post only');
 await withPublicPhotoProcessingConsent(consent,provider)(image);
 assert.equal(calls.length,1);assert.equal(calls[0],image);
 assert.deepEqual(consent,current());assert.deepEqual(Object.keys(consent).sort(),['accepted','noticeVersion','provider']);
});

test('provider failures and rejection remain unchanged; consent is not a safety verdict or fallback approval',async()=>{
 const error=new Error('synthetic unavailable');
 const unavailable=async()=>{throw error;};
 await assert.rejects(withPublicPhotoProcessingConsent(current(),unavailable)(Buffer.alloc(0)),e=>e===error);
 const rejection=Object.freeze({allowed:false,provider:'openai',model:'synthetic',policyVersion:'test'});
 const reject=async()=>rejection;
 assert.equal(await withPublicPhotoProcessingConsent(current(),reject)(Buffer.alloc(0)),rejection);
});

test('notice names recipient, data and purpose; decline and Privacy remain available in a client-only import',()=>{
 assert.match(PUBLIC_PHOTO_PROCESSING_NOTICE,/photos in this post/);
 assert.match(PUBLIC_PHOTO_PROCESSING_NOTICE,/processed copies to OpenAI/);
 assert.match(PUBLIC_PHOTO_PROCESSING_NOTICE,/automated safety check/);
 assert.match(PUBLIC_PHOTO_PROCESSING_NOTICE,/personal information/);
 assert.match(PUBLIC_PHOTO_PROCESSING_CHECKBOX_LABEL,/I agree/);
 assert.match(PUBLIC_PHOTO_PROCESSING_DECLINE_NOTICE,/keep your draft/);
 assert.equal(PUBLIC_PHOTO_PROCESSING_PRIVACY_HREF,'/privacy');
 assert.doesNotMatch(PUBLIC_PHOTO_PROCESSING_NOTICE,/anonymous|all (?:data|uploads)|training|always safe/i);
});

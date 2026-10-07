import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const salon='1650370b-f86d-461e-8d97-6210052eeed7';
const content='2650370b-f86d-461e-8d97-6210052eeed7';

test('quick booking context preserves exact intent and keeps customer data private', {skip:!process.env.ESBUILD_MODULE_PATH},async()=>{
  const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const built=await build({entryPoints:['app/api/public-booking/context/route.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'stub',setup(b){b.onResolve({filter:/lib\/public-booking$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export async function getPublicBookingPageData(salonId,params){globalThis.quickContextCalls.push({salonId,params});return {currentUser:{id:"private-account"},initialSelection:params};}',loader:'js'}));}}]});
  const {GET}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  globalThis.quickContextCalls=[];
  assert.equal((await GET(new Request('http://localhost/api/public-booking/context?salonId=bad'))).status,400);
  const startAt='2099-10-02T16:00:00Z';
  const query=new URLSearchParams({salonId:salon,inspiration:content,startAt,source:'explore'});
  const response=await GET(new Request('http://localhost/api/public-booking/context?'+query));
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('Vary'),'Cookie');
  assert.equal((await response.json()).initialSelection.startAt,startAt);assert.equal(globalThis.quickContextCalls.length,1);assert.equal(globalThis.quickContextCalls[0].params.inspiration,content);
  delete globalThis.quickContextCalls;
});

test('available chips use exact service staff and extras and batch reads by salon', {skip:!process.env.ESBUILD_MODULE_PATH},async()=>{
  const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const built=await build({entryPoints:['app/api/public-booking/inspiration-times/route.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'stub',setup(b){b.onResolve({filter:/lib\/(?:public-booking|content-booking)$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:a.path.endsWith('content-booking')?'export async function loadPublicContentBookingOptions(ids){globalThis.quickOptionCalls.push(ids);return globalThis.quickOptions;}':'export async function loadPublicBookingAvailabilityHints(input){globalThis.quickHintCalls.push(input);return [{key:input.scopes[0].key,startAt:"2099-10-02T16:00:00Z",timezoneIana:"America/Chicago"}];}',loader:'js'}));}}]});
  const {POST}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  globalThis.quickOptionCalls=[];globalThis.quickHintCalls=[];
  globalThis.quickOptions=[{contentId:content,bookingEnabled:true,bookingCtaEnabled:true,readinessState:'quick_ready',primaryServiceId:'full',creditedStaffId:'tracy',additionalServices:[{serviceId:'gel',eligible:true}],addOns:[{parentServiceId:'full',serviceId:'art',eligible:true}]},{contentId:salon,bookingEnabled:true,bookingCtaEnabled:true,readinessState:'inspiration_only'}];
  const invoke=body=>POST(new Request('http://localhost/api/public-booking/inspiration-times',{method:'POST',body:JSON.stringify(body)}));
  assert.equal((await invoke({salonId:salon,contentIds:['bad']})).status,400);assert.equal(globalThis.quickOptionCalls.length,0);
  const response=await invoke({salonId:salon,contentIds:[content,salon]});assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal((await response.json())[0].timezoneIana,'America/Chicago');
  assert.equal(globalThis.quickOptionCalls.length,1);assert.equal(globalThis.quickHintCalls.length,1);
  assert.deepEqual(globalThis.quickHintCalls[0].scopes,[{key:content,serviceIds:['full','gel'],addOnSelections:[{parentServiceId:'full',serviceId:'art'}],staffId:'tracy',staffMode:'specific'}]);
  for(const key of ['quickOptionCalls','quickHintCalls','quickOptions'])delete globalThis[key];
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

test('read-only availability validates scopes and never caches responses publicly', {skip:!process.env.ESBUILD_MODULE_PATH},async()=>{
  const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const built=await build({entryPoints:['app/api/public-booking/availability/route.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'availability',setup(b){
    b.onResolve({filter:/lib\/public-booking$/},()=>({path:'availability',namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export async function loadPublicBookingSlots(input){globalThis.availabilityCalls.push(input);return [{startAt:"2099-10-02T14:30:00Z"}];}export async function loadPublicBookingAvailabilityHints(input){globalThis.availabilityCalls.push(input);return input.scopes.map(scope=>({key:scope.key,startAt:null}));}',loader:'js'}));
  }}]});
  const {POST}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  globalThis.availabilityCalls=[];
  const id='1650370b-f86d-461e-8d97-6210052eeed7';
  const body={kind:'slots',salonId:id,selection:{date:'2099-10-02',serviceIds:[id],lineStaffIds:[''],staffMode:'any',addOnSelections:[]}};
  const invoke=value=>POST(new Request('http://localhost/api/public-booking/availability',{method:'POST',body:JSON.stringify(value)}));
  const response=await invoke(body);assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/private, no-store/);assert.equal((await response.json()).length,1);
  const hints=await invoke({...body,kind:'hints',scopes:[{key:'any',staffMode:'any'}]});assert.equal(hints.status,200);assert.deepEqual(await hints.json(),[{key:'any',startAt:null}]);
  for(const value of [{...body,salonId:'bad'},{...body,selection:{serviceIds:'bad'}},{...body,selection:{serviceIds:[id],staffMode:'bad'}},{...body,kind:'hints',scopes:Array(81).fill({key:'any'})},{...body,kind:'hints',scopes:[{key:'any',lineStaffIds:['bad']}]}])assert.equal((await invoke(value)).status,400);
  assert.equal(globalThis.availabilityCalls.length,2,'invalid requests never reach the loaders');
  delete globalThis.availabilityCalls;
});

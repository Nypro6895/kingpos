import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

test('confirm returns only the mutation result, preserves idempotency and rejects foreign origins', {skip:!process.env.ESBUILD_MODULE_PATH},async()=>{
  const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
  const built=await build({entryPoints:['app/api/public-booking/confirm/route.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'stubs',setup(b){
    b.onResolve({filter:/lib\/public-booking$|next\/cache$/},a=>({path:a.path,namespace:'stub'}));
    b.onLoad({filter:/.*/,namespace:'stub'},a=>({loader:'js',contents:a.path==='next/cache'?'export function revalidatePath(path){globalThis.confirmInvalidations.push(path);}':'export async function createPublicBooking(input){globalThis.confirmCalls.push(input);return globalThis.confirmResult;}'}));
  }}]});
  const {POST}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
  globalThis.confirmCalls=[];globalThis.confirmInvalidations=[];globalThis.confirmResult={ok:true,bookingId:'booking',accountLinked:true,message:'Created'};
  const body={salonId:'1650370b-f86d-461e-8d97-6210052eeed7',serviceIds:['1650370b-f86d-461e-8d97-6210052eeed7'],startAt:'2099-10-02T14:30:00Z',idempotencyKey:'same-key'};
  const invoke=(value,origin='http://localhost')=>POST(new Request('http://localhost/api/public-booking/confirm',{method:'POST',headers:{origin},body:JSON.stringify(value)}));
  for(const origin of ['https://foreign.example','invalid-origin','null'])assert.equal((await invoke(body,origin)).status,403);
  assert.equal((await invoke({...body,customerEmail:123})).status,400);assert.equal(globalThis.confirmCalls.length,0);
  const response=await invoke(body);assert.deepEqual(await response.json(),globalThis.confirmResult);assert.match(response.headers.get('Server-Timing'),/booking;dur=/);assert.equal(globalThis.confirmCalls[0].idempotencyKey,'same-key');assert.ok(globalThis.confirmInvalidations.includes('/my-bookings'));
  globalThis.confirmInvalidations=[];globalThis.confirmResult={ok:false,code:'unavailable_slot',message:'Choose another time'};
  assert.deepEqual(await (await invoke(body)).json(),globalThis.confirmResult);assert.deepEqual(globalThis.confirmInvalidations,[]);
  for(const key of ['confirmCalls','confirmInvalidations','confirmResult'])delete globalThis[key];
});

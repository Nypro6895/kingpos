import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const dependencies={
 '@/lib/current-context':`export const getCurrentBusinessContext=async()=>globalThis.__pinTest.context;export const isSalonManageContext=()=>true;`,
 '@/lib/permissions':`export const hasPermission=async()=>true;`,
 '@/lib/supabase/server':`export const createAuthenticatedSupabaseServerClient=async()=>globalThis.__pinTest.client;`,
 '@/lib/location/geocoding-service':`export const getGeocodingProviderStatus=()=>({configured:true,provider:'maptiler',missingConfiguration:[]});export const isAcceptableGeocodingResult=value=>Boolean(value);export const geocodePublicSalonAddress=async()=>globalThis.__pinTest.geocode();`,
};
const built=await build({entryPoints:['lib/location/salon-map-location.ts','lib/location/coordinate-validity.ts','lib/location/address.ts'],bundle:true,write:false,outdir:'fixture',platform:'node',format:'esm',plugins:[{name:'location-test-dependencies',setup(b){
 b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'',loader:'js'}));
 b.onResolve({filter:/^@\/lib\//},args=>dependencies[args.path]?{path:args.path,namespace:'mock'}:null);
 b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:dependencies[args.path],loader:'js'}));
}}]});
const modules=await Promise.all(built.outputFiles.map(file=>import('data:text/javascript;base64,'+Buffer.from(file.text).toString('base64'))));
const {refreshCurrentSalonMapLocation,getCurrentSalonMapLocationState}=modules.find(x=>x.refreshCurrentSalonMapLocation);
const {hasCurrentLocationPin,locationPinSnapshot}=modules.find(x=>x.hasCurrentLocationPin);
const {normalizePublicSalonAddress}=modules.find(x=>x.normalizePublicSalonAddress);
const setting={salon_id:'20000000-0000-0000-0000-000000000001',address_line1:'420 6th St',address_line2:null,city:'Racine',state:'WI',postal_code:'53403',country:'US'};
const address=normalizePublicSalonAddress({addressLine1:setting.address_line1,city:setting.city,state:setting.state,postalCode:setting.postal_code,country:setting.country});
const original={latitude:43,longitude:-88,geocoding_address_fingerprint:address.fingerprint,geocoding_provider:'us_census',geocoding_place_id:'tiger:123:R',geocoding_status:'mapped',geocoded_at:'2026-10-01T00:00:00+00:00',geocoding_pin_origin:'auto_census',updated_at:'2026-10-01T00:00:00Z'};
function harness(row={...original},geocode=async()=>({result:null,error:{type:'timeout'}}),rpcResult='updated') {
 const calls=[];let providerCalls=0;
 const query={select(){return this;},eq(){return this;},async maybeSingle(){return {data:row,error:null};}};
 const context={user:{id:'user'},currentAccount:{id:'account'},currentSalon:{id:setting.salon_id}};
 globalThis.__pinTest={context,client:{from:()=>query,rpc:async(name,args)=>{calls.push({name,args});if(rpcResult==='updated')row.geocoding_status=args.p_values.status;return {data:rpcResult,error:null};}},geocode:async()=>{providerCalls++;return geocode();}};
 return {calls,row,input:{context,setting,reason:'manual_refresh'},providerCalls:()=>providerCalls};
}
test('current-pin pure contract preserves legacy/owner pins but excludes stale/error/partial/mismatched pairs',()=>{
 assert.equal(hasCurrentLocationPin(original,address),true);
 assert.equal(hasCurrentLocationPin({...original,geocoding_address_fingerprint:null,geocoding_pin_origin:null},address),true);
 assert.equal(hasCurrentLocationPin({...original,geocoding_pin_origin:'owner_confirmed'},address),true);
 const incomplete=normalizePublicSalonAddress({addressLine1:'420 6th St',city:'Racine',state:'WI'});
 assert.equal(hasCurrentLocationPin({...original,geocoding_address_fingerprint:null,geocoding_pin_origin:null},incomplete),true);
 assert.equal(hasCurrentLocationPin(original,incomplete),false);
 for(const bad of [{latitude:null},{longitude:null},{latitude:NaN},{longitude:181},{latitude:0,longitude:0},{geocoding_address_fingerprint:'old'},...['stale','pending','failed','address_required'].map(geocoding_status=>({geocoding_status}))])assert.equal(hasCurrentLocationPin({...original,...bad},address),false);
 assert.deepEqual(locationPinSnapshot(original),{latitude:43,longitude:-88,fingerprint:address.fingerprint,provider:'us_census',placeId:'tiger:123:R',origin:'auto_census',geocodedAt:'2026-10-01T00:00:00+00:00'});
});
test('actual owner map state suppresses stale display pin while retaining source coordinates',async()=>{
 const h=harness({...original,geocoding_status:'stale'});const state=await getCurrentSalonMapLocationState(h.input);
 assert.equal(state.status,'stale');assert.equal(state.coordinates,null);assert.equal(h.row.latitude,43);
 const pending=harness({...original,geocoding_status:'pending'});const progress=await getCurrentSalonMapLocationState(pending.input);assert.equal(progress.status,'pending');assert.equal(progress.coordinates,null);
 const legacy=harness({...original,geocoding_address_fingerprint:null,geocoding_pin_origin:null});const oldPin=await getCurrentSalonMapLocationState({...legacy.input,setting:{...setting,postal_code:null}});assert.equal(oldPin.status,'mapped');assert.deepEqual(oldPin.coordinates,{latitude:43,longitude:-88});
});
test('actual refresh never calls provider for owner-confirmed or already-current automatic/backfill pins',async()=>{
 const confirmed=harness({...original,geocoding_pin_origin:'owner_confirmed'});await refreshCurrentSalonMapLocation(confirmed.input);assert.equal(confirmed.providerCalls(),0);assert.equal(confirmed.calls.length,0);
 const current=harness();await refreshCurrentSalonMapLocation({...current.input,reason:'backfill'});assert.equal(current.providerCalls(),0);assert.equal(current.calls.length,0);
 const partial=harness({...original,longitude:null,geocoding_pin_origin:null});await refreshCurrentSalonMapLocation({...partial.input,reason:'address_save'});assert.equal(partial.providerCalls(),0);assert.equal(partial.calls.length,0);assert.equal(partial.row.latitude,43);
});
test('actual pending/failure refresh RPC keeps original metadata and supplies original-pin/current-address CAS',async()=>{
 const h=harness();await refreshCurrentSalonMapLocation(h.input);assert.equal(h.providerCalls(),1);assert.deepEqual(h.calls.map(x=>x.args.p_values.status),['pending','failed']);
 for(const call of h.calls){assert.equal(call.name,'set_current_salon_geocoding_state');assert.equal(call.args.p_fingerprint,address.fingerprint);assert.deepEqual(call.args.p_prior_pin,locationPinSnapshot(original));assert.equal(call.args.p_values.provider,null);assert.equal(call.args.p_values.latitude,null);}
 assert.equal(h.row.geocoding_address_fingerprint,address.fingerprint);assert.equal(h.row.geocoding_provider,'us_census');assert.equal(h.row.latitude,43);
});
test('actual source-busy/stale preparation prevents unnecessary provider work',async()=>{
 for(const outcome of ['source_busy','stale','owner_pin_preserved']){const h=harness({...original},undefined,outcome);await refreshCurrentSalonMapLocation(h.input);assert.equal(h.providerCalls(),0);assert.equal(h.calls.length,1);}
});

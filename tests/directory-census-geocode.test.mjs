import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
const built=await build({entryPoints:['lib/location/census-address-match.ts','lib/location/providers/census-address-geocoder.ts','lib/location/directory-geocode-worker.ts'],bundle:true,write:false,outdir:'fixture',platform:'node',format:'esm',plugins:[{name:'server-only-test',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'',loader:'js'}));}}]});
const modules=await Promise.all(built.outputFiles.map(file=>import('data:text/javascript;base64,'+Buffer.from(file.text).toString('base64'))));
const {parseCensusAddressMatch,censusStreetAddress}=modules.find(x=>x.parseCensusAddressMatch);
const {geocodeDirectoryAddressWithCensus}=modules.find(x=>x.geocodeDirectoryAddressWithCensus);
const {runDirectoryGeocodeBatch}=modules.find(x=>x.runDirectoryGeocodeBatch);
const live=JSON.parse(readFileSync('tests/fixtures/census-directory-address-matches.json','utf8'));
const sample=live.samples[0];const payload={result:{addressMatches:sample.providerMatches}};
const candidate={salonId:sample.salonId,fingerprint:parseCensusAddressMatch(sample.address,payload).match.fingerprint,address:sample.address};
const clone=value=>structuredClone(value);
test('actual Census public address responses pass strict matching and retain suite fingerprint/interpolation provenance',()=>{
 assert.equal(live.samples.length,5);
 for(const row of live.samples){const result=parseCensusAddressMatch(row.address,{result:{addressMatches:row.providerMatches}});assert.equal(!!result.match,row.accepted);}
 const result=parseCensusAddressMatch(sample.address,payload).match;
 assert.equal(result.accuracy,'address_range_interpolated');assert.match(result.fingerprint,/suite 3/);
 assert.equal(censusStreetAddress(sample.address),'420 6th St');
 assert.equal(censusStreetAddress(live.samples[2].address),null,'Wisconsin grid address remains review-only');
});
test('ambiguous, unmatched, changed city/state/ZIP/street/house and invalid coordinates/provenance never become automatic pins',()=>{
 for(const [key,value] of [['city','Madison'],['state','IL'],['zip','53703'],['streetName','OTHER'],['fromAddress','9999']]){
  const bad=clone(payload);bad.result.addressMatches[0].addressComponents[key]=value;assert.equal(parseCensusAddressMatch(sample.address,bad).match,null);
 }
 for(const coords of [{x:0,y:0},{x:'-87',y:43},{x:NaN,y:43},{x:0,y:91}]){const bad=clone(payload);bad.result.addressMatches[0].coordinates=coords;assert.equal(parseCensusAddressMatch(sample.address,bad).match,null);}
 const bad=clone(payload);bad.result.addressMatches[0].matchedAddress='421 6TH ST, RACINE, WI, 53403';assert.equal(parseCensusAddressMatch(sample.address,bad).match,null);
 bad.result.addressMatches=[...sample.providerMatches,...sample.providerMatches];assert.equal(parseCensusAddressMatch(sample.address,bad).reason,'ambiguous_match');
 assert.equal(parseCensusAddressMatch(sample.address,{result:{addressMatches:[]}}).reason,'no_match');
 const noProvenance=clone(payload);delete noProvenance.result.addressMatches[0].tigerLine;assert.equal(parseCensusAddressMatch(sample.address,noProvenance).match,null);
 assert.equal(censusStreetAddress({...sample.address,country:'CA'}),null);
 assert.equal(censusStreetAddress({...sample.address,addressLine1:'PO Box 12'}),null);
});
test('forward request uses official address endpoint, one call, bounded timeout and distinct upstream errors',async()=>{
 const calls=[];const result=await geocodeDirectoryAddressWithCensus(sample.address,async(url,init)=>{calls.push({url:new URL(url),init});return new Response(JSON.stringify(payload));});
 assert.equal(result.match.provider,'us_census');assert.equal(calls.length,1);assert.equal(calls[0].url.hostname,'geocoding.geo.census.gov');assert.equal(calls[0].url.pathname,'/geocoder/locations/address');assert.equal(calls[0].url.searchParams.get('street'),'420 6th St');assert.equal(calls[0].init.cache,'no-store');
 assert.equal((await geocodeDirectoryAddressWithCensus(sample.address,async()=>new Response('',{status:429}))).reason,'rate_limited');
 assert.equal((await geocodeDirectoryAddressWithCensus(sample.address,async()=>{throw new Error('secret upstream URL');})).reason,'network');
 assert.equal((await geocodeDirectoryAddressWithCensus(live.samples[2].address,async()=>{throw new Error('must not call');})).reason,'unsupported_address');
});
test('maintenance defaults to dry-run and clamps five candidates without claim/write RPCs',async()=>{
 const calls=[];let geocodes=0;const pauses=[];
 const report=await runDirectoryGeocodeBatch({limit:99,rpc:async(name,args)=>{calls.push({name,args});return {error:null,data:{candidates:Array(12).fill(candidate),nextAfter:candidate.salonId,scanned:256,hasMore:true}};},geocode:async(address)=>{geocodes++;return parseCensusAddressMatch(address,payload);},pause:async(ms)=>{pauses.push(ms);}});
 assert.equal(report.dryRun,true);assert.equal(report.examined,5);assert.equal(report.applied,0);assert.equal(geocodes,5);assert.deepEqual(calls.map(x=>x.name),['get_directory_geocode_candidates']);assert.equal(calls[0].args.p_limit,5);assert.equal(calls[0].args.p_scan_limit,256);assert.deepEqual(pauses,[1000,1000,1000,1000]);
});
test('apply acquires lease before provider and honors stale/source/owner-pin outcomes without claiming success',async()=>{
 const calls=[];const token='00000000-0000-0000-0000-000000000001';
 const report=await runDirectoryGeocodeBatch({dryRun:false,rpc:async(name,args)=>{calls.push({name,args});return {error:null,data:name==='get_directory_geocode_candidates'?{candidates:[candidate],scanned:1}:name==='claim_directory_geocode_job'?token:'stale'};},geocode:async(address)=>{assert.equal(calls.at(-1).name,'claim_directory_geocode_job');return parseCensusAddressMatch(address,payload);}});
 assert.equal(report.accepted,1);assert.equal(report.applied,0);assert.equal(report.results[0].outcome,'stale');assert.equal(calls.at(-1).args.p_lease_token,token);
 assert.equal(report.skipped,1);assert.equal(report.rejected,0);
 let called=false;const skipped=await runDirectoryGeocodeBatch({dryRun:false,rpc:async(name)=>({error:null,data:name==='get_directory_geocode_candidates'?{candidates:[candidate]}:null}),geocode:async()=>{called=true;throw new Error();}});assert.equal(called,false);assert.equal(skipped.skipped,1);
});
test('source_busy yields an accepted provider result as skipped, never applied or quality-rejected',async()=>{
 const token='00000000-0000-0000-0000-000000000001';
 const report=await runDirectoryGeocodeBatch({dryRun:false,rpc:async(name)=>({error:null,data:name==='get_directory_geocode_candidates'?{candidates:[candidate]}:name==='claim_directory_geocode_job'?token:'source_busy'}),geocode:async(address)=>parseCensusAddressMatch(address,payload)});
 assert.equal(report.accepted,1);assert.equal(report.skipped,1);assert.equal(report.applied,0);assert.equal(report.rejected,0);assert.equal(report.results[0].outcome,'source_busy');
});
test('bad cursor/RPC/address/fingerprint and provider exceptions are handled without exposed credential messages',async()=>{
 await assert.rejects(runDirectoryGeocodeBatch({after:'x',rpc:async()=>({error:null,data:null})}),/Invalid maintenance cursor/);
 await assert.rejects(runDirectoryGeocodeBatch({rpc:async()=>({error:{message:'SECRET'},data:null})}),error=>!error.message.includes('SECRET'));
 const report=await runDirectoryGeocodeBatch({rpc:async()=>({error:null,data:{candidates:[{...candidate,fingerprint:'wrong'},{...candidate,address:{city:8}}]}})});assert.equal(report.examined,0);assert.equal(report.skipped,2);
 const failed=await runDirectoryGeocodeBatch({rpc:async()=>({error:null,data:{candidates:[candidate]}}),geocode:async()=>{throw new Error('secret');}});assert.equal(failed.results[0].reason,'network');
});

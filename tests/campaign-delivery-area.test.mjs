import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const result=await build({entryPoints:['lib/campaign-delivery-area.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()}});
const {resolveCampaignDeliveryArea:resolve,campaignDeliveryRequest:request}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const salon={country:'US',state:'WI',city:'Milwaukee',postal_code:'53218'};
const gps={country:'US',state:'WI',city:'Milwaukee',postalCode:'53218'};
const options=(rows=[salon],area=gps)=>({lookup:async()=>rows,reverse:async()=>area});
test('US state aliases never rewrite a state in another explicit country',async()=>{
 const row={country:'Canada',state:'Washington',city:'Example',postal_code:'A1A 1A1'};
 const expected={country:'CA',state:'Washington',city:'Example',zipcode:'',neighborhood:''};
 assert.deepEqual(await resolve({location:'Example, Washington, Canada'},options([row],null)),expected);
 assert.equal(await resolve({location:'Example, WA, Canada'},options([row],null)),null);
 const reverse={country:'CA',state:'Washington',city:'Example',postalCode:'A1A 1A1'};
 assert.deepEqual(await resolve({latitude:49,longitude:-123},options([],reverse)),{...expected,zipcode:'A1A 1A1'});
 assert.deepEqual(await resolve({location:'Washington, Canada'},options([row],null)),{...expected,city:''});
});
test('full state/country names and ZIP+4 normalize; a city never inherits a salon ZIP',async()=>{
 assert.deepEqual(await resolve({location:'53218-1234, Wisconsin, United States'},options()),{country:'US',state:'WI',city:'Milwaukee',zipcode:'53218',neighborhood:''});
 assert.equal((await resolve({location:'Milwaukee, Wisconsin, United States of America'},options())).zipcode,'');
 assert.equal((await resolve({location:'Milwaukee WI'},options())).state,'WI');
 assert.equal(await resolve({location:'Unknown, WI, US'},options()),null);
});
test('existing GPS enriches the matching selected city with its verified ZIP, even without nearby salon records',async()=>{
 const input={location:'Milwaukee, Wisconsin, United States',latitude:43.1,longitude:-87.98};
 assert.equal((await resolve(input,options([]))).zipcode,'53218');
 assert.equal((await resolve({latitude:43.1,longitude:-87.98},options([]))).city,'Milwaukee');
 assert.equal((await resolve(input,options([salon],{...gps,postalCode:null}))).zipcode,'');
});
test('a new selected city overrides stale GPS; provider failure never widens ZIP targeting',async()=>{
 const chicago={country:'US',state:'IL',city:'Chicago',postal_code:'60601'};
 const chosen=await resolve({location:'Chicago, IL, US',latitude:43.1,longitude:-87.98},options([chicago]));
 assert.deepEqual(chosen,{country:'US',state:'IL',city:'Chicago',zipcode:'',neighborhood:''});
 const fallback=await resolve({location:'Milwaukee, WI, US',latitude:43.1,longitude:-87.98},{lookup:async()=>[salon],reverse:async()=>{throw Error('unavailable')}});
 assert.equal(fallback.zipcode,'');
 assert.equal(await resolve({latitude:43.1,longitude:-87.98},options([],null)),null);
});
test('ambiguous cities fail closed; country/state selection stays broad; CA remains California',async()=>{
 assert.equal(await resolve({location:'Milwaukee'},options([salon,{...salon,state:'OR'}])),null);
 let reversed=0;const opts={lookup:async()=>[salon],reverse:async()=>{reversed++;return gps}};
 assert.deepEqual(await resolve({location:'Wisconsin',latitude:43.1,longitude:-87.98},opts),{country:'US',state:'WI',city:'',zipcode:'',neighborhood:''});
 assert.deepEqual(await resolve({location:'United States'},options()),{country:'US',state:'',city:'',zipcode:'',neighborhood:''});assert.equal(reversed,0);
 const ca=await resolve({location:'CA'},options([{...salon,state:'CA',city:'Los Angeles'}]));assert.equal(ca.state,'CA');assert.equal(ca.country,'US');
 const hood=await resolve({location:'North Side, Milwaukee, WI, US',latitude:43.1,longitude:-87.98},opts);assert.equal(hood.neighborhood,'North Side');assert.equal(hood.zipcode,'');assert.equal(reversed,0);
});
test('malformed labels fail closed and coordinates never enter a request URL',async()=>{
 for(const location of ['Milwaukee,,US','a'.repeat(161),'WI\nUS'])assert.equal(await resolve({location},options()),null);
 const r=request('Milwaukee, WI',43.1,-87.98);assert.equal(r.url,'/api/campaigns/delivery');assert.deepEqual(JSON.parse(r.body),{kind:'select',location:'Milwaukee, WI',latitude:43.1,longitude:-87.98});
 assert.notEqual(r.key,request('Milwaukee, WI',43.1001,-87.98).key);
 assert.equal(request(undefined),null);assert.equal(request('',Infinity,-87),null);assert.equal(request('53218').body,undefined);
});

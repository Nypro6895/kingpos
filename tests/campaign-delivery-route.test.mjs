import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const mock=`export const cookies=async()=>({get:()=>({value:'00000000-0000-0000-0000-000000000001'}),set(){}});export const getCurrentBusinessContext=async()=>({user:null});export const ownerCampaignSettings=async()=>({enabled:true});export const resolveExploreGpsArea=async()=>({area:globalThis.gps});export const getSalonProfileMediaUrl=()=>'/image.webp';export const campaignVisitorHash=()=> 'a'.repeat(64);export const campaignVisitorIdentity=()=> 'visitor';export const signCampaignTicket=()=> 'signed-ticket';export const readCampaignTicket=()=>null;export const advertisingClient=()=>({from(){const chain=new Proxy({},{get(_,key){return key==='then'?r=>r({data:[{country:'US',state:'WI',city:'Milwaukee',postal_code:'53218'}],error:null}):()=>chain}});return chain},async rpc(name,args){globalThis.calls.push({name,args});return name==='owner_campaign_candidates'?{data:Array.from({length:6},(_,i)=>({id:'ad'+i,source_type:'salon_profile_look',source_id:'post',salon_id:'salon'+i,title:'Ready ad'+i}))}:{data:{caption:'Message',media_path:'photo.webp'}}}});`;
const result=await build({entryPoints:['app/api/campaigns/delivery/route.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^(next\/headers|@\/lib\/(explore-advertising|current-context|owner-campaign-delivery|owner-campaigns|salon-profile|location\/explore-gps-area))$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mock,loader:'js'}));}}]});
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('GPS selection is private, signed and read-only; existing view/click handler is not invoked',async()=>{
 globalThis.calls=[];globalThis.gps={country:'US',state:'WI',city:'Milwaukee',postalCode:'53218'};
 const r=await POST(new Request('https://reylumi.test/api/campaigns/delivery',{method:'POST',headers:{origin:'https://reylumi.test'},body:JSON.stringify({kind:'select',location:'Milwaukee, Wisconsin, United States',latitude:43.1,longitude:-87.98})}));
 assert.equal(r.status,200);assert.equal((await r.json()).ticket,'signed-ticket');assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(globalThis.calls[0].args.p_area.zipcode,'53218');assert.ok(globalThis.calls.every(c=>c.name!=='owner_campaign_admit'));
});
test('label-only reads do not borrow the salon ZIP, and bad/cross-origin GPS requests are rejected',async()=>{
 globalThis.calls=[];const r=await GET(new Request('https://reylumi.test/api/campaigns/delivery?location=Milwaukee%2C%20Wisconsin%2C%20United%20States'));assert.equal(r.status,200);assert.equal(globalThis.calls[0].args.p_area.zipcode,'');
 for(const [origin,latitude,expected] of [['https://other.test',43.1,403],['https://reylumi.test',200,400]]){const r=await POST(new Request('https://reylumi.test/api/campaigns/delivery',{method:'POST',headers:{origin},body:JSON.stringify({kind:'select',location:'Milwaukee',latitude,longitude:-87.98})}));assert.equal(r.status,expected)}
});

test('batch is opt-in, bounded to five; legacy single response stays compatible and never admits views',async()=>{
 globalThis.calls=[];
 const ads=await (await GET(new Request('https://reylumi.test/api/campaigns/delivery?location=Milwaukee%2CWI%2CUS&batch=1'))).json();
 assert.equal(ads.length,5);assert.equal(ads[0].title,'Ready ad0');assert.equal(ads[4].title,'Ready ad4');
 assert.ok(globalThis.calls.every(c=>c.name!=='owner_campaign_admit'));
 const ad=await (await GET(new Request('https://reylumi.test/api/campaigns/delivery?location=Milwaukee%2CWI%2CUS'))).json();assert.ok(!Array.isArray(ad));assert.equal(ad.title,'Ready ad0');
});

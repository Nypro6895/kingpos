import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const mock=`export const createSupabaseServerClient=()=>{throw Error("Unexpected client")};
export const cookies=async()=>({get:()=>({value:'00000000-0000-0000-0000-000000000001'}),set(){}});
export const getCurrentBusinessContext=async()=>({user:null});export const ownerCampaignSettings=async()=>({enabled:true});
export const resolveExploreGpsArea=async()=>({area:globalThis.gps});export const getSalonProfileMediaUrl=()=>'/image.webp';
export const campaignVisitorHash=()=> 'a'.repeat(64);export const campaignVisitorIdentity=()=> 'visitor';
export const signCampaignTicket=()=> 'signed-ticket';export const readCampaignTicket=()=>null;
export const advertisingClient=()=>({
 from(table){if(table!=='locations')throw Error('Unexpected table '+table);const filters=[];
  return {select(){return this},eq(field,value){filters.push(row=>row[field]===value);return this},
   ilike(field,value){filters.push(row=>row[field]?.toLowerCase()===value.toLowerCase());return this},
   async limit(){return {data:globalThis.places.filter(row=>filters.every(match=>match(row))),error:null}}};},
 async rpc(name,args){globalThis.calls.push({name,args});
  if(name==='get_public_explore_query_entities')return globalThis.entities;
  if(name==='get_public_explore_address_area')return {data:{version:1,areaCandidates:[]},error:null};
  return ['owner_campaign_candidates','owner_campaign_search_candidates'].includes(name)?{data:Array.from({length:6},(_,i)=>({id:'ad'+i,source_type:'salon_profile_look',source_id:'post',salon_id:'salon'+i,title:'Ready ad'+i}))}:{data:{caption:'Message',media_path:'photo.webp'}};
 }});`;
const result=await build({entryPoints:['app/api/campaigns/delivery/route.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/^(server-only|next\/headers|@\/lib\/(supabase\/server|explore-advertising|current-context|owner-campaign-delivery|owner-campaigns|salon-profile|location\/explore-gps-area))$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mock,loader:'js'}));}}]});
const {GET,POST}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
function reset(){
 globalThis.calls=[];globalThis.gps={country:'US',state:'WI',city:'Milwaukee',postalCode:'53218'};
 globalThis.entities={data:{version:1,areaCandidates:[]},error:null};
 globalThis.places=[{status:'active',country:'US',state:'WI',city:'Milwaukee',postal_code:'53218'},{status:'active',country:'US',state:'WI',city:'Madison',postal_code:'53703'}];
}
function select(input){return POST(new Request('https://reylumi.test/api/campaigns/delivery',{method:'POST',headers:{origin:'https://reylumi.test'},body:JSON.stringify({kind:'select',location:'',latitude:43.1,longitude:-87.98,batch:true,...input})}));}
const candidateCall=()=>globalThis.calls.find(call=>['owner_campaign_candidates','owner_campaign_search_candidates'].includes(call.name));

test('real route resolves search intent, retains geo and no-store; no legacy fallback for relevance failures',async()=>{
 reset();
 for(const [query,terms,kind,category] of [['gel manicure','gel manicure','service','Nails'],['red nails','red','style','Nails'],['nails near me','','service','Nails']]){
  globalThis.calls=[];const r=await POST(new Request('https://reylumi.test/api/campaigns/delivery',{method:'POST',headers:{origin:'https://reylumi.test'},body:JSON.stringify({kind:'select',query,location:'Milwaukee, WI, US',latitude:43.1,longitude:-87.98,batch:true})}));
  assert.equal((await r.json()).length,5);assert.equal(r.headers.get('cache-control'),'private, no-store');const c=globalThis.calls.find(c=>c.name==='owner_campaign_search_candidates');assert.equal(c.args.p_terms,terms);assert.equal(c.args.p_kind,kind);assert.equal(c.args.p_category,category);assert.equal(c.args.p_area.zipcode,'53218');assert.ok(!globalThis.calls.some(c=>['owner_campaign_candidates','owner_campaign_admit'].includes(c.name)));
 }
 globalThis.calls=[];await GET(new Request('https://reylumi.test/api/campaigns/delivery?location=Milwaukee%2CWI%2CUS&query=&batch=1'));assert.equal(globalThis.calls[0].name,'owner_campaign_candidates','empty query keeps existing selection without entity lookup');
 for(const query of ['x'.repeat(161),'gel\n']){globalThis.calls=[];const r=await GET(new Request('https://reylumi.test/api/campaigns/delivery?location=Milwaukee&query='+encodeURIComponent(query)));assert.equal(r.status,400);assert.equal(globalThis.calls.length,0);}
});

test('query place beats conflicting GPS; explicit selected location still beats the query place',async()=>{
 reset();
 globalThis.entities={data:{version:1,areaCandidates:[{kind:'city',label:'Madison, WI',city:'Madison',stateCode:'WI'}]},error:null};
 const query='gel manicure in Madison, WI';
 const response=await select({query});assert.equal((await response.json()).length,5);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(candidateCall().name,'owner_campaign_search_candidates');
 assert.equal(candidateCall().args.p_terms,'gel manicure');
 assert.deepEqual(candidateCall().args.p_area,{country:'US',state:'WI',city:'Madison',zipcode:'',neighborhood:''},'stale Milwaukee GPS cannot override Madison or inject its ZIP');
 globalThis.calls=[];await select({query,location:'Milwaukee, WI, US'});
 assert.equal(candidateCall().args.p_area.city,'Milwaukee','manual configured location retains Explore priority');
 assert.equal(candidateCall().args.p_area.zipcode,'53218','agreeing GPS can still enrich the selected area');
 globalThis.calls=[];const get=await GET(new Request('https://reylumi.test/api/campaigns/delivery?query='+encodeURIComponent(query)+'&batch=1'));
 assert.equal((await get.json()).length,5);assert.equal(candidateCall().args.p_area.city,'Madison','query-only GET uses the same verified area');
 assert.ok(!globalThis.calls.some(call=>call.name==='owner_campaign_admit'));
});

test('nearby and empty queries retain GPS; unresolved or conflicting areas never widen to it',async()=>{
 reset();await select({query:'nails near me'});
 assert.equal(candidateCall().args.p_area.city,'Milwaukee');assert.equal(candidateCall().args.p_category,'Nails');assert.equal(candidateCall().args.p_terms,'');
 globalThis.calls=[];await select({query:''});
 assert.equal(candidateCall().name,'owner_campaign_candidates');assert.equal(candidateCall().args.p_area.zipcode,'53218');
 assert.ok(!globalThis.calls.some(call=>call.name==='get_public_explore_query_entities'),'empty query does not perform an entity lookup');
 for(const input of [{query:'gel manicure in Unknown City, WI'},{query:'gel manicure',location:'Madison, AL, US'},{query:'gel manicure at 999 Unknown Street'}]){
  globalThis.calls=[];const response=await select(input);assert.equal(await response.json(),null,JSON.stringify(input));assert.equal(candidateCall(),undefined,'no geographic fallback for an unresolved selected area');
 }
 for(const entities of [
  {data:null,error:{code:'lookup-failed'}},
  {data:{version:1,areaCandidates:[{kind:'city',label:'Madison, WI',city:'Madison',stateCode:'WI'},{kind:'city',label:'Madison, AL',city:'Madison',stateCode:'AL'}]},error:null}
 ]){
  globalThis.calls=[];globalThis.entities=entities;const response=await select({query:'gel manicure in Madison'});
  assert.equal(await response.json(),null);assert.equal(candidateCall(),undefined,'failed or ambiguous query routing cannot select a broad GPS ad');
 }
});

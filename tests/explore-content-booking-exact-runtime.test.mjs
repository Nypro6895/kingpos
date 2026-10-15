import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function load(file,dependencies={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,URL,Request,Response,Date,console:{warn(){}},require(name){
   if(name==='server-only')return {};
   if(Object.hasOwn(dependencies,name))return dependencies[name];
   throw Error(`Unexpected dependency ${name} in ${file}`);
  }
 });return exports;
}
const routes=load('lib/public-booking-routes.ts');
function helper() {
 const calls=[];
 const api=load('lib/content-booking.ts',{
  '@/lib/beauty-media':{BEAUTY_MEDIA_BUCKET:'beauty-profile-media',getBeautyMediaPublicUrl:()=>null},
  '@/lib/public-booking-routes':routes,
  '@/lib/salon-profile':{getSalonProfileMediaUrl:path=>path?`https://media.example/${path}`:null},
  '@/lib/supabase/server':{getSupabaseConfig:()=>({supabaseUrl:'https://database.example'}),createSupabaseServerClient:()=>({rpc:async(name,args)=>{
   calls.push({name,args});return {error:null,data:[{content_id:args.target_content_ids?.[0]??id(500),salon_id:args.target_salon_ids[0],source_type:'salon_profile_look',content_type:'look',title:'Old post',booking_enabled:true,booking_cta_enabled:true,booking_href:`/booking/${args.target_salon_ids[0]}`,readiness_state:'service_ready',add_ons:[],additional_services:[]} ]};
  }})}
 });return {...api,calls};
}
test('known scalar and selected-array content identities use the exact RPC before PostgREST filtering',async()=>{
 const api=helper();
 const options=await api.loadPublicContentBookingOptions([id(1),id(1),'bad'],id(999));
 assert.equal(api.calls[0].name,'get_public_explore_content_booking_options');
 assert.deepEqual(Array.from(api.calls[0].args.target_salon_ids),[id(1)]);
 assert.deepEqual(Array.from(api.calls[0].args.target_content_ids),[id(999)]);
 assert.equal(options[0].contentId,id(999));
 assert.ok(options[0].bookingHref.includes(`inspiration=${id(999)}`));
 await api.loadPublicContentBookingOptions([id(1)],null,[id(998),id(998),id(997)]);
 assert.equal(api.calls[1].name,'get_public_explore_content_booking_options');
 assert.deepEqual(Array.from(api.calls[1].args.target_content_ids),[id(998),id(997)]);
});
test('invalid or empty exact selections cannot fall back into a salon-wide initial list',async()=>{
 const api=helper();
 for(const input of [[[id(1)],'invalid'],[[id(1)],null,[]],[[],id(1)],[[id(1)],null,Array.from({length:101},(_,i)=>id(i+1000))],[Array.from({length:101},(_,i)=>id(i+1)),id(999)]]) assert.equal((await api.loadPublicContentBookingOptions(...input)).length,0);
 assert.equal(api.calls.length,0);
 await api.loadPublicContentBookingOptions([id(1)]);
 assert.equal(api.calls[0].name,'get_public_content_booking_options','a caller without a selected post deliberately requests the capped initial list');
});
test('inspiration availability forwards only validated requested post IDs and rejects batches above12',async()=>{
 const calls=[],availability=[];
 const route=load('app/api/public-booking/inspiration-times/route.ts',{
  '@/lib/content-booking':{loadPublicContentBookingOptions:async(...args)=>{
   calls.push(args);return [{contentId:id(999),bookingEnabled:true,bookingCtaEnabled:true,readinessState:'quick_ready',primaryServiceId:id(100),creditedStaffId:id(200),additionalServices:[],addOns:[]}];
  }},
  '@/lib/public-booking':{loadPublicBookingAvailabilityHints:async input=>{availability.push(input);return [{key:id(999),label:'Request a time'}];}}
 });
 const request=input=>new Request('https://site.example/api/public-booking/inspiration-times',{method:'POST',body:JSON.stringify(input)});
 const response=await route.POST(request({salonId:id(1),contentIds:[id(999)]}));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 assert.equal(calls[0][1],null);assert.deepEqual(Array.from(calls[0][2]),[id(999)]);
 assert.deepEqual(Array.from(availability[0].scopes).map(row=>row.key),[id(999)]);
 assert.equal((await route.POST(request({salonId:id(1),contentIds:Array(13).fill(id(999))}))).status,400);
 assert.equal(calls.length,1);
});
test('legacy inspiration enriches only visible selected posts and keeps PostgreSQL cursor microseconds',async()=>{
 const bookings=[],rpcCalls=[];
 const timestamp='2026-10-09T12:00:00.123456+00:00';
 const rows=Array.from({length:13},(_,n)=>({content_id:id(1000+n),media_id:id(2000+n),salon_id:id(1),salon_name:'Salon',published_at:timestamp,content_type:'look',media_path:`post-${n}.webp`,booking_enabled:false}));
 const page=load('lib/explore-inspiration.ts',{
  '@/lib/salon-post-attribution':{loadSalonPostAttribution:async()=>new Map()},
  '@/lib/content-booking':{contentBookingOptionKey:input=>`${input.sourceType}:${input.contentId}`,loadPublicContentBookingOptions:async(...args)=>{bookings.push(args);return [];}},
  '@/lib/post-comments':{getPostCommentCounts:async()=>new Map(),getPostCommentCount:()=>0},
  '@/lib/account-social':{getAccountSavedPostCounts:async()=>new Map(),getAccountSavedPostStateKeys:async()=>new Set()},
  '@/lib/explore-decision-signals':{exploreFeedTrustFromDecisionSignals:()=>({}),getExploreDecisionSignalsBySalonId:async()=>new Map()},
  '@/lib/explore-salon-logos':{loadPublicSalonLogoPaths:async()=>new Map()},
  '@/lib/salon-operating-status':{getPublicSalonOperatingStatusesBySalonId:async()=>new Map(),operatingStatusFromMap:()=>({})},
  '@/lib/public-booking-routes':routes,
  '@/lib/salon-profile':{getSalonProfileMediaUrl:path=>path?`https://media.example/${path}`:null},
  '@/lib/supabase/server':{createSupabaseServerClient:()=>({rpc:async(name,args)=>{rpcCalls.push({name,args});return {data:rows,error:null};}})},
  '@/types/saved-post':{savedPostKey:input=>`${input.sourceType}:${input.sourceId}`}
 });
 const result=await page.getExploreInspirationPage({pageSize:12,cursor:{mediaId:id(900),publishedAt:timestamp},diversify:false});
 assert.equal(result.error,null);assert.equal(result.items.length,12);assert.equal(result.hasMore,true);
 assert.equal(rpcCalls[0].args.p_cursor_published_at,timestamp);
 assert.deepEqual(Array.from(bookings[0][2]),rows.slice(0,12).map(row=>row.content_id));
 assert.equal(bookings[0][1],null);assert.equal(result.nextCursor.publishedAt,timestamp);
});

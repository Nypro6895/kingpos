import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
test('profile post RPC salon links retain recipe identity for quick booking', {skip:!process.env.ESBUILD_MODULE_PATH},async()=>{
 const {build}=await import(pathToFileURL(process.env.ESBUILD_MODULE_PATH).href);
 const result=await build({entryPoints:['lib/content-booking.ts'],bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'deps',setup(b){b.onResolve({filter:/^(server-only|@\/lib\/(beauty-media|salon-profile|supabase\/server))$/},a=>({path:a.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const BEAUTY_MEDIA_BUCKET="beauty";export const getBeautyMediaPublicUrl=()=>null;export const getSalonProfileMediaUrl=()=>null;export const getSupabaseConfig=()=>null;export const createSupabaseServerClient=()=>null;',loader:'js'}));}}]});
 const {mapContentBookingOptionRow:map}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const salon='1650370b-f86d-461e-8d97-6210052eeed7',post='67626efb-2a98-419b-b2fa-d2fc3b998eaf';
 const row={content_id:post,salon_id:salon,source_type:'salon_profile_look',booking_href:`/booking/${salon}`,primary_service_id:salon,credited_staff_id:post};
 const mapped=map(row),url=new URL(mapped.bookingHref,'http://localhost');
 assert.equal(url.pathname,`/book/${salon}`);assert.equal(url.searchParams.get('inspiration'),post);assert.equal(mapped.primaryServiceId,salon);assert.equal(mapped.creditedStaffId,post);
 const exact=map({...row,booking_href:`/book/${salon}?date=2099-10-02&startAt=2099-10-02T16%3A00%3A00Z&source=explore`});
 assert.equal(new URL(exact.bookingHref,'http://localhost').searchParams.get('startAt'),'2099-10-02T16:00:00Z');
 assert.equal(map({...row,booking_href:null}).bookingHref,null);
});

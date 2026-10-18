import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {transformSync} from 'esbuild';

function load(file,deps={}) {const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(file,'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports,require:name=>deps[name]});return module.exports;}
const catalog=load('lib/nail-inspiration-catalog.ts');
const nails=load('lib/nail-inspiration.ts',{'@/lib/nail-inspiration-catalog':catalog});
const defaults=load('lib/default-nail-images.ts');
const media=load('lib/explore-search-media.ts',{'@/lib/default-nail-images':defaults,'@/lib/nail-inspiration':nails,'@/lib/salon-profile-media':load('lib/salon-profile-media.ts'),'@/lib/beauty-media':load('lib/beauty-media.ts'),'@/lib/salon-profile':{getSalonProfileMediaUrl:path=>path&&!path.includes('invalid')?'https://media.example/'+path:null}});
const row={salon_id:'00000000-0000-4000-8000-000000000001',salon_name:'Real Nails',service_categories:['Nails']};
const postPath=`${row.salon_id}/looks/00000000-0000-4000-8000-000000000011/post.webp`,coverPath=`${row.salon_id}/profile/cover/cover.webp`;
const own={...row,image_provenance:'salon_post',selected_media_salon_id:row.salon_id,selected_media_bucket:'salon-profile-media',selected_media_path:postPath,selected_content_key:'salon_profile_look:one',selected_content_id:'one',selected_content_type:'salon_profile_look'};

test('verified own post outranks a cover and catalog image, independently of claim state',()=>{
 for(const claimed of [false,true]) {
  const result=media.resolveExploreSearchMedia({...own,claimed,valid_cover_salon_id:row.salon_id,valid_cover_image_path:coverPath},'red');
  assert.equal(result.coverImageUrl,'https://media.example/'+postPath);assert.equal(result.imageProvenance,'salon_post');assert.equal(result.imageSourceSalonId,row.salon_id);assert.equal(result.selectedContentId,'one');
 }
});
test('missing or invalid post uses only an independently validated same-salon cover',()=>{
 const result=media.resolveExploreSearchMedia({...own,selected_media_path:'invalid',valid_cover_salon_id:row.salon_id,valid_cover_image_path:coverPath},'red');
 assert.equal(result.coverImageUrl,'https://media.example/'+coverPath);assert.equal(result.imageProvenance,'salon_cover');assert.equal(result.selectedContentId,null);
 for(const patch of [{selected_media_salon_id:'another'},{selected_media_bucket:'beauty-media'},{image_provenance:'suggested'},{selected_media_path:postPath.replace(row.salon_id,'00000000-0000-4000-8000-000000000002')}]) {
  const rejected=media.resolveExploreSearchMedia({...own,...patch,valid_cover_salon_id:'another',valid_cover_image_path:'other/cover.jpg'},'red');
  assert.equal(rejected.imageProvenance,'suggested');assert.equal(rejected.imageSourceSalonId,null);assert.equal(rejected.selectedContentKey,null);
 }
});
test('suggested image is deterministic and cannot become evidence of a matching salon post',()=>{
 const first=media.resolveExploreSearchMedia(row,'red',{shape:'square'}),again=media.resolveExploreSearchMedia(row,'red',{shape:'square'});
 assert.equal(first.coverImageUrl,again.coverImageUrl);assert.equal(first.imageProvenance,'suggested');assert.equal(first.imageSourceSalonId,null);assert.equal(first.selectedContentId,null);
 assert.equal('matchSource' in first,false);assert.equal('matchTier' in first,false);
});
test('fresh hydration replaces suggested with real media and removes withdrawn media in the same salon session',()=>{
 const before=media.resolveExploreSearchMedia(row,'red');const uploaded=media.resolveExploreSearchMedia({...own,media_revision:'v2'},'red');const withdrawn=media.resolveExploreSearchMedia({...row,media_revision:'v3'},'red');
 assert.equal(before.imageProvenance,'suggested');assert.equal(uploaded.imageProvenance,'salon_post');assert.equal(uploaded.mediaRevision,'v2');assert.equal(withdrawn.imageProvenance,'suggested');assert.equal(withdrawn.coverImageUrl,before.coverImageUrl);assert.equal(withdrawn.selectedContentId,null);
});

test('public attributed customer image requires current salon attribution and exact author-owned path and bucket',()=>{
 const author='00000000-0000-4000-8000-000000000501',path=`${author}/beauty/image/photo.webp`;
 const customer={...row,image_provenance:'customer_post',selected_media_salon_id:row.salon_id,selected_media_bucket:'beauty-profile-media',selected_media_author_user_id:author,selected_media_role:'image',selected_media_path:path,selected_content_key:'beauty_post:one',selected_content_id:'one',selected_content_type:'beauty_post'};
 const result=media.resolveExploreSearchMedia(customer,'red',{}, {supabaseUrl:'https://fixture.example'});
 assert.equal(result.coverImageUrl,'https://fixture.example/storage/v1/object/public/beauty-profile-media/'+path);assert.equal(result.imageProvenance,'customer_post');assert.equal(result.imageSourceSalonId,row.salon_id);assert.equal(result.selectedMediaBucket,'beauty-profile-media');assert.equal(result.selectedContentType,'beauty_post');
 for(const patch of [{selected_media_salon_id:'other'},{selected_media_author_user_id:'other'},{selected_media_path:path.replace('/image/','/cover/')},{selected_media_bucket:'salon-profile-media'},{selected_media_role:'after'},{selected_content_type:'salon_profile_look'}]) {
  const rejected=media.resolveExploreSearchMedia({...customer,...patch},'red',{}, {supabaseUrl:'https://fixture.example'});
  assert.equal(rejected.imageProvenance,'suggested');assert.equal(rejected.selectedContentKey,null);
 }
});

test('a related or broader recommendation keeps its real same-salon photo without claiming a style match',()=>{
 const result=media.resolveExploreSearchMedia({...own,is_reference_match:true,is_primary_match:false,recommendation_reason:'related_in_area',match_source:'category'},'unavailable style');
 assert.equal(result.coverImageUrl,'https://media.example/'+postPath);assert.equal(result.imageProvenance,'salon_post');assert.equal(result.imageSourceSalonId,row.salon_id);assert.equal(result.selectedContentId,'one');
 assert.equal('matchSource' in result,false);assert.equal('isPrimaryMatch' in result,false);
});

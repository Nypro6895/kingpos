import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';

const compiled=await build({entryPoints:['app/pos/settings/actions.ts'],bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'isolated-authority',setup(b){
 const mocks={
  '@/lib/current-context':`export const getCurrentBusinessContext=async()=>globalThis.fixture.context;export const isSalonManageContext=()=>globalThis.fixture.manage;`,
  '@/lib/permissions':`export const hasPermission=async()=>globalThis.fixture.allowed;`,
  '@/lib/pos-portable-access':`export const PORTABLE_POS_ACCESS_SETUP_MESSAGE='Setup required';`,
  '@/lib/pos-settings':`export const POS_DISPLAY_MEDIA_BUCKET='fixture-media';export const POS_SETTING_DEFAULTS={};export const getCurrentSalonPosSettings=async()=>({customerBackgroundImageUrl:null});`,
  '@/lib/pos-tickets':`export const POS_TICKET_PERMISSIONS={manage:'tickets.manage'};`,
  '@/lib/supabase/server':`export const createAuthenticatedSupabaseServerClient=async()=>globalThis.fixture.client;`,
  'next/cache':`export const revalidatePath=()=>{};`,
  'next/navigation':`export const redirect=url=>{throw Error('REDIRECT:'+url)};`,
 };
 b.onResolve({filter:/.*/},a=>a.path in mocks?{path:a.path,namespace:'authority'}:undefined);
 b.onLoad({filter:/.*/,namespace:'authority'},a=>({contents:mocks[a.path]}));
}}]});
const module={exports:{}};new Function('require','module','exports',compiled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {loadDeviceDisplayAppearance,savePosSettingsGroup}=module.exports;
function fixture(){const calls=[];globalThis.fixture={context:{user:{id:'owner'},currentSalon:{id:'salon'}},allowed:true,manage:true,client:{from(){calls.push('read');return{select(){return{eq(){return{maybeSingle:async()=>({data:{customer_left_ad_text:'Previous'},error:null})}}}}}},rpc:async(name,input)=>{calls.push({name,input});return{data:input.p_values,error:null}}}};return calls;}

test('appearance reads deny unsigned users, wrong salons and users without settings permission',async()=>{
 let calls=fixture();globalThis.fixture.context.user=null;assert.match((await loadDeviceDisplayAppearance('salon')).error,/Sign in/);assert.equal(calls.length,0);
 calls=fixture();globalThis.fixture.allowed=false;assert.match((await loadDeviceDisplayAppearance('salon')).error,/Sign in/);assert.equal(calls.length,0);
 calls=fixture();assert.match((await loadDeviceDisplayAppearance('other-salon')).error,/Choose this salon/);assert.equal(calls.length,0);
 calls=fixture();const result=await loadDeviceDisplayAppearance('salon');assert.equal(result.salonId,'salon');assert.ok(result.settings);assert.deepEqual(calls,['read']);
});
test('appearance writes preserve checkout/privacy fields and validate current salon before uploading',async()=>{
 const calls=fixture(),form=new FormData();form.set('group','appearance');form.set('salon_id','other-salon');form.set('expected','{}');assert.equal((await savePosSettingsGroup(form)).ok,false);assert.equal(calls.length,0);
 form.set('salon_id','salon');form.set('expected',JSON.stringify({customer_background_image_path:'salon/background.png',customer_left_ad_image_path:null,customer_right_ad_image_path:null}));form.set('customer_left_ad_text','A'.repeat(200));form.set('customer_right_ad_text','B'.repeat(600));const result=await savePosSettingsGroup(form);assert.equal(result.ok,true);
 const saved=calls.find(c=>typeof c==='object');assert.equal(saved.name,'save_pos_workspace_settings');assert.equal(saved.input.p_salon,'salon');assert.equal(saved.input.p_values.customer_background_image_path,'salon/background.png');assert.equal(saved.input.p_values.customer_left_ad_text.length,160);assert.equal(saved.input.p_values.customer_right_ad_text.length,500);assert.deepEqual(Object.keys(saved.input.p_values).sort(),['customer_background_image_path','customer_left_ad_image_path','customer_right_ad_image_path','customer_left_ad_text','customer_right_ad_text'].sort());
});
test('appearance mutation keeps existing owner permission gate',async()=>{
 const calls=fixture();globalThis.fixture.allowed=false;const form=new FormData();form.set('group','appearance');form.set('salon_id','salon');await assert.rejects(savePosSettingsGroup(form),/REDIRECT/);assert.equal(calls.length,0);
});

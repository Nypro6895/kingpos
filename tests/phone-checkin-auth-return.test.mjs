import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

async function load(entry,stubs){
 const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'node',format:'esm',jsx:'transform',jsxFactory:'h',banner:{js:'const h=(type,props,...children)=>({type,props:{...props,children}});'},plugins:[{name:'boundaries',setup(b){
  b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'stub'}:undefined);
  b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path]}));
 }}]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
const entry='00000000-0000-4000-8000-000000000111';
const common={
 '@/components/experience-page':'export const withExperiencePage=page=>page;',
 'next/navigation':'export const redirect=path=>{throw {redirect:path}};export const notFound=()=>{throw {notFound:true}};',
};
test('salon QR sends every guest into account check-in and preserves the exact entry through login/signup',async()=>{
 const {default:page}=await load('app/check-in/[entry]/page.tsx',{
  ...common,'@/lib/supabase/server':'export const createSupabaseServerClient=()=>({rpc:async()=>({data:{salonName:"Salon"},error:null})});',
 });
 await assert.rejects(()=>page({params:Promise.resolve({entry})}),error=>error.redirect===`/qr?entry=${entry}`);
 const {default:qr}=await load('app/(app)/qr/page.tsx',{
  ...common,'@/lib/users/current-user':'export const getCurrentKingUser=async()=>globalThis.phoneQrUser;',
  '@/app/qr/actions':'export const loadPersonalQr=async()=>({data:{userId:"user"}});export const loadPersonalQrCatalog=async()=>({catalog:{salonName:"Salon",services:[]}});',
  '@/app/qr/personal-qr-client':'export const PersonalQrClient=()=>null;',
 });
 globalThis.phoneQrUser=null;
 try{
  let login;
  try{await qr({searchParams:Promise.resolve({entry})});}catch(error){login=error.redirect;}
  assert.equal(new URL(login,'https://reylumi.com').searchParams.get('next'),`/qr?entry=${entry}`);
  const {signupPhonePath,resumeSignupPhonePath}=await load('lib/signup-phone-routing.ts',{});
  const onboarding=signupPhonePath(`/qr?entry=${entry}`);
  assert.equal(new URL(onboarding,'https://reylumi.com').searchParams.get('next'),`/qr?entry=${entry}`);
  assert.equal(resumeSignupPhonePath({user_metadata:{signup_phone:'+15035550100'}},onboarding),onboarding);
  globalThis.phoneQrUser={id:'user',display_name:'Nene'};
  const view=await qr({searchParams:Promise.resolve({entry})});
  assert.equal(view.props.entry,entry);assert.equal(view.props.viewerId,'user');assert.equal(view.props.customerName,'Nene');assert.equal(view.props.initialCatalog.salonName,'Salon');
 }finally{delete globalThis.phoneQrUser;}
});

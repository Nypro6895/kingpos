import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
test('non-authorize booking-deposit read reports the fixed Auth availability message and performs no feature read',async()=>{
 const boundaries={
  'server-only':'','next/headers':'export async function cookies(){return {get(){}}}',
  'next/cache':'export function revalidatePath(){}',
  '@/lib/current-context':`export async function getCurrentBusinessContext(){return {user:{id:'synthetic'},currentSalon:{id:'synthetic-salon',status:'active'},currentMembership:{}}}export const isOwnerMembership=()=>true,isSalonManageContext=()=>true;`,
  '@/lib/supabase/server':`import {AuthAvailabilityError} from '@/lib/supabase/auth-rest';export async function createAuthenticatedSupabaseServerClient(options){if(options?.throwOnUnavailable)throw new AuthAvailabilityError('Account status');return null;}`,
  '@/lib/booking-deposit':`export async function bookingDepositState(){throw Error('Feature data must not be read without account verification');}`,
  '@/lib/booking-deposit-subscription':'export async function bookingDepositPayment(){throw Error("No payment allowed in this test")}',
  '@/lib/settings-target-context':'export async function withSettingsTarget(target,work){return work()}',
  '@/lib/reylumi-config':'export const REYLUMI_METADATA_BASE=new URL("https://example.invalid");'
 };
 const result=await build({entryPoints:['app/market/booking-deposit-actions.ts'],bundle:true,write:false,platform:'node',format:'esm',alias:{'@':process.cwd()},plugins:[{name:'availability-io-boundaries',setup(b){b.onResolve({filter:/.*/},a=>Object.hasOwn(boundaries,a.path)?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:boundaries[a.path],resolveDir:process.cwd()}));}}]});
 const {loadBookingDepositAction}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 const resultValue=await loadBookingDepositAction();assert.deepEqual(resultValue,{error:'Account status temporarily unavailable'});assert.equal(Object.hasOwn(resultValue,'state'),false);
});

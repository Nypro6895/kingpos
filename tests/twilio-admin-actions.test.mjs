import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
let source=readFileSync(new URL('../app/(app)/admin/settings/twilio/actions.ts',import.meta.url),'utf8');
source=source.replace(/^import .*;$/gm,'');
source=`
const notFound=()=>{throw new Error('Access denied')};
const revalidatePath=()=>{};
const PLATFORM_ADMIN_PERMISSIONS={teamManage:'admin.team.manage'};
const requirePlatformAdmin=async()=>globalThis.twilioTest.actor;
const getTwilioSettings=async()=>({authToken:'a'.repeat(32)});
const testTwilioConnection=async(c)=>{globalThis.twilioTest.checked=c;return 'Reylumi'};
const encryptTwilioSettings=()=> 'encrypted';
const publicTwilioSettings=({authToken,...safe})=>safe;
const twilioSettingsClient=()=>({rpc:async(name,params)=>{globalThis.twilioTest.saved={name,params};return {error:null}}});
`+source;
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const actions=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('admin saves encrypted settings, preserves blank token, and tests without saving',async()=>{
 globalThis.twilioTest={actor:{roleSlug:'platform_owner',userId:'owner'}};
 const form=new FormData();form.set('accountSid','AC'+'1'.repeat(32));form.set('verifyServiceSid','VA'+'2'.repeat(32));form.set('enabled','on');form.set('claimSms','on');
 try{
 let result=await actions.saveTwilioSettingsAction({},form);assert.equal(result.ok,true);
 assert.equal(globalThis.twilioTest.checked.authToken,'a'.repeat(32));
 assert.equal(globalThis.twilioTest.saved.params.p_encrypted,'encrypted');
 assert.equal(globalThis.twilioTest.saved.params.p_actor,'owner');
 assert.ok(!('authToken' in globalThis.twilioTest.saved.params.p_public));
 globalThis.twilioTest.saved=null;form.set('intent','test');
 result=await actions.saveTwilioSettingsAction({},form);assert.equal(result.ok,true);assert.equal(globalThis.twilioTest.saved,null);
 form.set('accountSid','bad');result=await actions.saveTwilioSettingsAction({},form);assert.equal(result.ok,false);
 globalThis.twilioTest.actor.roleSlug='support_agent';await assert.rejects(actions.saveTwilioSettingsAction({},form),/Access denied/);
 }finally{delete globalThis.twilioTest;}
});

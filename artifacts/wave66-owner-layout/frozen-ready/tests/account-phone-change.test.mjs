import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const root='artifacts/ios-personal-settings-20261029';
test('phone-change proof fails closed and is bound to user, old phone, new phone and expiration',async()=>{
 globalThis.__phoneCookies=new Map();process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-signing-key';
 const output=await build({entryPoints:['lib/account-phone-change.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'cookie-fixture',setup(b){b.onResolve({filter:/^server-only$|^next\/headers$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='server-only'?'':`export const cookies=async()=>({get:name=>({value:globalThis.__phoneCookies.get(name)}),set:(name,value)=>globalThis.__phoneCookies.set(name,value)});`}));}}]});
 mkdirSync(root,{recursive:true});writeFileSync(root+'/proof-fixture.mjs',output.outputFiles[0].text);const m=await import(pathToFileURL(path.resolve(root+'/proof-fixture.mjs')));
 const user={id:'user',auth_user_id:'auth',phone:'+14145550100'},next='+14145550200';
 assert.equal(await m.phoneChangeAuthorized(user,next),false);assert.equal(await m.phoneChangeAuthorized(user,null),false);assert.equal(await m.phoneChangeAuthorized(user,user.phone),true);assert.equal(await m.phoneChangeAuthorized({...user,phone:null},next),true);
 await m.writePhoneChangeProof(user,next,false);assert.equal(await m.phoneChangeAuthorized(user,next),false);
 await m.writePhoneChangeProof(user,next,true);assert.equal(await m.phoneChangeAuthorized(user,next),true);assert.equal(await m.phoneChangeAuthorized({...user,id:'other'},next),false);assert.equal(await m.phoneChangeAuthorized({...user,phone:'+14145550300'},next),false);assert.equal(await m.phoneChangeAuthorized(user,'+14145550400'),false);assert.equal(await m.phoneChangeAuthorized({...user,auth_user_id:'other-auth'},next),false);
 const value=globalThis.__phoneCookies.get('account-phone-change');globalThis.__phoneCookies.set('account-phone-change',value.slice(0,-4)+'xxxx');assert.equal(await m.phoneChangeAuthorized(user,next),false);globalThis.__phoneCookies.set('account-phone-change',value);
 const original=Date.now;try{Date.now=()=>original()+11*60*1000;assert.equal(await m.phoneChangeAuthorized(user,next),false);}finally{Date.now=original;}
 delete process.env.SUPABASE_SERVICE_ROLE_KEY;assert.equal(await m.phoneChangeAuthorized(user,next),false);
});
test('all profile-phone entry points enforce email authorization before SMS verification or database changes',()=>{
 const source=readFileSync('app/account/actions.ts','utf8');
 for(const fn of ['updateAccountProfileAction','sendAccountPhoneVerificationOtpAction','verifyAccountPhoneOtpAction']){
 const part=source.split('export async function '+fn)[1].split('\nexport async function ')[0];assert.match(part,/phoneChangeAuthorized\(/);
 }
});
test('phone-change email delivery and verification use server identity and never grant on provider failure',async()=>{
 const state=globalThis.__phoneAction={user:{id:'u',auth_user_id:'a',email:'owner@example.com',phone:'+14145550100'},proof:null,steps:[],configured:true,providerError:false,providerUser:'a'};
 const output=await build({entryPoints:['app/account/phone-change-actions.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'auth-fixtures',setup(b){
 b.onResolve({filter:/abuse-server$|\/email$|current-user$|supabase\/server$|account-phone-change$|^@supabase\/supabase-js$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({contents:`const s=globalThis.__phoneAction;`+(p.endsWith('abuse-server')?`export async function assertAbuseRequest(action,email){s.steps.push({action,email})}export const abuseServiceClient=()=>({auth:{admin:{generateLink:async({email})=>{s.steps.push({generate:email});return {data:{user:{id:s.providerUser},properties:{email_otp:'123456'}},error:s.providerError?{}:null}}}}});`:p.endsWith('/email')?`export const isEmailProviderConfigured=()=>s.configured;export async function sendEmail(payload){s.steps.push({email:payload.to,text:payload.text});return {status:s.providerError?'failed':'sent'}}`:p.endsWith('current-user')?`export const getCurrentKingUser=async()=>s.user;`:p.endsWith('supabase/server')?`export const getSupabaseConfig=()=>({supabaseUrl:'https://fixture.test',supabaseAnonKey:'fixture'});`:p.endsWith('account-phone-change')?`export const readPhoneChangeProof=async(user,phone)=>s.proof?.phone===phone?s.proof:null;export async function writePhoneChangeProof(user,phone,verified){s.proof={phone,verified};s.steps.push({grant:verified})}`:`export const createClient=()=>({auth:{verifyOtp:async payload=>{s.steps.push({verify:payload});return {data:{user:{id:s.providerUser}},error:s.providerError?{}:null}}}});`)}));
 }}]});
 writeFileSync(root+'/phone-action-fixture.mjs',output.outputFiles[0].text);const {authorizePhoneChangeAction:run}=await import(pathToFileURL(path.resolve(root+'/phone-action-fixture.mjs')));
 assert.deepEqual(await run({phone:'+14145550200'}),{error:null,sent:true});assert.equal(state.proof.verified,false);assert.equal(state.steps.find(x=>x.generate).generate,'owner@example.com');assert.match(state.steps.find(x=>x.text).text,/123456/);
 assert.deepEqual(await run({phone:'+14145550200',code:'123456'}),{error:null,verified:true});assert.equal(state.proof.verified,true);
 state.proof=null;assert.ok((await run({phone:'+14145550200',code:'123456'})).error);assert.equal(state.proof,null);
 state.providerUser='someone-else';assert.ok((await run({phone:'+14145550200'})).error);assert.equal(state.proof.verified,false);
 state.providerUser='a';state.providerError=true;assert.ok((await run({phone:'+14145550200',code:'123456'})).error);assert.equal(state.proof.verified,false);
 state.user=null;assert.ok((await run({phone:'+14145550200'})).error);
});

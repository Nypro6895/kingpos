import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../lib/business-claim-provider.ts',import.meta.url),'utf8').replace("import 'server-only';",'').replace("import {getTwilioSettings} from '@/lib/twilio-settings';",`const getTwilioSettings=async()=>({accountSid:process.env.REYLUMI_TWILIO_ACCOUNT_SID,authToken:process.env.REYLUMI_TWILIO_AUTH_TOKEN,verifyServiceSid:process.env.REYLUMI_TWILIO_VERIFY_SERVICE_SID,enabled:true,claimSms:true,claimVoice:true});`);
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const provider=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('Twilio Verify sends SMS or call to the stored phone and checks the bound verification SID',async()=>{
 const keys=['REYLUMI_TWILIO_ACCOUNT_SID','REYLUMI_TWILIO_AUTH_TOKEN','REYLUMI_TWILIO_VERIFY_SERVICE_SID','SUPABASE_SERVICE_ROLE_KEY'];
 const previous=keys.map(key=>process.env[key]);const originalFetch=global.fetch;
 try {
 keys.forEach((key,index)=>process.env[key]=['AC-fixture','test-token','VA-fixture','server-test'][index]);
 const calls=[];global.fetch=async(url,init)=>{calls.push({url,body:init.body});return Response.json({sid:'VE-fixture',status:'pending'});};
 assert.equal(await provider.businessClaimMessagingReady(),true);
 for(const channel of ['sms','call']){
 assert.equal(await provider.sendBusinessClaimCode('+15552346789',channel),'VE-fixture');
 assert.equal(calls.at(-1).body.get('To'),'+15552346789');assert.equal(calls.at(-1).body.get('Channel'),channel);
 }
 global.fetch=async(url,init)=>{calls.push({url,body:init.body});return Response.json({sid:'VE-fixture',status:'approved'});};
 assert.equal(await provider.checkBusinessClaimCode('VE-fixture','123456'),true);
 assert.equal(calls.at(-1).body.get('VerificationSid'),'VE-fixture');assert.equal(calls.at(-1).body.has('To'),false);
 global.fetch=async()=>Response.json({sid:'VE-other',status:'approved'});
 assert.equal(await provider.checkBusinessClaimCode('VE-fixture','123456'),false);
 global.fetch=async()=>Response.json({sid:'VE-fixture',status:'pending'});
 assert.equal(await provider.checkBusinessClaimCode('VE-fixture','999999'),false);
 global.fetch=async()=>Response.json({code:60200},{status:400});
 await assert.rejects(provider.sendBusinessClaimCode('+15552346789','sms'),/phone call or request support/);
 delete process.env.REYLUMI_TWILIO_VERIFY_SERVICE_SID;
 assert.equal(await provider.businessClaimMessagingReady(),false);
 }finally{
 global.fetch=originalFetch;keys.forEach((key,index)=>previous[index]===undefined?delete process.env[key]:process.env[key]=previous[index]);
 }
});

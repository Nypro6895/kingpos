import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import ts from 'typescript';
const source=readFileSync(new URL('../lib/twilio-settings.ts',import.meta.url),'utf8').replace("import 'server-only';",'').replace("import {createClient} from '@supabase/supabase-js';",'const createClient=()=>{throw new Error("Database unavailable")};');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const settings=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('settings encryption authenticates ciphertext and public metadata never includes token',()=>{
 const old=process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY;
 try {
 process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 const config={accountSid:'AC-test',authToken:'secret-token',verifyServiceSid:'VA-test',messagingServiceSid:'',from:'',enabled:true,claimSms:true,claimVoice:true};
 const encrypted=settings.encryptTwilioSettings(config);
 assert.ok(!encrypted.includes(config.authToken));assert.deepEqual(settings.decryptTwilioSettings(encrypted),config);
 assert.ok(!('authToken' in settings.publicTwilioSettings(config)));
 assert.notEqual(settings.encryptTwilioSettings(config),encrypted);
 process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY=randomBytes(32).toString('base64');
 assert.throws(()=>settings.decryptTwilioSettings(encrypted));
 }finally{if(old===undefined)delete process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY;else process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY=old;}
});
test('database failures do not fall back to environment credentials',async()=>{
 const previous=process.env.SUPABASE_SERVICE_ROLE_KEY;process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';
 try{await assert.rejects(settings.getTwilioSettings());}finally{if(previous===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previous;}
});
test('connection check rejects unsafe voice configuration without sending codes',async()=>{
 const original=global.fetch;const calls=[];
 const config={accountSid:'AC-test',authToken:'token',verifyServiceSid:'VA-test',claimVoice:true};
 try{
 global.fetch=async(url,init)=>{calls.push({url,init});return Response.json({friendly_name:'Reylumi',code_length:6,dtmf_input_required:false});};
 await assert.rejects(settings.testTwilioConnection(config),/keypad/);
 global.fetch=async()=>Response.json({friendly_name:'Reylumi',code_length:6,dtmf_input_required:true});
 assert.equal(await settings.testTwilioConnection(config),'Reylumi');
 assert.ok(calls[0].url.endsWith('/Services/VA-test'));assert.equal(calls[0].init.method,undefined);
 }finally{global.fetch=original;}
});

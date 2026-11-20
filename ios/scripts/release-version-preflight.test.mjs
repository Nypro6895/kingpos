import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {assessVersion,compareVersions,preflight} from './release-version-preflight.mjs';
test('higher TestFlight builds do not impersonate an App Store approval',()=>{
 const result=assessVersion('1.0.0',[{version:'1.0.0',state:'PREPARE_FOR_SUBMISSION'}],[{version:'1.1.0',build:'32.1'}]);
 assert.equal(result.eligibleForUpload,true);assert.equal(result.nextBuild,'33');
});
test('approved but unreleased versions still prevent a lower upload',()=>{
 for(const state of ['PENDING_DEVELOPER_RELEASE','READY_FOR_DISTRIBUTION','READY_FOR_SALE','REPLACED_WITH_NEW_VERSION'])assert.equal(assessVersion('1.0.0',[{version:'1.1.0',state}],[]).eligibleForUpload,false);
 assert.equal(assessVersion('1.1.1',[{version:'1.1.0',state:'READY_FOR_SALE'}],[]).eligibleForUpload,true);
});
test('numeric version comparison and upload retry choose an unused integer',()=>{
 assert.equal(compareVersions('1.10','1.9.9'),1);assert.equal(compareVersions('1.0','1.0.0'),0);
 assert.equal(assessVersion('1.0.0',[],[{build:'33'},{build:'32.9'}]).nextBuild,'34');
 assert.throws(()=>compareVersions('not-a-version','1'));assert.throws(()=>assessVersion('1.0',[],[{build:'9999'}]));
});
test('audit uses GET only and restricts pagination to the Apple API',async()=>{
 const {privateKey}=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'});
 const env={APP_STORE_CONNECT_APP_ID:'123',EXPECTED_MARKETING_VERSION:'1.0.0',APP_STORE_CONNECT_PRIVATE_KEY:privateKey,APP_STORE_CONNECT_KEY_ID:'fixture',APP_STORE_CONNECT_ISSUER_ID:'fixture'};
 const calls=[];const result=await preflight(env,async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({data:[]}));});
 assert.equal(result.eligibleForUpload,true);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.options.method==='GET'&&c.options.redirect==='error'));
 await assert.rejects(preflight(env,async()=>new Response(JSON.stringify({data:[],links:{next:'https://example.com'}}))),/Unsupported/);
});

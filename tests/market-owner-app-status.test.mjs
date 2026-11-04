import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const compiled = await build({entryPoints:['lib/market-platform/owner-app-status.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {ownerAppStatus:status} = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const version = (id, number, extra={}) => ({id,app_id:'app-a',version:number,entitled:true,connectionReady:true,...extra});
const old=version('v1','1.9.0'),latest=version('v2','1.10.0');
const installed={id:'i1',appId:'app-a',versionId:'v1',state:'active',usable:true,connectionReady:true};
test('an unpaid newer version does not block access to the usable installed version',()=>{
 const paid=version('v2','1.10.0',{entitled:false});const result=status(paid,installed,[old,paid]);
 assert.equal(result.canOpen,true);assert.equal(result.update.id,'v2');assert.equal(result.kind,'installed');
});
test('newer versions are compared numerically and never taken from another app',()=>{
 assert.equal(status(old,installed,[old,latest,version('foreign','99.0.0',{app_id:'other'})]).update.id,'v2');
 assert.equal(status(latest,{...installed,versionId:'v2'},[old,latest]).update,null);
});
test('missing installed catalog evidence never implies the latest version is installed or openable',()=>{
 const result=status(latest,installed,[latest]);assert.equal(result.kind,'access-blocked');assert.equal(result.canOpen,false);assert.equal(result.update,null);
});
test('revoked and foreign installations do not grant installed status',()=>{
 for(const row of [{...installed,state:'revoked'},{...installed,appId:'other'}])assert.equal(status(old,row,[old]).kind,'available');
 assert.equal(status({...old,entitled:false},undefined,[old]).kind,'payment-required');
});
test('either missing credential observation prevents opening without claiming a host outage',()=>{
 for(const [v,i] of [[{...old,connectionReady:false},installed],[old,{...installed,connectionReady:false}]]){
  const result=status(v,i,[v]);assert.equal(result.kind,'setup-required');assert.equal(result.canOpen,false);
 }
 assert.equal(status(old,{...installed,usable:false},[old]).kind,'access-blocked');
});

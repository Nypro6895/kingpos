import test from 'node:test';import assert from 'node:assert/strict';
import {assertLoopbackUrl,assertOwnedKioskDatabase} from './kiosk-local-target.mjs';
test('local-only E2E refuses external, credentialed and malformed targets',()=>{
 for(const url of ['https://reylumi.com','http://127.0.0.1.example.com','file:///C:/test','http://user:pass@localhost:3000','http://localhost:3000/other'])assert.throws(()=>assertLoopbackUrl(url));
 for(const url of ['http://127.0.0.1:3000','http://localhost:3000','http://[::1]:3000'])assert.equal(assertLoopbackUrl(url),url);
});
test('local-only E2E refuses another task, shared/unisolated or stopped database',()=>{
 const scope='00000000-0000-4000-8000-000000000001';
 const valid={State:{Running:true},Config:{Labels:{'com.codex.task':scope,'com.reylumi.qa-purpose':'kiosk-e2e'}},HostConfig:{NetworkMode:'none',PortBindings:{}}};
 assert.doesNotThrow(()=>assertOwnedKioskDatabase(valid,scope));
 for(const change of [{State:{Running:false}},{Config:{Labels:{'com.codex.task':'market'}}},{HostConfig:{NetworkMode:'bridge'}},{HostConfig:{NetworkMode:'none',PortBindings:{'5432/tcp':[{HostIp:'0.0.0.0'}]}}}])assert.throws(()=>assertOwnedKioskDatabase({...valid,...change},scope));
});

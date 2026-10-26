import assert from 'node:assert/strict';
export function assertLoopbackUrl(value) {
 const url=new URL(value);
 assert.ok(['http:','https:'].includes(url.protocol),'HTTP(S) local URL required');
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Kiosk E2E rejects non-loopback URLs');
 assert.ok(!url.username&&!url.password,'URL credentials are not allowed');
 assert.ok(url.pathname==='/'&&!url.search&&!url.hash,'Use a loopback origin, not an arbitrary route');
 return url.origin;
}
export function assertOwnedKioskDatabase(meta,scope,networkInternal=false) {
 assert.match(scope,/^[0-9a-f-]{36}$/i,'Dedicated fixture scope is required');
 assert.equal(meta.State?.Running,true,'Dedicated kiosk database must already be running');
 assert.equal(meta.Config?.Labels?.['com.codex.task'],scope,'Database belongs to another task');
 assert.equal(meta.Config?.Labels?.['com.reylumi.qa-purpose'],'kiosk-e2e','Dedicated kiosk E2E database required');
 assert.ok(meta.HostConfig?.NetworkMode==='none'||networkInternal,'Database network must be isolated');
 for(const bindings of Object.values(meta.HostConfig?.PortBindings??{}))for(const b of bindings??[])assert.ok(['127.0.0.1','::1'].includes(b.HostIp),'Only loopback published ports allowed');
}

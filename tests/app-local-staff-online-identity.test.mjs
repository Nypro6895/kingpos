import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({entryPoints:['lib/app-local-staff-online-access.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {appLocalStaffOnlineIdentity:identity}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const viewer='00000000-0000-4000-8000-000000000001',salon='00000000-0000-4000-8000-000000000002',staff='00000000-0000-4000-8000-000000000003',scope='v3:'+'a'.repeat(64),now=Date.now();
const fixture=()=>({schemaVersion:1,context:{authenticated:true,viewerId:viewer,salonId:salon,scope,permissionRevision:'r1'},grant:null,grantStatus:503,offlineState:'online-only',access:{staffWorkspace:true},onlineValidatedAt:now,staffOnlineAccess:{version:1,staffId:staff,viewerId:viewer,salonId:salon,scope}});
const options={path:'/staff/my-work',online:true,now};
test('fresh admitted online proof supplies only the already verified foreground staff identity',()=>{
 assert.deepEqual(identity(fixture(),options),{resourceScope:scope,staffId:staff,salonId:salon});assert(identity(fixture(),{...options,path:'/staff/appointments?date=2026-10-27'}));
 for(const path of ['/staff/workday','/staff/today','/settings','/staff/my-work/other'])assert.equal(identity(fixture(),{...options,path}),null);
});
test('offline, expired, denied and crossed account/salon/scope proofs cannot replace identity resolution',()=>{
 const changes=[x=>x.offline=true,x=>x.onlineValidatedAt=now-30000,x=>x.onlineValidatedAt=now+60001,x=>x.grantStatus=403,x=>x.offlineState='unconfirmed',x=>x.context.authenticated=false,x=>x.access.staffWorkspace=false,x=>x.staffOnlineAccess.viewerId=staff,x=>x.staffOnlineAccess.salonId=viewer,x=>x.staffOnlineAccess.scope='v3:'+'b'.repeat(64),x=>x.staffOnlineAccess.staffId='invalid'];
 for(const change of changes){const v=fixture();change(v);assert.equal(identity(v,options),null);}
 assert.equal(identity(fixture(),{...options,online:false}),null);
});

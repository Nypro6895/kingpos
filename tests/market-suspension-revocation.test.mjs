import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {setup,hash,raw} from './helpers/market-retry-fixture.mjs';import {contextId as id} from './helpers/market-context-fixture.mjs';
for(const real of [false,true])test(`suspend/restore never revives ${real?'Owner':'synthetic'} grants, codes or encrypted receipts`,async t=>{
 const f=await setup(t,real),a=f.attempt();await f.rpc('refresh_client_retry',a.args);
 const code=raw('rma_'),verifier='v'.repeat(43),auth={p_installation:f.installation,p_client:f.v.app_id,p_code_hash:hash(code),p_challenge:createHash('sha256').update(verifier).digest('base64url')};
 await f.actor(real?1:4);await f.rpc(real?'authorize':'sandbox_authorize',real?{...auth,p_salon:id('4',1)}:auth);
 await f.actor(4);await f.rpc('moderate',{p_app:f.v.app_id,p_active:false,p_reason:'Incident response revocation'});
 await assert.rejects(f.rpc('moderate',{p_app:f.v.app_id,p_active:true,p_reason:'Developer cannot restore'}));
 await f.actor(3);await f.rpc('moderate',{p_app:f.v.app_id,p_active:true,p_reason:'Independent restoration'});
 await f.anon();for(const access of [f.access,a.pair.access])await assert.rejects(f.rpc('runtime',{p_token:access}));
 await assert.rejects(f.rpc('refresh_client_retry',a.args));await assert.rejects(f.rpc('refresh_client',{p_client:f.v.app_id,p_client_secret:f.secret,p_refresh_token:a.pair.refresh,p_access_hash:hash(raw('rmp_')),p_refresh_hash:hash(raw('rmr_'))}));
 const exchange=()=>f.rpc('exchange_code',{p_client:f.v.app_id,p_client_secret:f.secret,p_code:code,p_verifier:verifier,p_access_hash:hash(raw('rmp_')),p_refresh_hash:hash(raw('rmr_'))});await assert.rejects(exchange());
 await f.actor(real?1:4);if(real){await assert.rejects(f.rpc('connection_start',{p_salon:id('4',1),p_installation:f.installation}));await f.rpc('install',{p_salon:id('4',1),p_version:f.v.id,p_sha256:f.v.sha256,p_scopes:f.v.manifest.scopes});}else{await assert.rejects(f.rpc('sandbox_connection_start',{p_version:f.v.id}));await f.rpc('sandbox',{p_version:f.v.id,p_token_hash:hash(raw('rmp_'))});}
 await f.rpc(real?'authorize':'sandbox_authorize',real?{...auth,p_salon:id('4',1)}:auth);await f.anon();assert.ok(await exchange());
 // A fresh connection still cannot make an old encrypted retry receipt current.
 await assert.rejects(f.rpc('refresh_client_retry',a.args));
});

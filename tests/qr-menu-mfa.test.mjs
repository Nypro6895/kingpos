import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {mfaFixture,cookieValue,id} from './helpers/qr-mfa-fixture.mjs';

async function pendingFlow(t){const f=await mfaFixture(t),login=await f.login();assert.equal(login.status,303);assert.equal(login.headers.get('location'),'/mfa');assert.equal(cookieValue(login,'__Host-qr_app'),undefined);return {...f,pending:cookieValue(login,'__Host-qr_mfa')};}
async function challenge(f,origin=f.base){const page=await f.view(f.pending,origin);assert.equal(page.response.status,200);const response=await f.post(f.pending,page,'challenge',{factor:id(20)},origin);assert.equal(response.status,303);return f.view(f.pending,origin);}

test('enrolled TOTP requires MFA before any full session; factor select/verify resumes across app restarts and keeps EN/VI',async t=>{
 const f=await pendingFlow(t);assert.equal((await f.db.query('select count(*)::int n from qr_menu_private.qr_auth_sessions')).rows[0].n,0);
 assert.equal((await fetch(f.base+'/manage',{headers:{cookie:f.pending,Authorization:'Bearer self-claimed-aal2','x-user-id':id(10)}})).status,403);assert.equal(f.state.marketCalls,0);
 const vi=await f.view(f.pending,f.base,'vi');assert.ok(vi.html.includes('Xác minh đăng nhập'),'Vietnamese factor selector is rendered');assert.ok(!vi.html.includes('name="code"'),'GET never starts a challenge');assert.equal(f.state.challengeCalls,0);
 const page=await challenge(f),restarted=await f.start(),afterRestart=await f.view(f.pending,restarted);assert.ok(afterRestart.html.includes('name="code"'),'Existing challenge survives app restart');assert.equal(f.state.challengeCalls,1);
 const verified=await f.post(f.pending,afterRestart,'verify',{code:f.state.otp},restarted);assert.equal(verified.status,303);const app=cookieValue(verified,'__Host-qr_app');assert.ok(app,'A full opaque session is issued only after verify');
 const saved=await f.row(f.pending);assert.equal(saved.phase,'consumed');assert.equal(saved.envelope,null);assert.equal(f.state.otpPersisted,false);
 const replay=await f.post(f.pending,page,'verify',{code:f.state.otp});assert.equal(replay.status,403);assert.equal(f.state.verifyCalls,1);
 const launch='/connect?'+new URLSearchParams({reylumi_client_id:id(1),reylumi_installation:id(3),reylumi_authorize_url:f.target.marketOrigin+'/api/market-platform/authorize'});
 const connected=await fetch(restarted+launch,{headers:{cookie:app},redirect:'manual'});assert.equal(connected.status,303);assert.ok(connected.headers.get('location').startsWith(f.target.marketOrigin+'/api/market-platform/authorize?'));
 assert.equal((await fetch(restarted+'/manage',{headers:{cookie:app+'; '+f.pending}})).status,403,'A pending-cookie marker cannot be used as a full session');
});

test('wrong OTP consumes the local challenge; reload does not repeat provider writes and five attempts cannot be reset',async t=>{
 const f=await pendingFlow(t);f.state.wrongCode=true;
 for(let n=1;n<=5;n++){const page=await challenge(f);const result=await f.post(f.pending,page,'verify',{code:f.state.otp});assert.equal(result.status,403);assert.equal(f.state.verifyCalls,n);if(n<5){const next=await f.view(f.pending);assert.ok(!next.html.includes('name="code"'),'Wrong OTP needs a fresh explicit challenge');assert.equal(f.state.challengeCalls,n);const payload=await f.payload(f.pending);assert.equal(Object.hasOwn(payload,'code'),false);}}
 const page=await f.view(f.pending);assert.ok(!page.html.includes('name="code"'),'No sixth verify form');assert.equal((await f.row(f.pending)).attempts,5);assert.equal(f.state.verifyCalls,5);assert.equal(f.state.otpPersisted,false);
});

test('expiry and malformed/foreign factor or CSRF never verify and never issue a full session',async t=>{
 const f=await pendingFlow(t),page=await f.view(f.pending);
 const foreign=await f.post(f.pending,page,'challenge',{factor:id(99)});assert.equal(foreign.status,403);assert.equal(f.state.challengeCalls,0);
 const forged=await f.post(f.pending,{...page,csrf:'forged'},'challenge',{factor:id(20)});assert.equal(forged.status,403);assert.equal(f.state.challengeCalls,0);
 const otp=await challenge(f);await f.payload(f.pending,v=>{v.challenge.expiresAt=Date.now()-1;});assert.equal((await f.post(f.pending,otp,'verify',{code:f.state.otp})).status,403);assert.equal(f.state.verifyCalls,0);
 await f.db.exec("update qr_menu_private.qr_mfa_pending set expires_at=clock_timestamp()-interval '1 second'");assert.equal((await f.view(f.pending)).response.status,403);assert.equal((await f.db.query('select count(*)::int n from qr_menu_private.qr_auth_sessions')).rows[0].n,0);
});

test('lost challenge/verify result stays unresolved across restart; cancel clears encrypted pending token without replay',async t=>{
 for(const stage of ['challenge','verify']){const f=await pendingFlow(t);let page=await f.view(f.pending);if(stage==='verify')page=await challenge(f);f.state[stage==='challenge'?'lostChallenge':'lostVerify']=true;
  const response=await f.post(f.pending,page,stage,stage==='challenge'?{factor:id(20)}:{code:f.state.otp});assert.ok(response.status>=400);assert.equal((await f.row(f.pending)).phase,'busy');const count=f.state[stage==='challenge'?'challengeCalls':'verifyCalls'];
  const restarted=await f.start(),current=await f.view(f.pending,restarted);assert.ok(current.html.includes('Cancel sign-in'));assert.ok(!current.html.includes('name="code"'));assert.equal(f.state[stage==='challenge'?'challengeCalls':'verifyCalls'],count);
  assert.equal((await f.post(f.pending,current,'cancel',{},restarted)).status,303);assert.equal((await f.row(f.pending)).phase,'canceled');assert.equal((await f.row(f.pending)).envelope,null);assert.equal((await f.post(f.pending,page,stage,stage==='challenge'?{factor:id(20)}:{code:f.state.otp})).status,403);
 }
});

test('AAL1, wrong subject and removed factor in a verify response cannot become an app session',async t=>{
 for(const kind of ['badAal','wrongSubject','removed']){const f=await pendingFlow(t),page=await challenge(f);if(kind==='removed')f.state.removeOnVerify=true;else f.state[kind]=true;
  const result=await f.post(f.pending,page,'verify',{code:f.state.otp});assert.equal(result.status,403);assert.equal(cookieValue(result,'__Host-qr_app'),undefined);assert.equal((await f.db.query('select count(*)::int n from qr_menu_private.qr_auth_sessions')).rows[0].n,0);
 }
});

test('concurrent verify executes once; cancel winning a pending write fences a late provider success',async t=>{
 for(const cancel of [false,true]){const f=await pendingFlow(t),page=await challenge(f);let release,entered;f.state.holdVerify=new Promise(r=>release=r);const seen=new Promise(r=>entered=r);const original=Object.getOwnPropertyDescriptor(f.state,'verifyCalls');let calls=f.state.verifyCalls;Object.defineProperty(f.state,'verifyCalls',{get:()=>calls,set:v=>{calls=v;entered();},configurable:true});
  const request=f.post(f.pending,page,'verify',{code:f.state.otp});await seen;const other=await f.start();
  if(cancel){const active=await f.view(f.pending,other);assert.equal((await f.post(f.pending,active,'cancel',{},other)).status,303);}else assert.equal((await f.post(f.pending,page,'verify',{code:f.state.otp},other)).status,409);
  release();const result=await request;assert.equal(result.status,cancel?409:303);assert.equal(f.state.verifyCalls,1);assert.equal((await f.db.query('select count(*)::int n from qr_menu_private.qr_auth_sessions')).rows[0].n,cancel?0:1);Object.defineProperty(f.state,'verifyCalls',{...original,value:calls});
 }
});

test('lost committed final write never flushes a cookie and consumed MFA cannot be replayed',async t=>{
 const f=await pendingFlow(t),page=await challenge(f);f.state.lostWrite=true;const result=await f.post(f.pending,page,'verify',{code:f.state.otp});assert.equal(result.status,503);assert.equal(result.headers.get('set-cookie'),null);assert.equal((await f.row(f.pending)).phase,'consumed');assert.equal((await f.post(f.pending,page,'verify',{code:f.state.otp})).status,403);assert.equal(f.state.verifyCalls,1);
});

test('pending encrypted AAL1 is not interchangeable with a full session; tamper and unsupported factors fail closed',async t=>{
 const f=await pendingFlow(t),pending=await f.row(f.pending);await f.db.query('insert into qr_menu_private.qr_auth_sessions(context_id,cookie_hash,envelope,expires_at) values($1,$2,$3::jsonb,$4)',[pending.context_id,pending.cookie_hash,JSON.stringify(pending.envelope),pending.expires_at]);
 const forged=f.pending.replace('__Host-qr_mfa=','__Host-qr_app=');assert.equal((await fetch(f.base+'/manage',{headers:{cookie:forged}})).status,403);
 const bytes=Buffer.from(pending.envelope.tag,'base64url');bytes[0]^=1;await f.db.query('update qr_menu_private.qr_mfa_pending set envelope=$1::jsonb',[JSON.stringify({...pending.envelope,tag:bytes.toString('base64url')})]);assert.equal((await f.view(f.pending)).response.status,403);
 const unsupported=await mfaFixture(t);unsupported.state.phoneOnly=true;const login=await unsupported.login();assert.equal(login.status,403);assert.equal(cookieValue(login,'__Host-qr_app'),undefined);assert.equal(unsupported.state.challengeCalls,0,'No phone/SMS or enrollment request is issued');
});

test('starting MFA retires an old app cookie and preserves only the approved initial Market return path',async t=>{
 const f=await mfaFixture(t);f.state.mfa=false;const first=await f.login(),app=cookieValue(first,'__Host-qr_app');assert.ok(app);f.state.mfa=true;
 const next='/connect?'+new URLSearchParams({reylumi_client_id:id(1),reylumi_installation:id(3),reylumi_authorize_url:f.target.marketOrigin+'/api/market-platform/authorize'});
 const started=await f.login(app,next),pending=cookieValue(started,'__Host-qr_mfa');assert.equal(started.status,303);assert.equal((await fetch(f.base+'/manage',{headers:{cookie:app}})).status,403);assert.ok((await f.db.query('select revoked_at from qr_menu_private.qr_auth_sessions')).rows[0].revoked_at);
 const page=await challenge({...f,pending}),verified=await f.post(pending,page,'verify',{code:f.state.otp});assert.equal(verified.status,303);assert.equal(verified.headers.get('location'),next);
});

test('a new sign-in cancels older pending state; an unconfirmed old-session retirement cannot issue pending or full access',async t=>{
 const f=await pendingFlow(t),page=await challenge(f);const newer=await f.login(f.pending);assert.equal(newer.status,303);assert.equal((await f.row(f.pending)).phase,'canceled');assert.equal((await f.post(f.pending,page,'verify',{code:f.state.otp})).status,403);assert.equal(f.state.verifyCalls,0);
 const other=await mfaFixture(t);other.state.mfa=false;const normal=await other.login(),app=cookieValue(normal,'__Host-qr_app');other.state.mfa=true;other.state.badRetireAck=true;const rejected=await other.login(app);assert.equal(rejected.status,503);assert.equal(rejected.headers.get('set-cookie'),null);assert.equal((await other.db.query('select count(*)::int n from qr_menu_private.qr_mfa_pending')).rows[0].n,0);
});

test('review-only private-store upgrade preserves old rows and extends only the existing restricted role',async t=>{
 const db=new PGlite();t.after(()=>db.close());await db.exec(readFileSync('tests/fixtures/qr-storage-before-mfa.sql','utf8'));await db.exec(readFileSync('tests/fixtures/qr-role-before-mfa.sql','utf8'));
 await db.query('insert into qr_menu_private.qr_menu_state(context_id,revision) values($1,7)',['a'.repeat(64)]);await db.exec(readFileSync('examples/qr-menu/mfa-storage-upgrade.sql','utf8'));assert.equal((await db.query('select revision from qr_menu_private.qr_menu_state')).rows[0].revision,7);
 await db.exec('set role qr_menu_qa_runtime');await db.query('insert into qr_menu_private.qr_mfa_pending(context_id,cookie_hash,envelope,expires_at) values($1,$2,$3::jsonb,now()+interval \'1 minute\')',['a'.repeat(64),'b'.repeat(64),'{}']);assert.equal((await db.query('select phase from qr_menu_private.qr_mfa_pending')).rows[0].phase,'ready');await assert.rejects(db.exec('delete from qr_menu_private.qr_mfa_pending'),/permission denied/);await db.exec('reset role');assert.equal((await db.query("select rolcanlogin from pg_roles where rolname='qr_menu_qa_runtime'")).rows[0].rolcanlogin,false);
});

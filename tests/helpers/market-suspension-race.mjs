import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';
const q=s=>"'"+s.replaceAll("'","''")+"'",delay=ms=>new Promise(r=>setTimeout(r,ms));
function session(f,input,marker){
 const docker=process.env.TEST_DOCKER_PATH||(process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker'),context=process.env.TEST_DOCKER_CONTEXT||(process.platform==='win32'?'desktop-linux':'default');
 const child=spawn(docker,['--context',context,'exec','-i',f.evidence.containers.db,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-At'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='',resolveReady;const ready=new Promise(r=>resolveReady=r);let timer;
 const done=new Promise((resolve,reject)=>{timer=setTimeout(()=>{child.kill();reject(Error('Owned race session timed out'));},15000);child.on('error',reject);child.stdout.on('data',b=>{stdout+=b;if(marker&&stdout.includes(marker))resolveReady();});child.stderr.on('data',b=>stderr+=b);child.on('close',code=>{clearTimeout(timer);resolve({code,stdout:f.redact(stdout),stderr:f.redact(stderr)});});});void done.catch(()=>{});
 child.stdin.write(input+'\n');if(!marker)child.stdin.end();return {child,ready,done};
}
const actor=p=>`select set_config('request.jwt.claim.sub',${q(p.authId)},true);set local role authenticated;`;
export async function assertSuspensionFences(f,developer,reviewer,v){
 const buyer=f.person('suspension-race-owner'),account=randomUUID(),salon=randomUUID(),role=randomUUID();
 f.sql(`insert into accounts(id,name) values(${q(account)},'Synthetic race');insert into locations(id,account_id,name) values(${q(salon)},${q(account)},'Synthetic race salon');insert into roles(id,account_id,name,code) values(${q(role)},${q(account)},'Owner','OWNER');insert into account_memberships(account_id,user_id,role_id,status) values(${q(account)},${q(buyer.profileId)},${q(role)},'active');`);
 const install={p_salon:salon,p_version:v.id,p_sha256:v.sha256,p_scopes:v.manifest.scopes};f.rpc(buyer,'market_platform_install',install);
 for(const mode of ['install','sandbox']){
  const name='market-'+mode+'-suspend-race',marker='app-suspended-lock-held';
  const holder=session(f,`begin;${actor(reviewer)}select public.market_platform_moderate(${q(v.app_id)},false,'Synthetic incident race');select ${q(marker)};`,marker);
  let waiter;
  try{
   await Promise.race([holder.ready,holder.done.then(r=>{throw Error('Holder ended before marker: '+r.stderr);})]);
   const call=mode==='install'?`public.market_platform_install(${q(salon)},${q(v.id)},${q(v.sha256)},${q(JSON.stringify(v.manifest.scopes))}::jsonb)`:`public.market_platform_sandbox(${q(v.id)},${q('e'.repeat(64))})`;
   waiter=session(f,`set application_name=${q(name)};begin;set local statement_timeout='8s';${actor(mode==='install'?buyer:developer)}select ${call};commit;`);
   let blocked=false;for(let n=0;n<60;n++){if(f.sql(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock')`)==='t'){blocked=true;break;}await delay(25);}
   assert.equal(blocked,true,mode+' must wait for the app suspension lock');holder.child.stdin.end('commit;\n');assert.equal((await holder.done).code,0);const result=await waiter.done;assert.notEqual(result.code,0,'racing consent/reset must reject after suspension commits');assert.match(result.stderr,mode==='install'?/Review this exact approved version/:/unavailable for testing/);
   assert.equal(f.sql(`select state from market_platform.installations where salon_id=${q(salon)} and app_id=${q(v.app_id)}`),'revoked');
  }finally{if(!holder.child.stdin.destroyed&&!holder.child.stdin.writableEnded)holder.child.stdin.end('rollback;\n');await holder.done;if(waiter)await waiter.done;}
  f.rpc(reviewer,'market_platform_moderate',{p_app:v.app_id,p_active:true,p_reason:'Synthetic independent restore'});
  assert.equal(f.sql(`select state from market_platform.installations where salon_id=${q(salon)} and app_id=${q(v.app_id)}`),'revoked','restore does not restore consent');
  f.rpc(buyer,'market_platform_install',install);
 }
}

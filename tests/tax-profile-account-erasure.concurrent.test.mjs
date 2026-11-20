import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { authId, baselineErasureSql, functionSql, personId, taxErasureMigration } from './helpers/tax-erasure-fixture.mjs';

// Explicit opt-in uses existing executables only, a new loopback-only cluster,
// generated ephemeral credentials, and synthetic data. No project DB/env input.
test('real PostgreSQL sessions reproduce a stale Tax save and prove both serialized orderings', {
  skip: !process.env.TEST_POSTGRES_BIN,
  timeout: 120000,
}, async () => {
  const pgBin = path.resolve(process.env.TEST_POSTGRES_BIN);
  for (const exe of ['postgres.exe','initdb.exe','pg_ctl.exe','psql.exe']) assert.ok(fs.existsSync(path.join(pgBin,exe)), `Missing existing executable: ${exe}`);
  const tempParent=path.resolve('C:/Reylumi/tmp'), root=path.join(tempParent,'tax-profile-erasure-race-'+randomUUID());
  const data=path.join(root,'data'), passwordFile=path.join(root,'ephemeral-password');
  assert.equal(path.dirname(root),tempParent);
  const password=randomBytes(32).toString('base64url');
  const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG'))),PGPASSWORD:password,PGCONNECT_TIMEOUT:'5',PGAPPNAME:'isolated-tax-erasure-test'};
  const probe=net.createServer();
  await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const run=(exe,args,input)=>execFileSync(path.join(pgBin,exe),args,{input,encoding:'utf8',windowsHide:true,env,timeout:30000,maxBuffer:4*1024*1024});
  const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','tax_erasure_test','-d','postgres'];
  const sql=text=>run('psql.exe',args,text);
  const sessions=[];
  const session=()=>{
    const process=spawn(path.join(pgBin,'psql.exe'),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    const s={process,output:'',errors:'',closed:null};sessions.push(s);
    process.stdout.on('data',chunk=>s.output+=chunk);process.stderr.on('data',chunk=>s.errors+=chunk);
    s.closed=new Promise((resolve,reject)=>{process.once('error',reject);process.once('close',code=>resolve(code));});
    return s;
  };
  const until=async(predicate,message)=>{
    const deadline=Date.now()+10000;
    while(!predicate()) {if(Date.now()>deadline)throw Error(message);await new Promise(resolve=>setTimeout(resolve,20));}
  };
  const waitLock=async pid=>{
    let waiting=false;
    await until(()=>{waiting=sql(`select wait_event_type='Lock' from pg_stat_activity where pid=${pid};`).trim()==='t';return waiting;},'Expected independent backend to wait on a real database lock');
    return waiting;
  };
  let server, stopped=false, evidence;
  try {
    assert.ok(!fs.existsSync(root));fs.mkdirSync(root);
    fs.writeFileSync(passwordFile,password+'\n',{flag:'wx',mode:0o600});
    run('initdb.exe',['-D',data,'--username=tax_erasure_test','--encoding=UTF8','--locale=C','--auth=scram-sha-256','--pwfile='+passwordFile]);
    fs.unlinkSync(passwordFile);
    const log=fs.openSync(path.join(root,'server.log'),'a');
    server=spawn(path.join(pgBin,'postgres.exe'),['-D',data,'-h','127.0.0.1','-p',String(port)],{env,windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
    let startupError;server.once('error',error=>{startupError=error;});
    await until(()=>{if(startupError)throw startupError;if(server.exitCode!==null)throw Error('Fresh test server stopped during startup');try{return sql('select 1;').trim()==='1';}catch{return false;}},'Fresh isolated PostgreSQL failed readiness');
    assert.equal(path.resolve(sql('show data_directory;').trim()),data);
    assert.equal(sql('show listen_addresses;').trim(),'127.0.0.1');
    const version=sql('select version();').trim();
    sql(baselineErasureSql());sql(taxErasureMigration);
    for(const n of [1,2,3]) sql(`insert into auth.users values('${authId(n)}');insert into users(id,auth_user_id,email,display_name,status) values('${personId(n)}','${authId(n)}','synthetic${n}@example.test','Synthetic ${n}','active');insert into tax_profiles(user_id,display_name,contact_email) values('${personId(n)}','Old profile','old${n}@example.test');`);
    const originalWriter=functionSql(fs.readFileSync('supabase/migrations/20261109230000_tax_personal_workspace.sql','utf8'),'tax_save_profile').replace('create function','create or replace function');

    async function deletionFirst(n, fixed) {
      const a=session();
      a.process.stdin.write(`begin;select 'PID_A='||pg_backend_pid();update users set status='pending_deletion',deletion_requested_at=now(),deletion_scheduled_for=now()-interval '1 hour' where id='${personId(n)}';select finalize_account_deletion('${personId(n)}');select 'A_READY';\n`);
      await until(()=>a.output.includes('A_READY'),'Finalizer barrier failed: '+a.errors);
      const b=session();
      b.process.stdin.end(`select 'PID_B='||pg_backend_pid();select set_config('test.uid','${personId(n)}',false);select tax_save_profile('Stale writer','stale@example.test','','');select 'B_SAVED';\n`);
      await until(()=>/PID_B=\d+/.test(b.output),'Writer backend barrier failed: '+b.errors);
      const pidA=Number(a.output.match(/PID_A=(\d+)/)[1]),pidB=Number(b.output.match(/PID_B=(\d+)/)[1]);
      assert.notEqual(pidA,pidB);assert.equal(await waitLock(pidB),true);
      a.process.stdin.end("commit;select 'A_COMMITTED';\n");
      assert.equal(await a.closed,0,a.errors);
      const exit=await b.closed;
      const profiles=Number(sql(`select count(*) from tax_profiles where user_id='${personId(n)}';`).trim());
      if(fixed){assert.notEqual(exit,0);assert.match(b.errors,/active Reylumi account/);assert.equal(profiles,0);}
      else {assert.equal(exit,0,b.errors);assert.ok(b.output.includes('B_SAVED'));assert.equal(profiles,1,'old writer recreates the profile after atomic finalizer scrub');}
      return {pidA,pidB,observedLock:true,writerRejected:exit!==0,profilesAfterCommit:profiles};
    }

    // Control changes only the writer back to the actual old implementation;
    // the real new finalizer hook is present in both runs.
    sql(originalWriter);
    const reproducedOldWriter=await deletionFirst(1,false);
    sql(taxErasureMigration);
    const deletionFirstFixed=await deletionFirst(2,true);

    // Opposite order: a valid write owns its user SHARE lock before finalization.
    const writer=session();
    writer.process.stdin.write(`begin;select 'PID_WRITER='||pg_backend_pid();select set_config('test.uid','${personId(3)}',false);select tax_save_profile('Valid update','valid@example.test','','');select 'WRITER_READY';\n`);
    await until(()=>writer.output.includes('WRITER_READY'),'Writer-first barrier failed: '+writer.errors);
    const finalizer=session();
    finalizer.process.stdin.end(`begin;select 'PID_FINALIZER='||pg_backend_pid();update users set status='pending_deletion',deletion_requested_at=now(),deletion_scheduled_for=now()-interval '1 hour' where id='${personId(3)}';select finalize_account_deletion('${personId(3)}');commit;\n`);
    await until(()=>/PID_FINALIZER=\d+/.test(finalizer.output),'Finalizer backend barrier failed: '+finalizer.errors);
    const writerPid=Number(writer.output.match(/PID_WRITER=(\d+)/)[1]),finalizerPid=Number(finalizer.output.match(/PID_FINALIZER=(\d+)/)[1]);
    assert.notEqual(writerPid,finalizerPid);assert.equal(await waitLock(finalizerPid),true);
    writer.process.stdin.end('commit;\n');assert.equal(await writer.closed,0,writer.errors);assert.equal(await finalizer.closed,0,finalizer.errors);
    const remaining=Number(sql(`select count(*) from tax_profiles where user_id='${personId(3)}';`).trim());assert.equal(remaining,0);
    evidence={passed:true,version,source:'actual erasure/Forum/Tax definitions plus new migration on reduced isolated schema',reproducedOldWriter,deletionFirstFixed,writerFirstFixed:{writerPid,finalizerPid,observedLock:true,profilesAfterCommit:remaining},productionUsed:false,dataDirectory:data,port};
  } finally {
    for(const s of sessions)if(s.process.exitCode===null)s.process.kill();
    if(fs.existsSync(path.join(data,'postmaster.pid'))){assert.equal(path.dirname(data),root);run('pg_ctl.exe',['-D',data,'-m','fast','-w','stop']);stopped=true;}
    if(fs.existsSync(passwordFile))fs.unlinkSync(passwordFile);
    if(evidence){
      evidence.serverStopped=stopped;evidence.passwordFileRemoved=!fs.existsSync(passwordFile);
      fs.mkdirSync('artifacts/ios-store-privacy-20261116',{recursive:true});
      fs.writeFileSync('artifacts/ios-store-privacy-20261116/tax-erasure-concurrency.json',JSON.stringify(evidence,null,2));
    }
  }
});

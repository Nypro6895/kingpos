import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import cp from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {startIsolatedSupabase} from './helpers/isolated-supabase-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const migration='20261119184500_beauty_image_publication_gate.sql';
const q=x=>"'"+String(x).replaceAll("'","''")+"'";
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const uuid=()=>crypto.randomUUID();
const safetyMessage=/These photos need a safety check/;
const images={db:'public.ecr.aws/supabase/postgres:17.11.0.006',auth:'public.ecr.aws/supabase/gotrue:v2.197.0',storage:'public.ecr.aws/supabase/storage-api:v1.84.19',rest:'public.ecr.aws/supabase/postgrest:v16.5'};

test('Beauty publication transitions require exact existing image pins, including concurrent parent/post changes',{
 skip:process.env.RUN_ISOLATED_SUPABASE!=='1',timeout:900000,
},async()=>{
 const output=process.env.BOOKING_TEST_OUTPUT_DIR||path.join(root,'artifacts','beauty-publication-'+Date.now());
 fs.mkdirSync(output,{recursive:true});
 const projection=path.join(output,'baseline-source','supabase','migrations');
 fs.mkdirSync(projection,{recursive:true});
 const source=path.join(root,'supabase','migrations');
 const inherited=fs.readdirSync(source).filter(x=>x.endsWith('.sql')&&x!==migration).sort();
 assert.equal(inherited.length,449);
 const pins=inherited.map(file=>({file,sha256:sha(fs.readFileSync(path.join(source,file)))}));
 for(const file of inherited)fs.copyFileSync(path.join(source,file),path.join(projection,file));
 const sql=fs.readFileSync(path.join(source,migration),'utf8');
 const report={startedAt:new Date().toISOString(),passed:false,syntheticOnly:true,metadataOnly:true,productionOperations:false,checks:[],migration:{file:migration,sha256:sha(sql)},inherited449:pins,setup:'Complete449 schema; owned old-media import with one attachment trigger restored before commit. Actual probes have all guards enabled.'};
 const save=()=>fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify(report,null,2)+'\n');
 const check=(name,details={})=>{report.checks.push({name,passed:true,...details});save();console.log('CHECK '+name);};
 const previousCwd=process.cwd(),previousOutput=process.env.BOOKING_TEST_OUTPUT_DIR;
 const children=new Set();let f;
 try{
  process.env.BOOKING_TEST_OUTPUT_DIR=output;
  process.chdir(path.resolve(projection,'..','..'));
  f=await startIsolatedSupabase('beauty-publish-gate',images,{allowConcurrentFixtureCleanup:true});
  process.chdir(previousCwd);
  const docker=process.env.TEST_DOCKER_PATH||'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
  const context=process.env.TEST_DOCKER_CONTEXT||'desktop-linux';
  const db=f.evidence.containers.db;
  const meta=JSON.parse(cp.execFileSync(docker,['--context',context,'inspect',db,'--format','{"label":{{json (index .Config.Labels "com.codex.task")}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}}}'],{encoding:'utf8',windowsHide:true}));
  assert.equal(meta.label,f.evidence.label);assert.equal(meta.network,'none');assert.equal(Object.keys(meta.ports||{}).length,0);assert(meta.mounts.every(x=>x.Type==='tmpfs'));
  const args=['--context',context,'exec','-i',db,'psql','-X','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres','-At'];
  let queryNumber=0;
  f.sql=text=>{
   const number=String(++queryNumber).padStart(3,'0');
   const r=cp.spawnSync(docker,args,{input:text,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:30e6});
   const stdout=f.redact(r.stdout||''),stderr=f.redact(r.stderr||'');
   fs.writeFileSync(path.join(output,`sql-${number}-stdout.log`),stdout);
   fs.writeFileSync(path.join(output,`sql-${number}-stderr.log`),stderr);
   fs.writeFileSync(path.join(output,`sql-${number}-receipt.json`),JSON.stringify({inputSha256:sha(text),exitCode:r.status,stdoutSha256:sha(stdout),stderrSha256:sha(stderr)},null,2)+'\n');
   if(r.status!==0)throw Error(stderr.slice(-5000)||r.error?.message||'Owned SQL failed');
   return stdout.trim();
  };
  const json=text=>JSON.parse(f.sql(text).split(/\r?\n/).findLast(x=>x.startsWith('{')||x.startsWith('[')));
  const claims=(person,role='authenticated')=>`select set_config('request.jwt.claims',${q(JSON.stringify({role,sub:person.authId}))},true);`;
  const owner=f.person('beauty-gate-public'),privateOwner=f.person('beauty-gate-private'),reviewer=f.person('beauty-gate-reviewer');
  const publicProfile=uuid(),privateProfile=uuid();
  f.sql(`update auth.users set phone='+12025550211',phone_confirmed_at=now() where id=${q(owner.authId)};
   update auth.users set phone='+12025550212',phone_confirmed_at=now() where id=${q(privateOwner.authId)};
   update auth.users set phone='+12025550213',phone_confirmed_at=now() where id=${q(reviewer.authId)};
   insert into public.beauty_profiles(id,user_id,visibility) values(${q(publicProfile)},${q(owner.profileId)},'public'),(${q(privateProfile)},${q(privateOwner.profileId)},'self');
   insert into public.platform_admin_roles(slug,name) values('beauty-gate-reviewer','Synthetic reviewer');
   insert into public.platform_admin_role_permissions(role_id,permission_id) select r.id,p.id from public.platform_admin_roles r cross join public.platform_admin_permissions p where r.slug='beauty-gate-reviewer' and p.code in('admin.access','admin.reports.read','admin.reports.update');
   insert into public.platform_admin_memberships(user_id,role_id) select ${q(reviewer.profileId)},id from public.platform_admin_roles where slug='beauty-gate-reviewer';`);
  const rows=[];
  function row(label,person,profile,flags={}){
   const value={label,id:uuid(),mediaId:uuid(),objectId:uuid(),version:uuid(),etag:'synthetic-'+uuid(),person,profile,visibility:flags.visibility||'public',moderation:flags.moderation||'visible',deleted:!!flags.deleted,hold:!!flags.hold,pin:flags.pin||null};
   value.path=`${person.profileId}/beauty/image/${uuid()}.webp`;rows.push(value);return value;
  }
  const legacy=row('registered-public-legacy',owner,publicProfile,{pin:'legacy'});
  const privatePublished=row('private-profile-visible',privateOwner,privateProfile);
  const self=row('self-post',owner,publicProfile,{visibility:'self'});
  const hidden=row('hidden-post',owner,publicProfile,{moderation:'hidden'});
  const deleted=row('deleted-post',owner,publicProfile,{deleted:true});
  const held=row('held-post',owner,publicProfile,{hold:true});
  const movable=row('movable-private-profile',privateOwner,privateProfile,{visibility:'self'});
  const approved=row('approved-private',privateOwner,privateProfile,{pin:'approved'});
  const shaValue='a'.repeat(64);
  const attachmentGuardBefore=f.sql("select md5(pg_get_triggerdef(oid))||':'||tgenabled::text from pg_trigger where tgrelid='public.beauty_post_media'::regclass and tgname='ac_post_image_approval'");
  // Controlled import of synthetic historical rows. This single trigger is
  // restored before commit; no actual transition test bypasses any guard.
  f.sql(`begin;alter table public.beauty_post_media disable trigger ac_post_image_approval;
   ${rows.map(p=>`${claims(p.person)}
    insert into storage.objects(id,bucket_id,name,owner,owner_id,version,metadata,user_metadata) values(${q(p.objectId)},'beauty-profile-media',${q(p.path)},${q(p.person.authId)},${q(p.person.authId)},${q(p.version)},${q(JSON.stringify({eTag:p.etag,size:128,mimetype:'image/webp'}))}::jsonb,${q(JSON.stringify({fixture:'synthetic-metadata-only',sha256:shaValue}))}::jsonb);
    insert into public.beauty_posts(id,profile_id,author_user_id,caption,visibility,moderation_status,deleted_at,safety_hold) values(${q(p.id)},${q(p.profile)},${q(p.person.profileId)},${q('SYNTHETIC '+p.label)},${q(p.visibility)},${q(p.moderation)},${p.deleted?'now()':'null'},${p.hold});
    insert into public.beauty_post_media(id,post_id,role,object_path,mime_type,original_bytes) values(${q(p.mediaId)},${q(p.id)},'image',${q(p.path)},'image/webp',128);
    ${p.pin?`insert into public.public_post_images(bucket,object_path,quarantine_path,uploaded_by_user_id,purpose,status,object_id,object_version,object_etag,sha256,bytes,provider,model) values('beauty-profile-media',${q(p.path)},${q('beauty-profile-media/'+p.path)},${q(p.person.profileId)},'image',${q(p.pin)},${q(p.objectId)},${q(p.version)},${q(p.etag)},${p.pin==='approved'?q(shaValue):'null'},${p.pin==='approved'?128:'null'},${p.pin==='approved'?"'synthetic-fixture'":'null'},${p.pin==='approved'?"'metadata-only'":'null'});`:''}`).join('\n')}
   alter table public.beauty_post_media enable trigger ac_post_image_approval;
   do $restore$begin
    if (select md5(pg_get_triggerdef(oid))||':'||tgenabled::text from pg_trigger where tgrelid='public.beauty_post_media'::regclass and tgname='ac_post_image_approval') is distinct from ${q(attachmentGuardBefore)} then
     raise exception 'Synthetic attachment trigger restore mismatch';
    end if;
   end$restore$;commit;`);
  assert.equal(f.sql("select md5(pg_get_triggerdef(oid))||':'||tgenabled::text from pg_trigger where tgrelid='public.beauty_post_media'::regclass and tgname='ac_post_image_approval'"),attachmentGuardBefore);
  const ownIds=rows.map(x=>q(x.id)).join(','),ownMedia=rows.map(x=>q(x.mediaId)).join(','),objects=rows.map(x=>q(x.objectId)).join(',');
  const fingerprint=()=>json(`select jsonb_build_object('profiles',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.beauty_profiles t where id in(${q(publicProfile)},${q(privateProfile)})),'posts',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.beauty_posts t where id in(${ownIds})),'media',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from public.beauty_post_media t where id in(${ownMedia})),'objects',(select md5(jsonb_agg(to_jsonb(t) order by id)::text) from storage.objects t where id in(${objects})),'pins',(select md5(jsonb_agg(to_jsonb(t) order by object_path)::text) from public.public_post_images t where object_path in(${rows.map(x=>q(x.path)).join(',')})))`);
  const before=fingerprint();
  assert.equal(f.sql(`begin;set local role authenticated;${claims(privateOwner)}update public.beauty_profiles set visibility='public' where id=${q(privateProfile)};select public.beauty_public_post_exists(${q(privatePublished.id)});rollback;`).split(/\r?\n/).at(-2),'t');
  check('Unpatched449 reproduces ordinary owned private-profile publication without image approval');
  const catalogBefore=f.sql("select md5(coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'acl',c.relacl,'owner',c.relowner,'rls',c.relrowsecurity) order by n.nspname,c.relname),'[]')::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','storage') and c.relkind in('r','p')");
  f.sql(sql);
  assert.deepEqual(fingerprint(),before);assert.equal(f.sql("select md5(coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'relation',c.relname,'acl',c.relacl,'owner',c.relowner,'rls',c.relrowsecurity) order by n.nspname,c.relname),'[]')::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','storage') and c.relkind in('r','p')"),catalogBefore);
  assert.equal(f.sql("select count(*) from pg_trigger where tgname='zy_beauty_image_publication_transition' and tgenabled='O'"),'2');
  check('Forward450 preserves every owned seeded row and existing table ownership/ACL/RLS; both new guards enabled');
  function transaction(person,body,{role='authenticated',commit=false,isolation='read committed'}={}){
   assert(['read committed','repeatable read','serializable'].includes(isolation));
   return f.sql(`begin isolation level ${isolation};set local statement_timeout='10s';${role?`set local role ${role};`:''}${claims(person,role==='service_role'?'service_role':'authenticated')}${body};${commit?'commit':'rollback'};`);
  }
  function deny(name,person,body,options={}){
   assert.throws(()=>transaction(person,body,options),safetyMessage,name);assert.deepEqual(fingerprint(),before);check(name,{rolledBack:true});
  }
  deny('Owner cannot publish a private profile containing unapproved otherwise-visible posts',privateOwner,`update public.beauty_profiles set visibility='public' where id=${q(privateProfile)}`);
  // Direct post flags are not granted to ordinary clients. The following
  // synthetic administrator sessions exercise the same underlying row guards
  // used by service/SECURITY DEFINER moderation paths, without new grants.
  for(const [name,p,change] of [
   ['Private-post publication',self,"visibility='public'"],
   ['Hidden-post restoration',hidden,"moderation_status='visible'"],
   ['Deleted-post restoration',deleted,'deleted_at=null'],
   ['Admin safety-hold release',held,"safety_hold=false,visibility='public'"],
   ['Private-to-public profile reassociation',movable,`profile_id=${q(publicProfile)},visibility='public'`],
  ])deny(name+' rejects an unapproved attachment',reviewer,`update public.beauty_posts set ${change} where id=${q(p.id)}`,{role:null});
  deny('Profile OLD id is checked before attempted primary-key change',privateOwner,`update public.beauty_profiles set id=${q(uuid())},visibility='public' where id=${q(privateProfile)}`);
  deny('Post OLD id is checked before attempted primary-key change',reviewer,`update public.beauty_posts set id=${q(uuid())},visibility='public' where id=${q(self.id)}`,{role:null});
  deny('Service-role post publication has no image-approval bypass',owner,`update public.beauty_posts set visibility='public' where id=${q(self.id)}`,{role:'service_role'});
  const direct=transaction(owner,`update public.beauty_posts set visibility='public' where id=${q(self.id)}`);
  assert(direct.split(/\r?\n/).includes('UPDATE 0'),'Existing post RLS must continue filtering ordinary direct writers');
  assert.deepEqual(fingerprint(),before);
  assert.throws(()=>transaction(owner,`update public.beauty_profiles set user_id=${q(reviewer.profileId)} where id=${q(publicProfile)}`),/row-level security policy|duplicate key/);
  check('Existing direct-post mutation and profile ownership permissions remain unchanged');
  const edited=transaction(owner,`select public.update_beauty_post_caption(${q(legacy.id)},'SYNTHETIC legacy caption edit')`);
  assert(edited.includes('"ok": true'));
  transaction(privateOwner,`update public.beauty_profiles set bio='SYNTHETIC retained private profile' where id=${q(privateProfile)}`);
  transaction(reviewer,`update public.beauty_posts set moderation_status='hidden' where id=${q(legacy.id)};update public.beauty_posts set moderation_status='visible' where id=${q(legacy.id)}`,{role:null});
  transaction(reviewer,`update public.beauty_posts set profile_id=${q(publicProfile)} where id=${q(approved.id)}`,{role:null});
  transaction(reviewer,`update public.beauty_posts set visibility='public',profile_id=${q(privateProfile)} where id=${q(movable.id)}`,{role:null});
  transaction(owner,`update public.beauty_profiles set visibility='self' where id=${q(publicProfile)};update public.beauty_profiles set visibility='public' where id=${q(publicProfile)}`);
  transaction(reviewer,`update public.beauty_posts set moderation_status='hidden' where id=${q(privatePublished.id)};set local role authenticated;${claims(privateOwner)}update public.beauty_profiles set visibility='public' where id=${q(privateProfile)}`,{role:null});
  assert.deepEqual(fingerprint(),before);
  check('Exact legacy/approved edits and restoration work; private edits and private reassociation remain available',{rolledBack:true});
  for(const [name,field,value] of [['object id','id',q(uuid())],['version','version',q(uuid())],['eTag','metadata',"jsonb_set(metadata,'{eTag}','\"SYNTHETIC changed\"'::jsonb)"]]){
   deny('Exact legacy '+name+' mismatch blocks restoration',reviewer,`update public.beauty_posts set visibility='self' where id=${q(legacy.id)};update storage.objects set ${field}=${value} where id=${q(legacy.objectId)};update public.beauty_posts set visibility='public' where id=${q(legacy.id)}`,{role:null});
  }
  deny('Wrong author cannot reuse an approved image pin',reviewer,`update public.beauty_posts set author_user_id=${q(owner.profileId)},profile_id=${q(publicProfile)} where id=${q(approved.id)}`,{role:null});
  transaction(reviewer,`update public.beauty_posts set visibility='self' where id=${q(legacy.id)};update public.public_post_images set purpose='before' where bucket='beauty-profile-media' and object_path=${q(legacy.path)};do $p$begin begin update public.beauty_posts set visibility='public' where id=${q(legacy.id)};raise exception 'WRONG PURPOSE WAS ACCEPTED';exception when insufficient_privilege then null;end;end$p$`,{role:null});
  check('Wrong media role/purpose fails the existing exact approval predicate',{rolledBack:true});
  for(const isolation of ['repeatable read','serializable']){
   assert.throws(()=>transaction(privateOwner,`update public.beauty_profiles set visibility='public' where id=${q(privateProfile)}`,{isolation}),/requires a READ COMMITTED transaction/);
   assert.throws(()=>transaction(reviewer,`insert into public.beauty_profiles(user_id,visibility) values(${q(reviewer.profileId)},'public')`,{isolation}),/requires a READ COMMITTED transaction/);
   assert.throws(()=>transaction(reviewer,`update public.beauty_posts set visibility='public' where id=${q(self.id)}`,{isolation,role:null}),/requires a READ COMMITTED transaction/);
   transaction(privateOwner,`update public.beauty_profiles set bio='SYNTHETIC private isolation edit' where id=${q(privateProfile)}`,{isolation});
   transaction(owner,`select public.update_beauty_post_caption(${q(legacy.id)},'SYNTHETIC unchanged public eligibility')`,{isolation});
   check(isolation+' fails closed for new publication, including an empty profile; unchanged/private edits remain allowed',{rolledBack:true});
  }
  // Each schedule uses only owned synthetic rows and bounded local sessions.
  function concurrent(text,label){
   const child=cp.spawn(docker,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});children.add(child);
   let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
   child.stdin.end(text);
   const result=new Promise(resolve=>child.on('exit',code=>{children.delete(child);fs.writeFileSync(path.join(output,label+'-stdout.log'),f.redact(stdout));fs.writeFileSync(path.join(output,label+'-stderr.log'),f.redact(stderr));resolve({code,stdout:f.redact(stdout),stderr:f.redact(stderr)});}));
   return {child,result};
  }
  async function marker(n){for(let i=0;i<100;i++){if(f.sql(`select exists(select 1 from pg_locks where locktype='advisory' and objid=${n} and granted)`)==='t')return;await new Promise(r=>setTimeout(r,30));}throw Error('Owned schedule marker was not reached');}
  async function blocked(name){for(let i=0;i<50;i++){if(f.sql(`select exists(select 1 from pg_stat_activity where application_name=${q(name)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0)`)==='t')return;await new Promise(r=>setTimeout(r,30));}throw Error('Owned writer did not reach the expected lock wait');}
  // Start with a private post under a private profile, then let the profile
  // publication commit before the waiting post UPDATE resumes its SHARE read.
  const race=privatePublished;
  transaction(reviewer,`update public.beauty_posts set visibility='self' where id=${q(race.id)};update public.beauty_posts set visibility='self' where id=${q(approved.id)}`,{role:null,commit:true});
  const raceBase=fingerprint();
  const profileFirst=concurrent(`begin;set local statement_timeout='10s';set local role authenticated;${claims(privateOwner)}update public.beauty_profiles set visibility='public' where id=${q(privateProfile)};select pg_advisory_xact_lock(841901);select pg_sleep(2);commit;`,'profile-first-owner');
  await marker(841901);
  const waitingPost=concurrent(`begin;set local application_name='beauty-gate-profile-first-post';set local statement_timeout='10s';${claims(reviewer)}update public.beauty_posts set visibility='public' where id=${q(race.id)};commit;`,'profile-first-post');
  await blocked('beauty-gate-profile-first-post');
  const [profileResult,postResult]=await Promise.all([profileFirst.result,waitingPost.result]);
  assert.equal(profileResult.code,0,profileResult.stderr);assert.notEqual(postResult.code,0);assert.match(postResult.stderr,safetyMessage);
  assert.equal(f.sql(`select public.beauty_public_post_exists(${q(race.id)})`),'f');
  check('READ COMMITTED profile-first schedule: waiting post sees committed public parent and refuses unapproved image',{noDeadlock:true});
  transaction(privateOwner,`update public.beauty_profiles set visibility='self' where id=${q(privateProfile)}`,{commit:true});
  const reset=fingerprint();for(const key of ['media','objects','pins'])assert.equal(reset[key],raceBase[key]);
  const postFirst=concurrent(`begin;set local statement_timeout='10s';${claims(reviewer)}update public.beauty_posts set visibility='public' where id=${q(race.id)};select pg_advisory_xact_lock(841902);select pg_sleep(2);commit;`,'post-first-post');
  await marker(841902);
  const waitingProfile=concurrent(`begin;set local application_name='beauty-gate-post-first-owner';set local statement_timeout='10s';set local role authenticated;${claims(privateOwner)}update public.beauty_profiles set visibility='public' where id=${q(privateProfile)};commit;`,'post-first-owner');
  await blocked('beauty-gate-post-first-owner');
  const [postFirstResult,profileWaitResult]=await Promise.all([postFirst.result,waitingProfile.result]);
  assert.equal(postFirstResult.code,0,postFirstResult.stderr);assert.notEqual(profileWaitResult.code,0);assert.match(profileWaitResult.stderr,safetyMessage);
  assert.equal(f.sql(`select public.beauty_public_post_exists(${q(race.id)})`),'f');
  check('READ COMMITTED post-first schedule: waiting profile sees committed formerly-private post and refuses exposure',{noDeadlock:true});
  transaction(reviewer,`update public.beauty_posts set visibility='self' where id=${q(race.id)};update public.beauty_posts set profile_id=${q(publicProfile)},visibility='self' where id=${q(movable.id)}`,{role:null,commit:true});
  const profileBeforeMove=concurrent(`begin;set local statement_timeout='10s';set local role authenticated;${claims(privateOwner)}update public.beauty_profiles set visibility='public' where id=${q(privateProfile)};select pg_advisory_xact_lock(841903);select pg_sleep(2);commit;`,'profile-first-move-owner');
  await marker(841903);
  const waitingMove=concurrent(`begin;set local application_name='beauty-gate-profile-first-move';set local statement_timeout='10s';${claims(reviewer)}update public.beauty_posts set profile_id=${q(privateProfile)},visibility='public' where id=${q(movable.id)};commit;`,'profile-first-move-post');
  await blocked('beauty-gate-profile-first-move');
  const [profileMoveResult,moveWaitResult]=await Promise.all([profileBeforeMove.result,waitingMove.result]);
  assert.equal(profileMoveResult.code,0,profileMoveResult.stderr);assert.notEqual(moveWaitResult.code,0);assert.match(moveWaitResult.stderr,safetyMessage);
  check('READ COMMITTED profile-first move: old/new parent fence prevents reassociation bypass',{noDeadlock:true});
  transaction(privateOwner,`update public.beauty_profiles set visibility='self' where id=${q(privateProfile)}`,{commit:true});
  const moveFirst=concurrent(`begin;set local statement_timeout='10s';${claims(reviewer)}update public.beauty_posts set profile_id=${q(privateProfile)},visibility='public' where id=${q(movable.id)};select pg_advisory_xact_lock(841904);select pg_sleep(2);commit;`,'move-first-post');
  await marker(841904);
  const profileAfterMove=concurrent(`begin;set local application_name='beauty-gate-move-first-owner';set local statement_timeout='10s';set local role authenticated;${claims(privateOwner)}update public.beauty_profiles set visibility='public' where id=${q(privateProfile)};commit;`,'move-first-owner');
  await blocked('beauty-gate-move-first-owner');
  const [moveFirstResult,profileAfterMoveResult]=await Promise.all([moveFirst.result,profileAfterMove.result]);
  assert.equal(moveFirstResult.code,0,moveFirstResult.stderr);assert.notEqual(profileAfterMoveResult.code,0);assert.match(profileAfterMoveResult.stderr,safetyMessage);
  assert.equal(f.sql(`select public.beauty_public_post_exists(${q(movable.id)})`),'f');
  check('READ COMMITTED move-first schedule: profile scan observes reassociated post and refuses exposure',{noDeadlock:true});
  // Changing timestamps is expected only from committed synthetic schedule
  // writes; storage/media/pin fingerprints remain byte-for-byte stable.
  const end=fingerprint();for(const key of ['media','objects','pins'])assert.equal(end[key],before[key]);
  const grants=f.sql("select has_function_privilege('authenticated','public.guard_beauty_image_publication_transition()','EXECUTE') or has_function_privilege('service_role','public.guard_beauty_image_publication_transition()','EXECUTE')");assert.equal(grants,'f');
  check('No new callable client/service function or data/media mutation from the gate');
  report.passed=true;
 }catch(error){report.error=f?.redact(error.stack||error.message)||String(error);throw error;}
 finally{
  // Only this test's owned psql children are signalled; no global process kill.
  for(const child of children)child.kill();
  process.chdir(previousCwd);
  if(previousOutput===undefined)delete process.env.BOOKING_TEST_OUTPUT_DIR;else process.env.BOOKING_TEST_OUTPUT_DIR=previousOutput;
  if(f){try{f.close();report.cleanup=f.evidence.cleanup;}catch(error){report.passed=false;report.cleanupError=f.redact(error.message);}}
  report.inherited449Unchanged=pins.every(x=>sha(fs.readFileSync(path.join(source,x.file)))===x.sha256);
  report.newMigrationUnchanged=sha(fs.readFileSync(path.join(source,migration)))===report.migration.sha256;
  if(!report.inherited449Unchanged||!report.newMigrationUnchanged||report.cleanupError)report.passed=false;
  report.finishedAt=new Date().toISOString();save();
  assert.equal(report.passed,true,report.error||report.cleanupError||'Source changed during fixture');
 }
});

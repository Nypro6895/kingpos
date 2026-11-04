import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{startIsolatedSupabase}from'./helpers/isolated-supabase-fixture.mjs';
test('Combined production transport preserves existing history, rejects drift/replay and applies atomically',{skip:process.env.RUN_COMBINED_RELEASE_SQL!=='1',timeout:900000},async t=>{
 const d='artifacts/combined-release-20261104',manifest=JSON.parse(fs.readFileSync(d+'/atomic-apply-manifest.json')),sql=fs.readFileSync(d+'/atomic-apply.sql','utf8');
 const fixture=await startIsolatedSupabase('combined-apply',JSON.parse(process.env.TEST_SUPABASE_IMAGES||'{}'),{allowConcurrentFixtureCleanup:true,excludeMigrations:manifest.entries.map(e=>e.name)});t.after(()=>fixture.close());
 fixture.sql('create schema if not exists supabase_migrations;create table if not exists supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);');
 const quote=s=>"'"+s.replaceAll("'","''")+"'";
 for(const name of ['202611030001_reylumi_membership_admin.sql','202611030002_membership_desktop_settings.sql']){
  const s=fs.readFileSync('supabase/migrations/'+name,'utf8').replaceAll('\r\n','\n').replace(/^\s*begin;\s*/i,'').replace(/\s*commit;\s*$/i,'')+'\n';
  fixture.sql(`insert into supabase_migrations.schema_migrations values(${quote(name.split('_')[0])},${quote(name.slice(name.indexOf('_')+1,-4))},array[${quote(s)}]);`);
 }
 fixture.sql("insert into supabase_migrations.schema_migrations values('20261028063000','explore_initial_page_batch',array['existing Explore source']),('20261103010000','reward_wallet_recency',array['existing Reward source']),('20261103150000','campaign_measurement_trust',array['existing Campaign source']);");
 const before=fixture.sql("select md5(string_agg(row_to_json(m)::text,E'\\n' order by version)) from supabase_migrations.schema_migrations m");
 await t.test('mismatched existing membership source stops before creating Market schema',()=>{
  assert.throws(()=>fixture.sql(sql.replace(manifest.core[0].md5,'00000000000000000000000000000000')),/Existing membership source mismatch/);
  assert.equal(fixture.sql("select to_regnamespace('market_platform') is null"),'t');
  assert.equal(fixture.sql("select md5(string_agg(row_to_json(m)::text,E'\\n' order by version)) from supabase_migrations.schema_migrations m"),before);
 });
 await t.test('Windows CRLF transport executes normalized reviewed SQL with no commercial activation',()=>{
  const result=fixture.sql(sql.replaceAll('\n','\r\n'));assert.match(result,/"applied": 21/);assert.match(result,/"protectedDataUnchanged": true/);assert.match(result,/"externalMarketEnabled": false/);
  const versions=manifest.entries.map(e=>quote(e.version)).join(',');assert.equal(fixture.sql(`select count(*) from supabase_migrations.schema_migrations where version in (${versions})`),'21');
  for(const e of manifest.entries)assert.equal(fixture.sql(`select md5(replace(array_to_string(statements,E'\\n'),E'\\r\\n',E'\\n')) from supabase_migrations.schema_migrations where version=${quote(e.version)}`),e.md5);
  assert.equal(fixture.sql(`select md5(string_agg(row_to_json(m)::text,E'\\n' order by version)) from supabase_migrations.schema_migrations m where version not in (${versions})`),before);
 });
 await t.test('an ambiguous/repeated apply is rejected without repeating writes',()=>{assert.throws(()=>fixture.sql(sql),/selected deployment version already exists/);assert.equal(fixture.sql('select count(*) from market_platform.apps'),'0');});
 fixture.save('atomic-apply-proof.json',{productionLikeTransportPassed:true,ledgerReplayRejected:true,existingLedgerPreserved:true,newMigrations:manifest.entries.map(e=>({name:e.name,sha256LF:e.sha256LF})),fixture:fixture.evidence});
});

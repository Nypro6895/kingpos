import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createUnifiedExploreFixture,fixtureId as id,seedSalon,searchFixture as search} from './fixtures/explore-unified-search-bootstrap.mjs';

const migration=name=>readFileSync(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
async function install(db){
 await db.exec(migration('20261119042923_explore_local_quality_search.sql'));
 await db.exec(migration('20261119052341_explore_local_quality_preparation.sql'));
}
const rpc=async(db,name,args=[])=>{
 const placeholders=args.map((_,n)=>`$${n+1}`).join(',');
 return (await db.query(`SELECT ${name}(${placeholders}) AS result`,args)).rows[0].result;
};
const status=db=>rpc(db,'get_explore_local_quality_preparation');
const batch=(db,limit=50)=>rpc(db,'prepare_explore_local_quality_batch',[limit]);
const activate=db=>rpc(db,'activate_explore_local_quality');
const fresh=async run=>{const fixture=await createUnifiedExploreFixture({seed:false});try{await run(fixture.db);}finally{await fixture.close();}};

test('preparation installs OFF, leaves search on its shipped path, and exposes maintenance only to service role',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1);await seedSalon(db,2);
 await install(db);
 assert.deepEqual(await status(db),{ready:false,done:false,busy:false,scanned:0,processed:0,stale:0,pending:false,scanComplete:false});
 assert.equal((await db.query('SELECT count(*)::int n FROM explore_local_quality_documents')).rows[0].n,0);
 const old=await search(db,{query:'gel',contentQuery:'gel',queryKind:'service',location:'Madison, WI',scopePolicy:'fixed'});
 assert.notEqual(old.rankingBasis,'local_quality_indexed_lanes');
 const refused=await activate(db);assert.equal(refused.ready,false);assert.equal(refused.done,false);assert.equal(refused.reason,'preparation_incomplete');
 for(const limit of [0,101,null])await assert.rejects(batch(db,limit),error=>error.code==='22023');
 for(const name of ['get_explore_local_quality_preparation()','prepare_explore_local_quality_batch(integer)','activate_explore_local_quality()']){
  const permissions=(await db.query("SELECT has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service",[name])).rows[0];
  assert.deepEqual(permissions,{anon:false,authenticated:false,service:true});
 }
 await db.exec('SET ROLE service_role');assert.equal((await status(db)).ready,false);await db.exec('RESET ROLE');
 await db.exec('SET ROLE anon');await assert.rejects(status(db),error=>error.code==='42501');await db.exec('RESET ROLE');
}));

test('bounded UUID batches resume, reconcile inserts behind the cursor and deletes, and never activate automatically',{timeout:120000},()=>fresh(async db=>{
 for(const n of [10,20,30])await seedSalon(db,n,{quality:20});
 await install(db);
 const input={query:'gel',contentQuery:'gel',queryKind:'service',location:'Madison, WI',scopePolicy:'fixed',limit:1};
 const old=await search(db,input);
 const first=await batch(db,1);assert.equal(first.scanned,1);assert.equal(first.processed,1);assert.equal(first.ready,false);assert.equal(first.done,false);
 assert.equal((await db.query('SELECT count(*)::int n FROM explore_local_quality_documents WHERE valid_to IS NULL')).rows[0].n,1);
 await seedSalon(db,5,{quality:90});
 await db.query('UPDATE explore_salon_documents SET profile_completeness=99 WHERE salon_id=$1',[id(20)]);
 await db.query('DELETE FROM explore_salon_documents WHERE salon_id=$1',[id(30)]);
 let state=first;const observed=[first];
 for(let turn=0;!state.done&&turn<8;turn++){state=await batch(db,1);observed.push(state);}
 assert.equal(state.done,true);assert.equal(state.ready,false);assert.equal(state.pending,false);assert.equal(state.scanComplete,true);
 assert(observed.every(x=>x.scanned<=1&&x.processed<=1));
 assert.deepEqual((await db.query('SELECT salon_id FROM explore_local_quality_documents WHERE valid_to IS NULL ORDER BY salon_id')).rows.map(x=>x.salon_id),[id(5),id(10),id(20)]);
 assert.notEqual((await search(db,input)).rankingBasis,'local_quality_indexed_lanes');
 const revision=Number((await db.query('SELECT revision FROM explore_unified_search_clock WHERE id')).rows[0].revision);
 const ready=await activate(db);assert.equal(ready.ready,true);assert.equal(ready.done,true);
 assert.equal(Number((await db.query('SELECT revision FROM explore_unified_search_clock WHERE id')).rows[0].revision),revision+1);
 const newer=await search(db,input);assert.equal(newer.rankingBasis,'local_quality_indexed_lanes');assert.equal(newer.rows[0]?.salon_id,id(20));
 const continuation=await search(db,{...input,cursor:old.nextCursor});assert.notEqual(continuation.rankingBasis,'local_quality_indexed_lanes');
 const noop=await batch(db,100);assert.equal(noop.ready,true);assert.equal(noop.processed,0);
 await db.query("UPDATE explore_salon_documents SET service_search_text='basic pedicure' WHERE salon_id=$1",[id(20)]);
 const live=await search(db,input);assert(!live.rows.some(x=>x.salon_id===id(20)&&x.is_primary_match));
}));

test('a source change during staging preserves its new generation until the next reconciliation batch',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1);await install(db);
 await db.query('UPDATE explore_salon_documents SET profile_completeness=44 WHERE salon_id=$1',[id(1)]);
 const generation=(await db.query('SELECT generation FROM explore_local_quality_dirty WHERE salon_id=$1',[id(1)])).rows[0].generation;
 await db.exec(`CREATE TABLE preparation_race_once(singleton boolean PRIMARY KEY);
  CREATE FUNCTION preparation_race() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
   IF NOT EXISTS(SELECT 1 FROM preparation_race_once) THEN
    INSERT INTO preparation_race_once VALUES(true);
    UPDATE explore_salon_documents SET service_search_text='balayage hair color',service_names=ARRAY['Balayage'] WHERE salon_id=NEW.salon_id;
   END IF;RETURN NULL;END$$;
  CREATE TRIGGER preparation_race AFTER INSERT ON explore_local_quality_documents FOR EACH ROW EXECUTE FUNCTION preparation_race();`);
 const raced=await batch(db,1);assert.equal(raced.stale,1);assert.equal(raced.pending,true);assert.equal(raced.ready,false);
 assert.notEqual((await db.query('SELECT generation FROM explore_local_quality_dirty WHERE salon_id=$1',[id(1)])).rows[0].generation,generation);
 const reconciled=await batch(db,1);assert.equal(reconciled.done,true);assert.equal(reconciled.pending,false);assert.equal(reconciled.stale,0);
 assert((await db.query('SELECT service_terms FROM explore_local_quality_documents WHERE salon_id=$1 AND valid_to IS NULL',[id(1)])).rows[0].service_terms.includes('balayag'));
 assert.equal((await activate(db)).ready,true);
}));

test('activation rejects missing access indexes without taking a publication revision or exposing a partial index',{timeout:120000},()=>fresh(async db=>{
 await seedSalon(db,1);await install(db);
 const prepared=await batch(db,50);assert.equal(prepared.done,true);assert.equal(prepared.ready,false);
 await db.exec('DROP INDEX explore_local_quality_point');
 const revision=Number((await db.query('SELECT revision FROM explore_unified_search_clock WHERE id')).rows[0].revision);
 const blocked=await activate(db);assert.equal(blocked.ready,false);assert.equal(blocked.done,true);assert.equal(blocked.reason,'indexes_not_ready');
 assert.equal(Number((await db.query('SELECT revision FROM explore_unified_search_clock WHERE id')).rows[0].revision),revision);
 assert.equal((await db.query('SELECT analyzed_at FROM explore_local_quality_preparation WHERE singleton')).rows[0].analyzed_at,null);
 await db.exec('CREATE INDEX explore_local_quality_point ON explore_local_quality_documents USING gist(point)');
 assert.equal((await activate(db)).ready,true);
 const analyzed=(await db.query('SELECT analyzed_at::text analyzed_at FROM explore_local_quality_preparation WHERE singleton')).rows[0].analyzed_at;
 assert(analyzed,'actual prepared data is analyzed before activation');
 assert.equal((await activate(db)).ready,true);
 assert.equal((await db.query('SELECT analyzed_at::text analyzed_at FROM explore_local_quality_preparation WHERE singleton')).rows[0].analyzed_at,analyzed,'idempotent activation reuses the completed statistics sample');
 assert.equal(Number((await db.query('SELECT revision FROM explore_unified_search_clock WHERE id')).rows[0].revision),revision+1);
}));

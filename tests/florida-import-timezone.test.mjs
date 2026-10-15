import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test('Florida timezone verification handles Mexico Beach and Port St Joe independently of their shared ZIP',async()=>{
 const {businesses}=JSON.parse(await readFile(new URL('../data/florida-profile-sources.json',import.meta.url),'utf8'));
 assert.equal(businesses.length,31422);
 for(const b of businesses)assert.ok(['America/New_York','America/Chicago'].includes(b.operatingTimezoneIana));
 for(const b of businesses.filter(b=>b.city==='Mexico Beach'))assert.equal(b.operatingTimezoneIana,'America/Chicago');
 for(const b of businesses.filter(b=>b.city==='Port St Joe'))assert.equal(b.operatingTimezoneIana,'America/New_York');
 const manifest=JSON.parse(await readFile(new URL('../work/florida-expansion/import-manifest.json',import.meta.url),'utf8'));
 assert.equal(manifest.reduce((sum,b)=>sum+b.records,0),businesses.length);
 assert.ok(manifest.every(b=>b.records>0&&b.records<=500));
 for(const timezone of ['America/Chicago','America/New_York']){
  const first=manifest.find(b=>b.timezone===timezone);
  const sql=await readFile(new URL('../'+first.path,import.meta.url),'utf8');
  const records=JSON.parse(sql.match(/jsonb_to_recordset\('([\s\S]*?)'::jsonb\)/)[1].replaceAll("''","'"));
  const verified=new Map(businesses.map(b=>[b.id,b.operatingTimezoneIana]));
  assert.equal(records.length,500);
  for(const b of records)assert.equal(verified.get(b.listing_id),timezone);
  assert.ok(sql.includes('salon_directory_suppressions'));assert.ok(sql.includes(`now(),'${timezone}',false`));
 }
});

test('new-state import refuses an implicit timezone',()=>{
 assert.throws(()=>execFileSync(process.execPath,['scripts/build-wisconsin-salon-import.mjs','--state','FL'],{stdio:'pipe'}),/Command failed/);
});

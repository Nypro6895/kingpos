import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { cube } from '@electric-sql/pglite/contrib/cube';
import { earthdistance } from '@electric-sql/pglite/contrib/earthdistance';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

test('legacy inspiration preserves media-key pagination while hydrating only selected public posts', {timeout:120_000}, async()=>{
 const db=new PGlite({extensions:{pg_trgm,cube,earthdistance}});
 try {
  await db.exec(readFileSync('tests/fixtures/explore-social-bootstrap.sql','utf8'));
  const search=readFileSync('supabase/migrations/20261009052031_explore_search_sessions.sql','utf8');
  for(const block of search.matchAll(/CREATE FUNCTION public\.(?:explore_search_state_codes|explore_search_region)\([\s\S]*?\$\$;/g)) await db.exec(block[0]);
  await db.exec(readFileSync('supabase/migrations/20261009064031_explore_region_index_predicates.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261009080031_explore_social_discovery.sql','utf8'));
  await db.query('INSERT INTO locations VALUES($1,$2)',[id(1),'Salon']);
  await db.query("INSERT INTO explore_salon_documents(salon_id,salon_name,city,state,state_code,city_search,created_at,public_discovery_published_at) VALUES($1,'Salon','Madison','WI','WI','madison',now()-interval '2 days',now()-interval '2 days')",[id(1)]);
  await db.query("INSERT INTO services VALUES($1,$2,'Manicure','Nails',35,45,true,true)",[id(2),id(1)]);
  await db.query('INSERT INTO booking_settings VALUES($1,true,true,true)',[id(1)]);
  const stamp=(await db.query("SELECT (now()-interval '1 day') AS stamp")).rows[0].stamp;
  for(let n=1;n<=60;n++) {
   const table=n<=30?'salon_profile_looks':'salon_profile_updates';
   await db.query(`INSERT INTO ${table}(id,salon_id,title,caption,service_id,media_path,status,published_at) VALUES($1,$2,'Title','Caption',$3,$4,'published',$5)`,[id(1000+n),id(1),id(2),`post-${n}.webp`,stamp]);
   // Reverse the UUID order relative to post IDs: the old cursor is a media
   // UUID, not a content UUID, so a content-only index is insufficient.
   await db.query("INSERT INTO salon_profile_media_assets VALUES($1,$2,$3,'active',NULL,400,600)",[id(7000-n),id(1),`post-${n}.webp`]);
  }
  await db.query("INSERT INTO salon_profile_looks(id,salon_id,title,media_path,status,published_at) VALUES($1,$2,'Future','future.webp','published',now()+interval '1 day'),($3,$2,'Held','held.webp','published',now()-interval '1 hour')",[id(1998),id(1),id(1999)]);
  await db.query('UPDATE salon_profile_looks SET safety_hold=true WHERE id=$1',[id(1999)]);
  await db.exec(readFileSync('supabase/migrations/20261009091031_explore_inspiration_cursor_projection.sql','utf8'));
  const page=async(media=null,published=null,size=12)=>(await db.query('SELECT * FROM get_public_explore_inspiration($1,$2,$3)',[media,published,size])).rows;
  const first=await page();
  assert.equal(first.length,13);
  assert.equal(first[0].media_id,id(6999));
  assert.equal(first[0].content_id,id(1001));
  assert.equal(Number(first[0].aspect_ratio),0.6666666666666666);
  assert.equal(first[0].booking_enabled,true);
  assert.equal(first[0].bookable_service_id,id(2));
  assert.equal(first[0].booking_href,`/book/${id(1)}`);
  const all=[]; let cursorMedia=null,cursorTime=null;
  while(true) {
   const rows=await page(cursorMedia,cursorTime);
   const shown=rows.slice(0,12); all.push(...shown);
   if(rows.length<=12) break;
   cursorMedia=shown.at(-1).media_id; cursorTime=shown.at(-1).published_at;
  }
  assert.equal(all.length,60);
  assert.equal(new Set(all.map(row=>row.media_id)).size,60);
  assert.ok(all.every((row,i)=>i===0||all[i-1].media_id>row.media_id),'same-timestamp media ties preserve global legacy order');
  assert.equal((await page(null,null,999)).length,25,'24 rows plus one continuation sentinel');
  await db.query("INSERT INTO users VALUES($1,'deleted','Deleted staff',NULL,NULL,NULL)",[id(9000)]);
  await db.query("UPDATE salon_profile_looks SET author_user_id=$1,author_display_name='Deleted staff',author_presentation_role='staff' WHERE id=$2",[id(9000),id(1001)]);
  assert.equal((await page())[0].author_display_name,'Salon','deleted staff author identity falls back to public salon');
  const indexPlan=(await db.query('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM explore_home_inspiration_documents WHERE ROW(published_at,media_id)<ROW($1::timestamptz,$2::uuid) ORDER BY published_at DESC,media_id DESC,content_key DESC LIMIT 25',[stamp,id(6990)])).rows[0]['QUERY PLAN'][0].Plan;
  const find=(node,key)=>[...(node[key]?[node[key]]:[]),...(node.Plans??[]).flatMap(child=>find(child,key))];
  // Small fixtures can legitimately use a sequential scan. Disable it for
  // this path-only assertion; native million-row measurements use defaults.
  await db.exec('SET enable_seqscan=off');
  const forced=(await db.query('EXPLAIN(FORMAT JSON) SELECT * FROM explore_home_inspiration_documents WHERE ROW(published_at,media_id)<ROW($1::timestamptz,$2::uuid) ORDER BY published_at DESC,media_id DESC,content_key DESC LIMIT 25',[stamp,id(6990)])).rows[0]['QUERY PLAN'][0].Plan;
  assert.ok(find(forced,'Index Name').includes('explore_home_inspiration_cursor_idx'));
  assert.ok(find(forced,'Index Cond').some(value=>value.includes('ROW(published_at, media_id) <')),'legacy cursor enters the index condition');
  assert.ok(!find(forced,'Node Type').includes('Sort'),'raw latest-media selection uses its exact ordered index');
  await db.exec('SET enable_seqscan=on');
  assert.ok(indexPlan['Actual Rows']<=25);

  await db.query('UPDATE booking_settings SET online_booking_visible=false WHERE salon_id=$1',[id(1)]);
  assert.ok((await page()).every(row=>!row.booking_enabled&&row.booking_href===null&&row.bookable_service_id===null));
  await db.query('UPDATE booking_settings SET online_booking_visible=true WHERE salon_id=$1',[id(1)]);
  await db.query("INSERT INTO salon_profile_content_booking_configs VALUES($1,$2,'salon_profile_look',$3,NULL,NULL,NULL,true,'Recipe','Book inspiration',now())",[id(8000),id(1),id(1001)]);
  await db.query('UPDATE salon_profile_looks SET service_id=NULL WHERE id=$1',[id(1001)]);
  assert.equal((await page())[0].booking_enabled,true,'canonical inspiration-only booking config remains enabled');
  assert.equal((await page())[0].bookable_service_id,null);
  await db.query('UPDATE salon_profile_looks SET caption=$1,media_path=$2 WHERE id=$3',['Edited','edited.webp',id(1001)]);
  assert.equal((await db.query('SELECT media_id FROM explore_home_inspiration_documents WHERE content_id=$1',[id(1001)])).rows[0].media_id,id(1001),'media path mutation updates the legacy tie key synchronously');
  assert.ok((await page(null,null,24)).every(row=>row.content_id!==id(1001)),'edited fallback UUID is correctly ordered after current media assets');
  await db.query('UPDATE salon_profile_looks SET safety_hold=true WHERE id=$1',[id(1002)]);
  assert.equal((await db.query('SELECT * FROM explore_home_inspiration_documents WHERE content_id=$1',[id(1002)])).rows.length,0);
  await db.query('DELETE FROM salon_profile_updates WHERE id=$1',[id(1031)]);
  assert.equal((await db.query('SELECT * FROM explore_home_inspiration_documents WHERE content_id=$1',[id(1031)])).rows.length,0);
  await db.query("UPDATE salon_profile_media_assets SET status='quarantined' WHERE id=$1",[id(6997)]);
  assert.equal((await db.query('SELECT * FROM explore_home_inspiration_documents WHERE content_id=$1',[id(1003)])).rows.length,0);
  await db.query('DELETE FROM explore_salon_documents WHERE salon_id=$1',[id(1)]);
  assert.equal((await page()).length,0,'live salon visibility gate prevents stale projection exposure');
  assert.equal((await db.query("SELECT has_table_privilege('anon','explore_home_inspiration_documents','SELECT') allowed")).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_function_privilege('anon','refresh_explore_home_inspiration(text[])','EXECUTE') allowed")).rows[0].allowed,false);
  const definition=(await db.query("SELECT pg_get_functiondef('get_public_explore_inspiration(uuid,timestamptz,integer)'::regprocedure) definition")).rows[0].definition;
  assert.match(definition,/WITH selected AS MATERIALIZED[\s\S]+LIMIT \$1[\s\S]+FROM selected c JOIN salon_profile_looks/,'candidate LIMIT precedes all source hydration');
 } finally {await db.close();}
});

import assert from 'node:assert/strict';
export const id=i=>'12600000-0000-0000-0000-'+String(i).padStart(12,'0');
export async function seedRankFixture(db,count=620) {
 await db.exec(`INSERT INTO public.explore_salon_documents(salon_id,salon_name,salon_name_search,state_code,city_search,city,state,postal_code,created_at,public_discovery_published_at,profile_completeness,search_document,service_category_search_text,service_categories,featured_service_name,active_service_count,latitude,longitude)
 SELECT ('12600000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'King Nails '||i,'king nails '||i,CASE WHEN i>${count-20} THEN 'IL' ELSE 'WI' END,CASE WHEN i>${count-20} THEN 'chicago' ELSE 'milwaukee' END,CASE WHEN i>${count-20} THEN 'Chicago' ELSE 'Milwaukee' END,CASE WHEN i>${count-20} THEN 'IL' ELSE 'WI' END,CASE WHEN i>${count-20} THEN '60601' ELSE '53202' END,now()-interval '10 days',now()-interval '10 days',(i%5)*20,'king nails salon manicure gel '||i,CASE WHEN i%7=0 THEN 'hair' ELSE 'nails' END,ARRAY[CASE WHEN i%7=0 THEN 'Hair' ELSE 'Nails' END],'Manicure',1,CASE WHEN i%5=0 THEN NULL ELSE 43.0389+(i%10)*0.001 END,CASE WHEN i%5=0 THEN NULL ELSE -87.9065 END FROM generate_series(1,${count}) i;
 INSERT INTO public.booking_settings(salon_id,booking_enabled,online_booking_visible,guest_booking_enabled) SELECT salon_id,true,true,true FROM public.explore_salon_documents;
 INSERT INTO public.services(id,salon_id,is_active,online_booking_enabled) SELECT salon_id,salon_id,true,true FROM public.explore_salon_documents;`);
}
export async function flushRanks(db,scoreFor=i=>i===599?0.99:i/10000,bookableFor=()=>true) {
 let published=0;
 for(let tries=0;tries<10000;tries++) {
  const jobs=(await db.query('SELECT * FROM public.claim_explore_search_rank_jobs(100)')).rows;
  if(!jobs.length)break;
  const rows=jobs.map(j=>({...j,rule_version:'lumi-trust-v2',evidence_as_of:new Date().toISOString(),trust_score:scoreFor(Number(j.salon_id.slice(-12))),bookable:bookableFor(Number(j.salon_id.slice(-12))),bookable_service_id:j.salon_id}));
  const result=(await db.query('SELECT public.publish_explore_search_rank_jobs($1::jsonb) result',[JSON.stringify(rows)])).rows[0].result;
  published+=result.published;
 }
 return published;
}
export async function rankSearch(db,{q='',category='Nails',location='WI',sort='trusted',policy='fixed',cursor=null,latitude=null,longitude=null}={}) {
 return (await db.query('SELECT public.search_public_explore_session($1,$2,$3,$4,$5,$6,12,$7::jsonb,$8) result',[q,category,location,latitude,longitude,sort,cursor?JSON.stringify(cursor):null,policy])).rows[0].result;
}
export async function verifyRankedSearch(db,{transactional=false}={}) {
 await seedRankFixture(db);
 let first=await rankSearch(db);
 assert.equal(first.appliedSort,'relevance');assert.equal(first.sortFallbackReason,'ranking_warming');assert.ok(!first.supportedSorts.includes('trusted'));
 assert.equal(await flushRanks(db),620);
 first=await rankSearch(db);
 assert.equal(first.appliedSort,'trusted');assert.equal(first.rankingBasis,'indexed_scope');assert.ok(first.rankVersion>0);assert.ok(first.rankAsOf);
 assert.equal(first.rows[0].salon_id,id(599),'high Trust after UUID256 must lead page1');
 assert.ok(first.rows.every(r=>r.state_code==='WI'&&r.service_category_search_text==='nails'));
 const expected=(await db.query("SELECT salon_id FROM public.explore_salon_documents WHERE state_code='WI' AND service_category_search_text='nails' ORDER BY CASE WHEN salon_id=$1 THEN .99 ELSE substring(salon_id::text,25)::float8/10000 END DESC,salon_id",[id(599)])).rows.map(r=>r.salon_id);
 const oldVersion=first.rankVersion;const seen=first.rows.map(r=>r.salon_id);
 // Both changed scores are outside the first256 queued ranks: a future seek must
 // actually read old history, rather than only freezing current page metadata.
 await db.query('SELECT public.explore_rank_enqueue($1::uuid[])',[[id(1),id(2)]]);
 await flushRanks(db,i=>i===1?1:i===2?0:i===599?.99:i/10000);
 let next=first;
 while(next.hasMore) {next=await rankSearch(db,{cursor:next.nextCursor});assert.equal(next.rankVersion,oldVersion);seen.push(...next.rows.map(r=>r.salon_id));}
 assert.deepEqual(seen,expected,'all pages retain actual frozen historical scores beyond batch256');assert.equal(new Set(seen).size,seen.length);
 assert.equal((await rankSearch(db)).rows[0].salon_id,id(1),'new session reads the new revision');
 const keyword=await rankSearch(db,{q:'gel',sort:'trusted'});assert.equal(keyword.appliedSort,'relevance');assert.equal(keyword.sortFallbackReason,'keyword_ranking_not_supported');assert.ok(keyword.rows.length);
 await db.query('UPDATE public.explore_salon_documents SET salon_name_search=$1 WHERE salon_id=$2',['king nails',id(618)]);await flushRanks(db);
 assert.equal((await rankSearch(db,{q:'King Nails',policy:'expandable'})).rows[0].salon_id,id(618),'exact outside A remains prioritized');
 assert.ok(!(await rankSearch(db,{q:'King Nails'})).rows.some(r=>r.salon_id===id(618)),'fixed scope wins');
 // Source changes invalidate current eligibility even when a previous batch was queued.
 first=await rankSearch(db);const hidden=first.rows[2].salon_id;await db.query('DELETE FROM public.explore_salon_documents WHERE salon_id=$1',[hidden]);
 next=await rankSearch(db,{cursor:first.nextCursor});assert.ok(!next.rows.some(r=>r.salon_id===hidden));
 const moved=id(2);await db.query("UPDATE public.explore_salon_documents SET state_code='IL',city_search='chicago' WHERE salon_id=$1",[moved]);await flushRanks(db);
 next=await rankSearch(db,{cursor:next.nextCursor});assert.ok(next.rows.every(r=>r.state_code==='WI'));
 // Current booking gate is revalidated on publication, not trusted from an old worker payload.
 await db.query('UPDATE public.booking_settings SET booking_enabled=false WHERE salon_id=$1',[id(599)]);
 await db.query('SELECT public.explore_rank_enqueue($1::uuid[])',[[id(599)]]);await flushRanks(db,()=>.99,()=>true);
 const bookable=await rankSearch(db,{sort:'bookable'});assert.equal(bookable.appliedSort,'bookable');assert.ok(!bookable.rows.some(r=>r.salon_id===id(599)),'disabled shop cannot rank above eligible booking');
 // Worker/source CAS rejects a leased score after a document mutation.
 await db.query('SELECT public.explore_rank_enqueue($1::uuid[])',[[id(3)]]);
 const claim=(await db.query('SELECT * FROM public.claim_explore_search_rank_jobs(100)')).rows.find(j=>j.salon_id===id(3));
 await db.query("UPDATE public.explore_salon_documents SET description='Changed' WHERE salon_id=$1",[id(3)]);
 const cas=(await db.query('SELECT public.publish_explore_search_rank_jobs($1::jsonb) result',[JSON.stringify([{...claim,rule_version:'lumi-trust-v2',evidence_as_of:new Date().toISOString(),trust_score:1,bookable:true,bookable_service_id:id(3)}])])).rows[0].result;
 assert.equal(cas.published,0);await flushRanks(db);
 const located=await rankSearch(db,{sort:'closest',location:'Milwaukee, WI',latitude:43.0389,longitude:-87.9065});
 assert.equal(located.appliedSort,'closest');assert.ok(located.rows.every(r=>r.distance_miles!==null));
 const all=located.rows.map(r=>({id:r.salon_id,distance:r.distance_miles}));next=located;
 while(next.hasMore){next=await rankSearch(db,{sort:'closest',location:'Milwaukee, WI',latitude:43.0389,longitude:-87.9065,cursor:next.nextCursor});all.push(...next.rows.map(r=>({id:r.salon_id,distance:r.distance_miles})));}
 let nulls=false,last=-Infinity;for(const row of all){if(row.distance===null)nulls=true;else{assert.equal(nulls,false,'unknown distances occur only after measured distances');assert.ok(row.distance>=last-1e-9);last=row.distance;}}
 assert.ok(nulls,'unmapped salons remain discoverable in an explicit city');assert.equal(new Set(all.map(r=>r.id)).size,all.length);
 const manual=await rankSearch(db,{sort:'closest',location:'Milwaukee, WI'});assert.equal(manual.appliedSort,'relevance');assert.equal(manual.sortFallbackReason,'location_required');
 // Exact same-ID reimport must not resurrect the old immutable session incarnation.
 first=await rankSearch(db);const recycled=id(500),saved=(await db.query('SELECT to_jsonb(d) row FROM public.explore_salon_documents d WHERE salon_id=$1',[recycled])).rows[0].row;
 await db.query('DELETE FROM public.explore_salon_documents WHERE salon_id=$1',[recycled]);await db.query('INSERT INTO public.explore_salon_documents SELECT * FROM jsonb_populate_record(NULL::public.explore_salon_documents,$1::jsonb)',[JSON.stringify(saved)]);
 next=first;const subsequent=[];while(next.hasMore){next=await rankSearch(db,{cursor:next.nextCursor});subsequent.push(...next.rows.map(r=>r.salon_id));}assert.ok(!subsequent.includes(recycled),'same-ID source token cannot resurrect old frozen session');await flushRanks(db);
 // All-zero canonical proof may skip decay only when future/history closed tickets are absent.
 async function publishZero(){await db.query('SELECT public.explore_rank_enqueue($1::uuid[])',[[id(11)]]);const j=(await db.query('SELECT * FROM public.claim_explore_search_rank_jobs(100)')).rows.find(j=>j.salon_id===id(11));await db.query('SELECT public.publish_explore_search_rank_jobs($1::jsonb)',[JSON.stringify([{...j,rule_version:'lumi-trust-v2',evidence_as_of:new Date().toISOString(),trust_score:0,empty_evidence:true,bookable:false}])]);}
 await publishZero();assert.equal((await db.query('SELECT refresh_after FROM public.explore_search_rank_sources WHERE salon_id=$1',[id(11)])).rows[0].refresh_after,null);
 await db.query("INSERT INTO public.pos_tickets VALUES($1,$2,'closed',now()+interval '1 day')",[id(10000),id(11)]);assert.equal((await rankSearch(db)).sortFallbackReason,'ranking_warming');await publishZero();assert.ok((await db.query('SELECT refresh_after FROM public.explore_search_rank_sources WHERE salon_id=$1',[id(11)])).rows[0].refresh_after);
 await db.query("UPDATE public.explore_search_rank_history SET refresh_after=now()-interval '1 second' WHERE salon_id=$1 AND valid_to IS NULL",[id(11)]);await db.query("UPDATE public.explore_search_rank_sources SET refresh_after=now()-interval '1 second' WHERE salon_id=$1",[id(11)]);assert.equal((await rankSearch(db)).sortFallbackReason,'ranking_stale');assert.equal((await db.query('SELECT public.refresh_explore_search_rank_due(1000) n')).rows[0].n,1);await flushRanks(db);
 // More than64*256 tombstone entries before live ranks cannot cause54000.
 await db.exec(`INSERT INTO public.explore_search_rank_history(group_id,salon_id,valid_from,source_token,trust_score,bookable,computed_at,rule_version)
  SELECT g.group_id,('12600000-0000-0000-0000-'||lpad((100000+i)::text,12,'0'))::uuid,1,gen_random_uuid(),1,false,now(),'lumi-trust-v2' FROM public.explore_search_rank_groups g CROSS JOIN generate_series(1,17000) i WHERE g.group_key=public.explore_rank_scope_key('{"kind":"state","state":"WI"}'::jsonb,'nails');`);
 assert.equal((await rankSearch(db)).rows.length,12,'large tombstone backlog is skipped inside indexed raw retrieval');
 await db.exec('UPDATE public.explore_salon_documents SET latitude=NULL,longitude=NULL;');await flushRanks(db);
 const noPoints=await rankSearch(db,{sort:'closest',location:'Milwaukee, WI',latitude:43.0389,longitude:-87.9065});assert.equal(noPoints.appliedSort,'relevance');assert.equal(noPoints.sortFallbackReason,'coordinates_unavailable');assert.ok(noPoints.rows.length);
 if(transactional)await db.query('SAVEPOINT invalid_cursor');
 await assert.rejects(()=>rankSearch(db,{cursor:first.nextCursor,category:'Hair'}),/changed|expired/i);
 if(transactional)await db.query('ROLLBACK TO SAVEPOINT invalid_cursor');
 const funcs=(await db.query("SELECT has_function_privilege('anon','public.publish_explore_search_rank_jobs(jsonb)','execute') allowed")).rows[0];assert.equal(funcs.allowed,false);
 return {rankVersion:oldVersion,rows:seen.length,closestRows:all.length};
}

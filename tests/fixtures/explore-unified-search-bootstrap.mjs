// Local PGlite only. No environment credentials, network calls, or production data.
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pg_trgm} from '@electric-sql/pglite/contrib/pg_trgm';
import {cube} from '@electric-sql/pglite/contrib/cube';
import {earthdistance} from '@electric-sql/pglite/contrib/earthdistance';

export const fixtureId = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration = name => readFileSync(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8');
const stack=['20261009052031_explore_search_sessions.sql','20261009062031_explore_booking_rank_gate.sql','20261009064031_explore_region_index_predicates.sql','20261009065531_explore_session_publication_cutoff.sql','20261009071031_explore_candidate_seek_paths.sql','20261009123031_explore_gps_address_context.sql','20261009125031_explore_negative_fuzzy_guard.sql','20261009126031_explore_ranked_search.sql','20261009129032_explore_rank_safe_update.sql','20261009129033_explore_rank_batch_proof.sql'];

export async function seedSalon(db,n,{name=`Fixture Nails ${n}`,city='Madison',state='WI',latitude=43.07,longitude=-89.4,quality=30,category='nails',price=35,created='2026-01-01T00:00:00Z'}={}){
 const id=fixtureId(n);
 await db.query('INSERT INTO locations(id,name) VALUES($1,$2)',[id,name]);
 await db.query('INSERT INTO salon_settings(salon_id) VALUES($1)',[id]);
 await db.query(`INSERT INTO explore_salon_documents(salon_id,salon_name,city,state,state_code,city_search,postal_code,country,latitude,longitude,profile_completeness,service_categories,service_names,service_category_search_text,service_search_text,created_at,public_discovery_published_at,has_public_profile,starting_price,salon_name_search,search_document,location_search_text,active_service_count)
 VALUES($1,$2,$3,$4,$4,normalize_search_text($3),'53703','US',$5,$6,$7,ARRAY[$8],ARRAY['Gel manicure'], $8,'gel manicure nails pedicure',$9,$9,true,$10,normalize_search_text($2),normalize_search_text($2||' gel manicure nails pedicure'),normalize_search_text($3||' '||$4),1)`,[id,name,city,state,latitude,longitude,quality,category,created,price]);
 return id;
}
export async function seedPost(db,n,salon,{title='Milky matcha',caption='Green almond glossy manicure',summary='',media=false,reference=false,status='published',hold=false,type='look',author=null,published='2026-01-02T00:00:00Z'}={}){
 const id=fixtureId(n),salonId=typeof salon==='number'?fixtureId(salon):salon;
 const path=media?(type==='look'?`${salonId}/looks/${id}/fixture.webp`:`${salonId}/updates/${id}.webp`):null;
 if(type==='look')await db.query('INSERT INTO salon_profile_looks(id,salon_id,author_user_id,title,caption,media_path,status,published_at,safety_hold) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,salonId,author,title,caption,path,status,published,hold]);
 else await db.query('INSERT INTO salon_profile_updates(id,salon_id,author_user_id,title,caption,summary,media_path,status,published_at,safety_hold) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,salonId,author,title,caption,summary,path,status,published,hold]);
 if(media)await db.query('INSERT INTO salon_profile_media_assets(id,salon_id,object_path,status,purpose) VALUES($1,$2,$3,\'active\',$4)',[fixtureId(n+1000000),salonId,path,type]);
 if(reference)await db.query("INSERT INTO salon_directory_listings(salon_id,reference_post_id,claim_state) VALUES($1,$2,'unclaimed') ON CONFLICT(salon_id) DO UPDATE SET reference_post_id=excluded.reference_post_id",[salonId,id]);
 return{id,salonId,path};
}
export async function searchFixture(db,input={}){
 const params=[input.query??'',input.category??'Nails',input.location??'',input.latitude??null,input.longitude??null,input.sort??'relevance',input.limit??12,input.cursor??null,input.scopePolicy??'expandable',input.intent??'search',input.contentQuery??input.query??'',input.queryKind??'service',input.locationPriority??false,input.filters??{},input.hydrateIds??null];
 return (await db.query('SELECT search_public_explore_session($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) AS result',params)).rows[0].result;
}
export async function createUnifiedExploreFixture({seed=true,scale=0,addressPriority=true,anywhereSearch=true,onStage=()=>{}}={}){
 const db=new PGlite({extensions:{pg_trgm,cube,earthdistance}});
 try{
  await db.exec(readFileSync(new URL('./explore-social-bootstrap.sql',import.meta.url),'utf8'));
  await db.exec(`CREATE TABLE pos_tickets(id uuid PRIMARY KEY,salon_id uuid,status text,closed_at timestamptz);
   CREATE INDEX pos_rank_fixture_idx ON pos_tickets(salon_id);
   ALTER TABLE salon_directory_listings ADD COLUMN reference_post_id uuid,ADD COLUMN claim_state text;
   ALTER TABLE locations ADD COLUMN status text DEFAULT 'active';
   ALTER TABLE salon_settings ADD COLUMN public_discovery_enabled boolean DEFAULT true;
   ALTER TABLE salon_profile_media_assets ADD COLUMN purpose text,ADD COLUMN bucket text DEFAULT 'salon-profile-media';
   CREATE TABLE explore_social_trending(content_key text PRIMARY KEY);
   CREATE TABLE fixture_user_blocks(actor uuid,subject uuid,PRIMARY KEY(actor,subject));
   CREATE FUNCTION current_public_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.viewer',true),'')::uuid$$;
   CREATE FUNCTION explore_preferred_categories() RETURNS text[] LANGUAGE sql STABLE AS $$SELECT '{}'::text[]$$;
   CREATE FUNCTION social_users_blocked(actor uuid,subject uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM fixture_user_blocks b WHERE b.actor=actor AND b.subject=subject OR b.actor=subject AND b.subject=actor)$$;
   CREATE FUNCTION salon_profile_public_salon_exists(target_salon_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$SELECT EXISTS(SELECT 1 FROM explore_salon_documents d JOIN locations l ON l.id=d.salon_id JOIN salon_settings s USING(salon_id) WHERE d.salon_id=target_salon_id AND d.has_public_profile AND l.status='active' AND s.public_discovery_enabled)$$;
  `);
  for(const file of stack)await db.exec(migration(file));
  onStage('legacy schema ready');
  const region=migration('20261009127031_explore_coordinate_validity.sql').match(/CREATE OR REPLACE FUNCTION public\.explore_search_region\([\s\S]*?END \$\$;/)[0];
  await db.exec(region);
  await db.exec(migration('20261009121031_explore_query_area_lookup.sql'));
  await db.exec(migration('20261009128031_explore_search_suggestions.sql'));
  if(scale){
   // Skip the unrelated legacy trust-score rebuild while seeding107k fixtures.
   // The new migration below still performs its complete real source backfill.
   await db.exec('ALTER TABLE explore_salon_documents DISABLE TRIGGER USER');
   // Loading an existing-scale directory is not an incremental importer test.
   // Build its unchanged legacy indexes in bulk, then restore every definition.
   const legacyIndexes=(await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='explore_salon_documents' AND indexname<>'explore_salon_documents_pkey'")).rows;
   for(const index of legacyIndexes)await db.exec(`DROP INDEX public."${index.indexname.replaceAll('"','""')}"`);
   onStage('scale source insertion');
   await db.query(`INSERT INTO locations(id,name) SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Directory Nails '||n FROM generate_series(1,$1::int) n`,[scale]);
   await db.exec('INSERT INTO salon_settings(salon_id) SELECT id FROM locations');
   await db.query(`INSERT INTO explore_salon_documents(salon_id,salon_name,city,state,state_code,city_search,postal_code,country,latitude,longitude,profile_completeness,service_categories,service_names,service_category_search_text,service_search_text,created_at,public_discovery_published_at,has_public_profile,starting_price,salon_name_search,search_document,active_service_count)
    SELECT id,name,'Madison','WI','WI','madison','53703','US',25+((right(id::text,12)::int*73)%24000)/1000.0,-125+((right(id::text,12)::int*239)%59000)/1000.0,30,ARRAY['nails'],ARRAY['Manicure'],'nails','manicure nails pedicure','2026-01-01','2026-01-01',true,35,lower(name),lower(name)||' manicure nails pedicure',1 FROM locations`);
   onStage('scale legacy index bulk build');
   for(const index of legacyIndexes)await db.exec(index.indexdef);
   await db.exec(`INSERT INTO salon_profile_updates(id,salon_id,title,caption,status,published_at) SELECT salon_id,salon_id,'Welcome to '||salon_name,'Local nail salon offering manicure and pedicure','published','2026-01-01' FROM explore_salon_documents;
    INSERT INTO salon_directory_listings(salon_id,reference_post_id,claim_state) SELECT salon_id,salon_id,'unclaimed' FROM explore_salon_documents;`);
   await db.exec('ALTER TABLE explore_salon_documents ENABLE TRIGGER USER');
  }
  onStage('unified migration and real backfill');
  await db.exec(migration('20261016010001_explore_unified_salon_search.sql'));
  if(addressPriority)await db.exec(migration('20261017020000_explore_address_priority.sql'));
  if(addressPriority&&anywhereSearch){
   await db.exec(migration('20261017030000_explore_anywhere_search.sql'));
   await db.exec(migration('20261017040000_explore_unified_query_performance.sql'));
  }
  onStage('unified migration complete');
  const ids={};
  if(seed){
   for(const [n,name,city,state] of [[1,'King Nails','Madison','WI'],[2,'Matcha Studio','Madison','WI'],[3,'Lake Nails','Madison','WI'],[4,'Green Room Nails','Milwaukee','WI'],[5,'King Nails','Honolulu','HI'],[6,'Prairie Nails','Madison','WI'],[7,'Velvet Nail Bar','Madison','WI'],[8,'Amber Nails','Madison','WI'],[9,'Oak Nails','Madison','WI'],[10,'City Nails','Madison','WI'],[11,'Rose Nails','Madison','WI'],[12,'Moss Nails','Madison','WI'],[13,'River Nails','Madison','WI'],[14,'North Nails','Madison','WI'],[15,'South Nails','Madison','WI']]){
    ids[n]=await seedSalon(db,n,{name,city,state,latitude:state==='HI'?21.3:city==='Milwaukee'?43.04:43.07+n/10000,longitude:state==='HI'?-157.8:city==='Milwaukee'?-87.9:-89.4});
   }
   await seedPost(db,101,1,{media:true});await seedPost(db,102,2,{media:false});
   await seedPost(db,103,3,{type:'update',title:'Welcome to Lake Nails',caption:'Manicure pedicure',reference:true});
   await seedPost(db,104,4,{title:'Milky matcha',media:true});
   await seedPost(db,105,5,{title:'Milky matcha',media:true});
   await seedPost(db,106,6,{title:'French tips',caption:'White short square nails',media:true});
  }
  return{db,ids,close:()=>db.close()};
 }catch(error){await db.close();throw error;}
}

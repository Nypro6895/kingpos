// Deterministic native schema proof; excludes object OIDs and physical/cache identity.
import { sourceHash } from './explore-local-quality-native-bootstrap.mjs';

const tables = ['explore_local_quality_documents', 'explore_local_quality_postings', 'explore_local_quality_preparation', 'explore_local_quality_dirty'];

export async function readQualityCatalog(db) {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await db.query('SET LOCAL search_path=public,extensions');
    const classes = (await db.query(`SELECT c.relname,c.relkind,pg_get_userbyid(c.relowner) AS owner,c.relrowsecurity,c.relforcerowsecurity,c.reloptions,
      ARRAY(SELECT pg_get_userbyid(a.grantor)||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||a.privilege_type||':'||a.is_grantable
        FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a ORDER BY 1) AS privileges
      FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname`, [[...tables, 'explore_local_quality_source']])).rows;
    const columns = (await db.query(`SELECT c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS expression
      FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
      WHERE c.relnamespace='public'::regnamespace AND (c.relname=ANY($1::text[]) OR c.relname='explore_search_sessions' AND a.attname='local_quality_version')
      ORDER BY c.relname,a.attnum`, [tables])).rows;
    const constraints = (await db.query(`SELECT c.relname,k.conname,k.contype,k.convalidated,pg_get_constraintdef(k.oid,true) AS definition
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname,k.conname`, [tables])).rows;
    const indexes = (await db.query(`SELECT c.relname AS table_name,i.relname AS index_name,pg_get_indexdef(i.oid) AS definition,p.indisvalid,p.indisready,i.reloptions
      FROM pg_index p JOIN pg_class c ON c.oid=p.indrelid JOIN pg_class i ON i.oid=p.indexrelid
      WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY($1::text[]) ORDER BY c.relname,i.relname`, [tables])).rows;
    const functions = (await db.query(`SELECT p.oid::regprocedure::text AS signature,pg_get_functiondef(p.oid) AS definition,pg_get_userbyid(p.proowner) AS owner,
      ARRAY(SELECT pg_get_userbyid(a.grantor)||':'||CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END||':'||a.privilege_type||':'||a.is_grantable
        FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a ORDER BY 1) AS privileges
      FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'explore_local_%' OR p.proname LIKE '%local_quality%'
        OR p.proname IN ('explore_unified_pull_batch','explore_unified_candidate_live','search_public_explore_session','cleanup_explore_search_sessions'))
      ORDER BY signature`)).rows;
    const triggers = (await db.query(`SELECT c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal AND t.tgname LIKE 'explore_local_quality_%' ORDER BY c.relname,t.tgname`)).rows;
    const views = (await db.query("SELECT 'explore_local_quality_source' AS name,pg_get_viewdef('public.explore_local_quality_source'::regclass,true) AS definition")).rows;
    const catalog = { classes, columns, constraints, indexes, functions, triggers, views };
    return { sha256: sourceHash(JSON.stringify(catalog)), catalog };
  } finally { await db.query('ROLLBACK'); }
}

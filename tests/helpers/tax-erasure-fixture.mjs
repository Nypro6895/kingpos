import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const taxErasureMigration = fs.readFileSync('supabase/migrations/20261116210000_tax_profile_account_erasure.sql', 'utf8');
export const personId = n => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const authId = n => `72000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function functionSql(source, name) {
  const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`));
  if (start < 0) throw Error(`Missing actual function: ${name}`);
  const end = source.indexOf('$$;', source.indexOf('as $$', start));
  if (end < 0) throw Error(`Unrecognized actual function body: ${name}`);
  return source.slice(start, end + 3);
}

// Reduced schema with the actual shipped erasure migration, actual Forum
// helper/composition patch and actual Tax profile DDL/writer. No hosted access.
export const erasureBootstrap = `
create role anon;create role authenticated;create role service_role;
create schema auth;create table auth.users(id uuid primary key);
create schema storage;create table storage.objects(bucket_id text,name text,owner uuid,owner_id text);
create table public.users(id uuid primary key,auth_user_id uuid,email text,phone text,first_name text,last_name text,display_name text,avatar_url text,status text,
 deletion_requested_at timestamptz,deletion_scheduled_for timestamptz,deletion_finalization_started_at timestamptz,deletion_finalized_at timestamptz,
 deletion_finalization_attempts int default 0,deletion_finalization_failed_at timestamptz,deletion_finalization_error text,updated_at timestamptz,deleted_at timestamptz,anonymized_at timestamptz,last_login_at timestamptz);
create function public.current_public_user_id() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function public.account_deletion_unresolved_owned_salon_count(uuid) returns integer language sql as $$select coalesce(nullif(current_setting('test.unresolved',true),''),'0')::int$$;
create table account_lifecycle_events(user_id uuid,actor_user_id uuid,event_type text,metadata jsonb);
create table deleted_auth_identities(auth_user_id uuid primary key,user_id uuid,deleted_at timestamptz,metadata jsonb);
create table account_memberships(user_id uuid,status text,updated_at timestamptz);
create table salon_memberships(like account_memberships);
create table locations(id uuid primary key);
create table staff(id uuid primary key,account_user_id uuid,user_id uuid,public_bio text,public_profile_photo_path text,public_profile_visible boolean,owner_public_enabled boolean,salon_profile_content_posting_enabled boolean,staff_public_consent_status text,updated_at timestamptz);
create table payroll_runs(id uuid primary key);
create table payroll_staff_lines(id uuid primary key,staff_legal_name_snapshot text,final_staff_income numeric);
create table pos_payments(id uuid primary key,amount numeric,note text);
create table beauty_profiles(id uuid,user_id uuid,bio text,cover_media_path text,visibility text,updated_at timestamptz);
create table beauty_posts(id uuid,author_user_id uuid,caption text,visibility text,moderation_status text,deleted_at timestamptz,updated_at timestamptz);
create table beauty_post_media(post_id uuid,bucket text,object_path text);
create table beauty_profile_follows(user_id uuid,profile_id uuid);
create table salon_profile_looks(author_user_id uuid,title text,caption text,emotional_description text,why_love_it text,mood text,palette text[],badge text,media_path text,booking_note text,author_display_name text,author_avatar_path text,status text);
create table salon_profile_updates(author_user_id uuid,title text,caption text,summary text,media_path text,cta_label text,author_display_name text,author_avatar_path text,status text);
create table salon_profile_comments(author_user_id uuid,body text,author_display_name text,status text,updated_at timestamptz,id uuid);
create table salon_profile_reviews(author_user_id uuid,body text,title text,moderation_reason text,moderation_status text,updated_at timestamptz);
create table salon_profile_review_replies(author_user_id uuid,body text,moderation_status text,updated_at timestamptz);
create table customer_visit_experiences(author_user_id uuid,body text);
create table post_safety_cases(author_user_id uuid,content_snapshot jsonb,matched_keywords text[]);
create table salon_profile_media_assets(bucket text,object_path text,status text,deleted_at timestamptz);
create table lifecycle_exports(requested_by_user_id uuid,subject_user_id uuid,storage_bucket text,storage_path text);
create table user_blocks(blocker_user_id uuid,blocked_user_id uuid);
create table app_notifications(recipient_user_id uuid,event_key text,notification_type text,forum_topic_id uuid);
create table pos_owner_operations(user_id uuid references auth.users(id));
create table forum_topics(id uuid,author_id uuid,title text,body text,state text,seed_persona_id uuid,deleted_at timestamptz,updated_at timestamptz);
create table forum_replies(id uuid,author_id uuid,body text,seed_persona_id uuid,deleted_at timestamptz,updated_at timestamptz);
create table forum_chat(author_id uuid,body text,deleted_at timestamptz);
create table forum_bookmarks(user_id uuid);create table forum_subscriptions(user_id uuid);create table forum_rate_limits(user_id uuid);
create table forum_reports(reporter_id uuid,reason text);create table forum_audit(actor_id uuid,reason text,details jsonb);
create table visit_experience_replies(author_user_id uuid,body text);create table visit_experience_history(actor_user_id uuid,body text);
` + ['salon_profile_look_saves','salon_profile_follows','account_favorite_customers','account_post_saves','post_safety_hidden','notification_preferences','account_login_sessions','account_trusted_devices','account_recovery_codes','account_security_preferences','account_login_activity','account_recovery_requests','customer_verified_phones']
  .map(name => `create table ${name}(user_id uuid);`).join('\n') +
  ['abuse_guard_content','abuse_guard_image','post_safety_scan','validate_unified_post_comment','validate_comment_persona']
    .map(name => `create function ${name}() returns trigger language plpgsql as $$\nbegin\nreturn new;end$$;`).join('\n');

export function baselineErasureSql() {
  const forum = fs.readFileSync('supabase/migrations/20261109220000_forum_privacy_completion.sql', 'utf8');
  const tax = fs.readFileSync('supabase/migrations/20261109230000_tax_personal_workspace.sql', 'utf8');
  const patchStart = forum.lastIndexOf('do $patch$');
  const patchEnd = forum.indexOf('end $patch$;', patchStart) + 'end $patch$;'.length;
  return [
    erasureBootstrap,
    fs.readFileSync('supabase/migrations/202610140003_account_erasure.sql', 'utf8'),
    functionSql(forum, 'erase_forum_personal_content'),
    'revoke all on function public.erase_forum_personal_content(uuid) from public,anon,authenticated,service_role;',
    forum.slice(patchStart, patchEnd),
    tax.slice(tax.indexOf('create table public.tax_profiles'), tax.indexOf('create function public.tax_actor')),
    functionSql(tax, 'tax_actor'), functionSql(tax, 'tax_save_profile'),
    tax.slice(tax.indexOf('create table public.tax_documents'), tax.indexOf('create index tax_documents_salon')),
    tax.slice(tax.indexOf('create table public.tax_messages'), tax.indexOf('create index tax_messages_salon')),
    tax.slice(tax.indexOf('create table public.tax_events'), tax.indexOf('create table public.tax_uploads')),
    tax.slice(tax.lastIndexOf('do $$ declare item record;'), tax.indexOf("notify pgrst,'reload schema';", tax.lastIndexOf('do $$ declare item record;'))),
  ].join('\n');
}

export async function taxErasureFixture({ apply = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec(baselineErasureSql());
    if (apply) await db.exec(taxErasureMigration);
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function seedPerson(db, n, status = 'pending_deletion', due = true) {
  await db.query(`insert into auth.users values($1);
`, [authId(n)]);
  await db.query(`insert into users(id,auth_user_id,email,display_name,status,deletion_requested_at,deletion_scheduled_for)
 values($1,$2,$3,$4,$5,now(),now()+$6::interval)`,
  [personId(n), authId(n), `person${n}@example.test`, `Personal ${n}`, status, due ? '-1 hour' : '1 day']);
  await db.query('insert into tax_profiles(user_id,display_name,contact_email,phone,company_name) values($1,$2,$3,$4,$5)',
    [personId(n), `Tax personal ${n}`, `tax${n}@example.test`, `555000${n}`, 'Personal firm']);
}

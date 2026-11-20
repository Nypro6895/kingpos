import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("reports are personal; automatic holds require review and cannot be bypassed", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table users(id uuid primary key,status text default 'active');
      create table platform_reports(id uuid primary key default gen_random_uuid(),category text,summary text,description text,source text,reporter_user_id uuid,subject_user_id uuid,priority text,status text,resolution text,resolved_by_user_id uuid,resolved_at timestamptz);
      create table salon_settings(salon_id uuid,public_profile_cover_path text);
      create table beauty_post_media(post_id uuid,object_path text);
      create table beauty_posts(id uuid primary key,profile_id uuid,author_user_id uuid,caption text,visibility text default 'public',moderation_status text default 'visible',deleted_at timestamptz);
      create table salon_profile_looks(id uuid primary key,salon_id uuid,author_user_id uuid,created_by_user_id uuid,title text,caption text,status text default 'published',media_path text,is_pinned boolean default false);
      create table salon_profile_updates(like salon_profile_looks including all);
      create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function platform_admin_has_permission(text) returns boolean language sql stable as $$select coalesce(current_setting('test.admin',true),'')='yes'$$;
      create function user_can_manage_salon(uuid) returns boolean language sql stable as $$select false$$;
      create function admin_set_user_access(uuid,text,boolean) returns jsonb language plpgsql as $$begin if not platform_admin_has_permission('admin.users.suspend') then raise exception 'Permission denied.'; end if; update users set status='suspended' where id=$1; return '{}'; end$$;
      insert into users(id) values('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
    `);
    await db.exec(fs.readFileSync("supabase/migrations/202610070007_post_safety.sql", "utf8"));
    await db.exec(`insert into beauty_posts(id,author_user_id,caption) values('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','A lovely manicure');`);
    await db.exec(`set test.uid='00000000-0000-0000-0000-000000000002';`);
    await db.query(`select post_safety_action('beauty_post','10000000-0000-0000-0000-000000000001','report','{"reason":"sexual"}')`);
    assert.equal((await db.query(`select visibility from beauty_posts`)).rows[0].visibility,"public");
    assert.equal((await db.query(`select count(*)::int n from post_safety_hidden`)).rows[0].n,1);
    await assert.rejects(db.query(`select post_safety_action('beauty_post','10000000-0000-0000-0000-000000000001','delete')`),/cannot manage/);
    await db.exec(`set test.uid='00000000-0000-0000-0000-000000000001'; update beauty_posts set caption='sexual content'`);
    assert.equal((await db.query(`select visibility,safety_hold from beauty_posts`)).rows[0].visibility,"self");
    await db.exec(`update beauty_posts set visibility='public',safety_hold=false`);
    assert.equal((await db.query(`select visibility from beauty_posts`)).rows[0].visibility,"self");
    await db.exec(`update beauty_posts set caption='Edited manicure'`);
    const automatic=(await db.query(`select id from post_safety_cases where origin='automatic'`)).rows[0].id;
    await assert.rejects(db.query(`select admin_review_post_safety($1,'allow','Safe context')`,[automatic]),/Permission denied/);
    await db.exec(`set test.admin='yes'`);
    await db.query(`select admin_review_post_safety($1,'allow','Safe context')`,[automatic]);
    assert.equal((await db.query(`select visibility from beauty_posts`)).rows[0].visibility,"public");
    await assert.rejects(db.query(`select admin_review_post_safety($1,'allow','Already reviewed')`,[automatic]),/no longer pending/);
    await db.exec(`set test.admin='no'; insert into salon_profile_looks(id,author_user_id,title,caption) values('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','New look','violent content')`);
    assert.equal((await db.query(`select status from salon_profile_looks`)).rows[0].status,"draft");
    await db.exec(`update salon_profile_looks set caption='sexual content'; set test.admin='yes'`);
    const salonCase=(await db.query(`select id from post_safety_cases where source_type='salon_profile_look'`)).rows[0].id;
    await db.query(`select admin_review_post_safety($1,'allow','No violation after context review')`,[salonCase]);
    assert.equal((await db.query(`select status from salon_profile_looks`)).rows[0].status,"published");
  } finally { await db.close(); }
});

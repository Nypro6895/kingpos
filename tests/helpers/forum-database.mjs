import fs from 'node:fs';import{PGlite}from'@electric-sql/pglite';
const ids={owner:'10000000-0000-4000-8000-000000000001',other:'10000000-0000-4000-8000-000000000002',staff:'10000000-0000-4000-8000-000000000003',mod:'10000000-0000-4000-8000-000000000004',admin:'10000000-0000-4000-8000-000000000005'};
async function database(){const db=new PGlite();await db.exec(`
 create role anon;create role authenticated;
 create table users(id uuid primary key,status text default 'active',display_name text);
 create table roles(id uuid primary key default gen_random_uuid(),code text);
 create table salon_memberships(user_id uuid,role_id uuid,status text default 'active');
 create table platform_admin_permissions(id uuid primary key default gen_random_uuid(),code text unique,name text,category text);
 create table platform_admin_roles(id uuid primary key default gen_random_uuid(),slug text);
 create table platform_admin_memberships(user_id uuid,role_id uuid,status text default 'active');
 create table platform_admin_role_permissions(role_id uuid,permission_id uuid,unique(role_id,permission_id));
 create function current_public_user_id() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
 create function platform_admin_has_permission(text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from platform_admin_memberships m join users u on u.id=m.user_id join platform_admin_role_permissions rp on rp.role_id=m.role_id join platform_admin_permissions p on p.id=rp.permission_id where m.user_id=current_public_user_id() and m.status='active' and u.status='active' and p.code=$1) $$;
 insert into roles(code) values('OWNER'),('STAFF');
 insert into platform_admin_roles(slug) values('platform_owner'),('operations_admin'),('moderator'),('support_agent');
 `);
 for(const [name,id] of Object.entries(ids))await db.query('insert into users(id,display_name) values($1,$2)',[id,name]);
 await db.exec(`insert into salon_memberships(user_id,role_id) select u.id,r.id from users u cross join roles r where (u.display_name in ('owner','other') and r.code='OWNER') or (u.display_name='staff' and r.code='STAFF');
 insert into platform_admin_memberships(user_id,role_id) select u.id,r.id from users u cross join platform_admin_roles r where (u.display_name='mod' and r.slug='moderator') or (u.display_name='admin' and r.slug='platform_owner');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261103180000_owner_forum.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261103181500_forum_feed_indexes.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261103183500_forum_numeric_order.sql','utf8'));
 return db;
}
async function as(db,user){await db.exec('reset role');await db.query("select set_config('test.user_id',$1,false)",[user??'']);await db.exec('set role authenticated');}
async function rpc(db,fn,input){return (await db.query(`select ${fn}($1::jsonb) result`,[JSON.stringify(input)])).rows[0].result;}
const read=(db,x)=>rpc(db,'forum_read',x),write=(db,x)=>rpc(db,'forum_write',x);
async function cooldown(db){await db.exec("reset role;update forum_rate_limits set last_at=now()-interval '2 minutes';set role authenticated");}


export {ids,database,as,read,write,cooldown};

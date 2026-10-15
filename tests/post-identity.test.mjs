import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
const require = createRequire(import.meta.url);
function load(path, overrides={}) {
 const module={exports:{}};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>overrides[name]??require(name)});
 return module.exports;
}
const identity=load('lib/post-identity.ts');
const {PostIdentity}=load('components/post-identity.tsx',{
 '@/lib/post-identity':identity,
 '@/components/workspace-language':{WorkspaceText:({text})=>text},
 'next/link':{default:({children,...props})=>{delete props.prefetch;return React.createElement('a',props,children);}},
});
const base={salonName:'King Nails',salonHref:'/explore/salons/king',authorName:'Ny Truong',authorHref:'/explore/beauty/ny'};
for(const role of ['owner','staff','salon']) test(`salon post identity: ${role}`,()=>{
 const html=renderToStaticMarkup(React.createElement(PostIdentity,{...base,source:'salon',authorRole:role}));
 assert.match(html,/data-post-primary[^>]*><a[^>]*href="\/explore\/salons\/king"[^>]*>King Nails/);
 if(role==='staff') assert.match(html,/data-post-secondary.*By .*Ny Truong/);
 else assert.doesNotMatch(html,/Ny Truong|data-post-secondary/);
});
test('missing salon metadata never promotes an owner name into the salon title',()=>{
 const html=renderToStaticMarkup(React.createElement(PostIdentity,{source:'salon',authorRole:'owner',authorName:'Private owner'}));
 assert.match(html,/Salon/); assert.doesNotMatch(html,/Private owner/);
});
test('personal post keeps the person primary and salon tag secondary, regardless of owner role',()=>{
 const html=renderToStaticMarkup(React.createElement(PostIdentity,{...base,source:'personal',authorRole:'owner'}));
 assert.match(html,/data-post-primary.*Ny Truong/);
 assert.match(html,/data-post-secondary.*At .*King Nails/);
});
test('personal post without a salon does not invent a salon tag',()=>{
 const html=renderToStaticMarkup(React.createElement(PostIdentity,{source:'personal',authorName:'Customer'}));
 assert.doesNotMatch(html,/data-post-secondary/);
});
test('database role snapshot: owner beats staff, private/draft posts stay private, edits cannot spoof identity',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon; create role authenticated;
 create table users(id uuid primary key,status text);
 create table roles(id uuid primary key,code text);
 create table locations(id uuid primary key,account_id uuid,public_visible boolean);
 create table account_memberships(user_id uuid,account_id uuid,role_id uuid,status text);
 create table salon_memberships(user_id uuid,salon_id uuid,role_id uuid,status text);
 create table salon_profile_looks(id uuid primary key,salon_id uuid,author_user_id uuid,author_staff_id uuid,status text);
 create table salon_profile_updates(like salon_profile_looks including all);
 create function salon_profile_public_salon_exists(uuid) returns boolean language sql as $$ select coalesce((select public_visible from locations where id=$1),false) $$;`);
 await db.exec(readFileSync('supabase/migrations/20261009010001_salon_post_attribution.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20261009020001_deleted_salon_post_attribution.sql','utf8'));
 const salon='00000000-0000-0000-0000-000000000001', account='00000000-0000-0000-0000-000000000002',owner='00000000-0000-0000-0000-000000000003',role='00000000-0000-0000-0000-000000000004',staff='00000000-0000-0000-0000-000000000005';
 await db.query('insert into locations values ($1,$2,true)',[salon,account]);
 await db.query('insert into roles values ($1,$2)',[role,'OWNER']);
 await db.query('insert into account_memberships values ($1,$2,$3,$4)',[owner,account,role,'active']);
 const ids=['00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012'];
 await db.query('insert into salon_profile_looks values ($1,$2,$3,$4,$5,$6)',[ids[0],salon,owner,staff,'published','staff']);
 await db.query('insert into salon_profile_updates values ($1,$2,null,$3,$4,$5)',[ids[1],salon,staff,'published','owner']);
 await db.query('insert into salon_profile_looks values ($1,$2,null,$3,$4,$5)',[ids[2],salon,staff,'draft','staff']);
 let result=await db.query('select * from get_public_salon_post_attribution($1::uuid[]) order by content_id',[ids]);
 assert.equal(result.rows.length,2); assert.equal(result.rows[0].author_role,'owner'); assert.equal(result.rows[0].staff_id,null); assert.equal(result.rows[1].author_role,'staff');
 await db.exec('delete from account_memberships');
 await db.query("update salon_profile_looks set author_presentation_role='staff' where id=$1",[ids[0]]);
 result=await db.query('select * from get_public_salon_post_attribution($1::uuid[])',[ [ids[0]] ]);
 assert.equal(result.rows[0].author_role,'owner');
 await db.query('insert into users values ($1,$2)',[staff,'deleted']);
 await db.query('update salon_profile_updates set author_user_id=$1 where id=$2',[staff,ids[1]]);
 result=await db.query('select * from get_public_salon_post_attribution($1::uuid[])',[ [ids[1]] ]);
 assert.equal(result.rows[0].author_role,'salon'); assert.equal(result.rows[0].staff_id,null);
 await db.exec('update locations set public_visible=false');
 result=await db.query('select * from get_public_salon_post_attribution($1::uuid[])',[ids]);
 assert.equal(result.rows.length,0);
 }finally{await db.close();}
});

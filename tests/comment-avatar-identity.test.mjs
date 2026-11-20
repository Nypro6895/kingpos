import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const migration = readFileSync('supabase/migrations/20261103021000_post_comment_avatar_identity.sql', 'utf8');

test('avatar RPC honors the saved persona and public visibility for old and new comments', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create table users(id uuid primary key, status text, avatar_url text);
      create table locations(id uuid primary key, name text, status text);
      create table salon_settings(salon_id uuid primary key, public_profile_logo_path text);
      create table staff(id uuid primary key, salon_id uuid, account_user_id uuid, is_active boolean,
        public_profile_photo_path text, online_booking_enabled boolean, salon_profile_content_posting_enabled boolean, created_at timestamptz default now());
      create function salon_profile_public_salon_exists(uuid) returns boolean language sql stable as $$select $1 <> '${uuid(12)}'::uuid$$;
      create table salon_profile_comments(id uuid primary key, author_user_id uuid, acting_role text, acting_salon_id uuid,
        is_salon_reply boolean default false, salon_id uuid, look_id uuid, update_id uuid, beauty_post_id uuid,
        parent_comment_id uuid, root_comment_id uuid, status text default 'visible');
      create function current_public_user_id() returns uuid language sql stable as
        $$select nullif(current_setting('test.actor', true), '')::uuid$$;
      create function post_comment_target_is_public(uuid,uuid,uuid,uuid) returns boolean language sql stable as
        $$select coalesce($1,$2,$3) <> '${uuid(999)}'::uuid$$;
      insert into users values ('${uuid(1)}','active','https://img.test/person.jpg'),('${uuid(2)}','deleted','https://img.test/deleted.jpg');
      insert into locations values ('${uuid(10)}','Target salon','active'),('${uuid(11)}','Acting salon','active');
      insert into salon_settings values ('${uuid(10)}','target/logo.webp'),('${uuid(11)}','acting/logo.webp');
    `);
    await db.exec(migration);
    const insert = async (n, role, { author = 1, acting = 11, official = false, status = 'visible', target = 100, parent = null, root = null } = {}) => {
      await db.query(`insert into salon_profile_comments(id,author_user_id,acting_role,acting_salon_id,is_salon_reply,salon_id,beauty_post_id,status,parent_comment_id,root_comment_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [uuid(n), uuid(author), role, role === 'salon' || role === 'staff' ? uuid(acting) : null, official, uuid(10), uuid(target), status, parent ? uuid(parent) : null, root ? uuid(root) : null]);
    };
    const identities = async (...ids) => (await db.query('select * from get_post_comment_identities($1)', [ids.map(uuid)])).rows;
    await t.test('personal, staff and legacy personal all use the person photo', async () => {
      for (const [n, role] of [[101,'personal'],[102,'staff'],[103,null]]) {
        await insert(n,role);
        const [row] = await identities(n);
        assert.equal(row.author_avatar_url,'https://img.test/person.jpg');
        assert.equal(row.salon_logo_path,null);
      }
    });
    await t.test('salon uses acting salon on another salon post; legacy official uses target salon', async () => {
      await insert(104,'salon'); await insert(105,null,{official:true});
      const rows = new Map((await identities(104,105)).map(row => [row.id,row]));
      assert.equal(rows.get(uuid(104)).salon_logo_path,'acting/logo.webp');
      assert.equal(rows.get(uuid(104)).salon_name,'Acting salon');
      assert.equal(rows.get(uuid(105)).salon_logo_path,'target/logo.webp');
      for (const row of rows.values()) assert.equal(row.author_avatar_url,null);
    });
    await t.test('staff photo comes from the linked staff role at the acting salon with existing public visibility', async () => {
      await db.query('insert into staff(id,salon_id,account_user_id,is_active,public_profile_photo_path,online_booking_enabled,salon_profile_content_posting_enabled) values($1,$2,$3,true,$4,true,false)',[uuid(20),uuid(11),uuid(1),'acting/staff.webp']);
      assert.equal((await identities(102))[0].staff_avatar_path,'acting/staff.webp');
      assert.equal((await identities(101))[0].staff_avatar_path,null);
      await db.exec('update staff set online_booking_enabled=false');
      assert.equal((await identities(102))[0].staff_avatar_path,null);
      await db.exec('update staff set online_booking_enabled=true');
    });
    await t.test('missing salon or logo never falls back to the actor photo', async () => {
      await insert(106,'salon',{acting:12});
      const [row] = await identities(106);
      assert.equal(row.author_avatar_url,null); assert.equal(row.salon_logo_path,null);
    });
    await t.test('deleted user photo is suppressed, salon identity remains independent', async () => {
      await insert(107,'personal',{author:2}); await insert(108,'salon',{author:2});
      const rows = await identities(107,108);
      assert.ok(rows.every(row => row.author_avatar_url === null));
      assert.equal(rows.find(row => row.id === uuid(108)).salon_logo_path,'acting/logo.webp');
    });
    await t.test('guest cannot look up hidden, deleted, private-target or reported comment identities', async () => {
      for (const [n,opts] of [[109,{status:'hidden'}],[110,{status:'deleted'}],[111,{target:999}],[112,{status:'reported'}]]) await insert(n,'personal',opts);
      await db.exec('set role anon');
      assert.deepEqual(await identities(109,110,111,112),[]);
      assert.equal((await identities(101)).length,1);
      await db.exec('reset role');
    });
    await t.test('only author can resolve their own reported comment after submission', async () => {
      await db.query("select set_config('test.actor',$1,false)",[uuid(1)]);
      await db.exec('set role authenticated'); assert.equal((await identities(112)).length,1);
      await db.query("select set_config('test.actor',$1,false)",[uuid(2)]);
      assert.deepEqual(await identities(112),[]); await db.exec('reset role');
    });
    await t.test('reply requires a visible root on the same target', async () => {
      await insert(113,'staff',{parent:101,root:101});
      await insert(114,'salon',{parent:109,root:109});
      await insert(115,'personal',{parent:101,root:101,target:200});
      assert.deepEqual((await identities(113,114,115)).map(row => row.id),[uuid(113)]);
    });
    await t.test('input size is bounded and function grants no table permissions', async () => {
      const ids = [...Array.from({length:256},()=>uuid(900)),uuid(101)];
      assert.deepEqual((await db.query('select * from get_post_comment_identities($1)',[ids])).rows,[]);
      await db.exec('set role anon');
      await assert.rejects(db.query('select avatar_url from users'),/permission denied/);
      await db.exec('reset role');
    });
  } finally { await db.close(); }
});

function load(source, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,console,require:name => {if (!(name in dependencies)) throw Error(name); return dependencies[name];}});
  return exports;
}
function functions(path,names) {
  const source = readFileSync(path,'utf8'), ast = ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
  return ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    .map(node => 'export '+source.slice(node.getStart(ast),node.end).replace(/^export\s+/, '')).join('\n');
}
test('server enrichment batches all replies and preserves role, avatar, name and comments on RPC failure', async () => {
  const calls = [];
  const client = { rpc: async (_name,{p_comment_ids}) => { calls.push(p_comment_ids); return {data:p_comment_ids.map(id => ({id,acting_role:'salon',acting_salon_id:'acting',salon_name:'Acting salon',author_avatar_url:null,salon_logo_path:'acting/logo.webp'}))}; },
    storage:{from:() => ({getPublicUrl:path => ({data:{publicUrl:`https://storage.test/${path}`}})})} };
  const source = `const createSupabaseServerClient=()=>client; const getReadableSupabaseClient=async()=>client;
    const normalizeSalonProfileMediaPath=path=>path; const SALON_PROFILE_MEDIA_BUCKET='salon-profile-media';
    const commentDisplayName=({authorName,isSalonReply,salonName})=>isSalonReply?salonName:authorName;
    ${functions('lib/post-comments.ts',['readCount','rowTargetType','rowTargetId','mapCommentRow','mapCommentRows'])}`;
  const api = load(`import {client} from 'fixture';\n${source}`,{fixture:{client}});
  const rows = Array.from({length:300},(_,n) => ({id:String(n),author_display_name:'Acting salon',body:'Hi',beauty_post_id:'post'}));
  const result = await api.mapCommentRows(rows);
  assert.deepEqual(calls.map(ids=>ids.length),[256,44]);
  assert.equal(result.length,300);
  for (const row of result) { assert.equal(row.authorAvatarUrl,'https://storage.test/acting/logo.webp'); assert.equal(row.actingSalonId,'acting'); }
  client.rpc = async () => ({error:{message:'missing RPC'}});
  client.from = () => ({select:() => ({in:async()=>({data:[]})})});
  const fallback = await api.mapCommentRows([rows[0]]);
  assert.equal(fallback[0].body,'Hi'); assert.equal(fallback[0].authorAvatarUrl,null);
});

test('optimistic identity and realtime merging never substitute viewer avatar for stored role', () => {
  const source = functions('app/post-comments/post-comment-thread.tsx',['nowIso','mergeComments','createOptimisticComment']);
  const api = load(`const commentDisplayName=({salonName})=>salonName;\n${source}`,{});
  const base = {body:'Hi',parentComment:null,target:{sourceType:'beauty_post',sourceId:'post',salonId:'target',salonName:'Target salon'},viewer:{userId:'user',identity:{name:'Actor',role:'staff',salonId:'acting',avatarUrl:'https://img.test/staff.jpg'}}};
  const staff = api.createOptimisticComment({...base,asSalonReply:false});
  assert.equal(staff.authorAvatarUrl,base.viewer.identity.avatarUrl); assert.equal(staff.actingRole,'staff');
  const salon = api.createOptimisticComment({...base,asSalonReply:true});
  assert.equal(salon.authorAvatarUrl,null); assert.equal(salon.authorDisplayName,'Target salon'); assert.equal(salon.actingSalonId,'target');
  const merged = api.mergeComments([{id:'comment',authorAvatarUrl:'https://img.test/staff.jpg',body:'Old'}],[{id:'comment',body:'Edited'}]);
  assert.equal(merged[0].authorAvatarUrl,'https://img.test/staff.jpg');
  assert.equal(api.mergeComments(merged,[{id:'comment',authorAvatarUrl:null}])[0].authorAvatarUrl,null);
});

test('avatar renders photo, falls back after error, and retries a changed URL', () => {
  let failed = null;
  const jsx = (type,props) => ({type,props});
  const {CommentAvatar} = load(readFileSync('app/post-comments/comment-avatar.tsx','utf8'),{
    'next/image':{default:'Image',__esModule:true},'react':{useState:()=>[failed,value=>{failed=value;}]},'react/jsx-runtime':{jsx,jsxs:jsx}
  });
  const props={name:'Nene',avatarUrl:'https://img.test/nene.jpg'};
  let tree=CommentAvatar(props); assert.equal(tree.props.children.props.src,props.avatarUrl);
  tree.props.children.props.onError(); assert.equal(CommentAvatar(props).props.children,'NE');
  assert.equal(CommentAvatar({...props,avatarUrl:'https://img.test/new.jpg'}).props.children.props.src,'https://img.test/new.jpg');
  assert.equal(CommentAvatar({...props,avatarUrl:'javascript:alert(1)'}).props.children,'NE');
});

test('composer chooses personal, staff profile and salon avatars consistently with the saved persona', () => {
  const {exploreCommentIdentity} = load(readFileSync('lib/explore-comment-identity.ts','utf8'),{});
  const context={user:{id:'actor',display_name:'Nene',avatar_url:'https://img.test/account.jpg'},workspaceType:'personal',permissions:[],permissionCodes:[],currentWorkspace:{avatarUrl:'https://img.test/salon.jpg',staffAvatarUrl:'https://img.test/staff.jpg'},currentSalon:{id:'salon',name:'King Nails'},currentStaffSalon:{id:'salon',name:'King Nails'}};
  assert.equal(exploreCommentIdentity(context).avatarUrl,context.user.avatar_url);
  const staff=exploreCommentIdentity({...context,workspaceType:'salon',salonMode:'staff'});
  assert.equal(staff.avatarUrl,context.currentWorkspace.staffAvatarUrl); assert.equal(staff.role,'staff');
  const salon=exploreCommentIdentity({...context,workspaceType:'salon',salonMode:'owner',permissions:['salon_profile.manage']});
  assert.equal(salon.avatarUrl,context.currentWorkspace.avatarUrl); assert.equal(salon.role,'salon');
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
const posts=JSON.parse(fs.readFileSync('supabase/seeds/forum-starter-content.json','utf8'));
test('starter content is predominantly Vietnamese and focused on real salon situations',()=>{
 assert.equal(posts.length,15);assert.equal(posts.filter(p=>p.language==='vi').length,12);
 const sections=new Map;for(const p of posts){sections.set(p.section,(sections.get(p.section)||0)+1);assert.equal(p.replies.length,2);assert.ok(p.title.length>=5&&p.title.length<=180);assert.ok(p.body.length>100);assert.ok(p.replies.every(r=>r.length>50));}
 assert.deepEqual([...sections.values()],[3,3,3,3,3]);
 assert.equal(new Set(posts.map(p=>p.title)).size,15);
 assert.ok(!posts.some(p=>/lọc bài|tiểu bang|tạo chuyên mục|where should we share/i.test(p.title)));
});
test('rewrite replaces all starter questions/replies while preserving real owners and moderation',async()=>{
 const source=fs.readFileSync('tests/forum-runtime.test.mjs','utf8'),fixture=source.slice(source.indexOf('const ids='),source.indexOf("test('"));
 const {db,ids,as,read,write}=await new (Object.getPrototypeOf(async function(){}).constructor)('PGlite','fs',fixture+';return {db:await database(),ids,as,read,write};')(PGlite,fs);
 try{
  await db.exec(fs.readFileSync('supabase/migrations/20261103190000_forum_starter_discussions.sql','utf8'));
  await as(db,ids.owner);const ctx=await read(db,{mode:'context'}),own=await write(db,{op:'topic',section:ctx.sections[0].id,title:'Actual owner discussion',body:'Do not overwrite a real owner post'});
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261103200000_forum_starter_content_rewrite.sql','utf8'));
  // Repeating the content updates must be safe, including after moderator soft-delete.
  await as(db,ids.mod);const topicId='f0100000-0000-4000-8000-000000000001';await write(db,{op:'delete',kind:'topic',id:topicId,reason:'Keep moderator decisions'});
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261103200000_forum_starter_content_rewrite.sql','utf8'));
  assert.ok((await db.query('select deleted_at from forum_topics where id=$1',[topicId])).rows[0].deleted_at);
  await as(db,ids.mod);
  for(let i=0;i<15;i++){const id=`f0100000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,d=await read(db,{mode:'topic',id});assert.equal(d.topic.title,posts[i].title);assert.equal(d.topic.body,posts[i].body);assert.deepEqual(d.replies.map(r=>r.body),posts[i].replies);}
  assert.equal((await read(db,{mode:'topic',id:own.id})).topic.body,'Do not overwrite a real owner post');
  await as(db,ids.staff);await assert.rejects(read(db,{mode:'feed'}),/salon owners/);
 }finally{await db.close();}
});

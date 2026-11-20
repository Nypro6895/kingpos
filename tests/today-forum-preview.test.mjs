import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {database,as,ids,write} from './helpers/forum-database.mjs';
test('Today preview returns two newest visible posts, bounded text and existing forum authorization',async()=>{
 const db=await database();try{
 await db.exec(fs.readFileSync('supabase/migrations/20261104011000_today_forum_preview.sql','utf8'));
 await as(db,ids.owner);const context=(await db.query(`select forum_read('{"mode":"context"}') data`)).rows[0].data;const section=context.sections[0].id;
 const first=(await write(db,{op:'topic',section,title:'First newer post',body:'A long\n\n story '.repeat(80)})).id;
 await db.exec('reset role');await db.exec(`delete from forum_rate_limits`);await as(db,ids.owner);
 const second=(await write(db,{op:'topic',section,title:'Second newer post',body:'Short preview'})).id;
 await db.exec(`reset role;update forum_topics set created_at='2026-11-03T10:00:00Z',pinned=true where id='${first}';update forum_topics set created_at='2026-11-03T11:00:00Z' where id='${second}'`);await as(db,ids.owner);
 const read=async()=> (await db.query(`select forum_read('{"mode":"latest_preview"}') data`)).rows[0].data;
 let posts=await read();assert.deepEqual(posts.map(x=>x.id),[second,first]);assert.equal(posts[1].excerpt.length,160);assert(!/\n/.test(posts[1].excerpt));assert.deepEqual(Object.keys(posts[0]).sort(),['created_at','excerpt','id','title']);
 await db.exec(`reset role;update forum_topics set deleted_at=now() where id='${second}'`);await as(db,ids.owner);posts=await read();assert.deepEqual(posts.map(x=>x.id),[first]);
 await as(db,ids.staff);await assert.rejects(read,/owners|permission/i);await as(db,null);await assert.rejects(read,/active account/i);
 }finally{await db.close();}
});

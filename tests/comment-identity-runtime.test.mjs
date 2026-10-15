import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
function load(code,dependencies={}){
 const exports={};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>dependencies[name]});return exports;
}
const display=load(readFileSync('lib/deleted-user-display.ts','utf8'));
const identity=load(readFileSync('lib/comment-identity.ts','utf8'),{'@/lib/deleted-user-display':display});
for(const user of [undefined,null])test(`unavailable user (${user}) preserves a known public snapshot`,()=>{
 assert.equal(display.isDeletedUserLike(user),false);
 assert.equal(display.getHistoricalUserDisplayName({user,context:'review',fallbackName:'Personal name'}),'Personal name');
});
for(const status of ['active','suspended','pending_deletion'])test(`${status} is not deleted and display name has consistent precedence`,()=>{
 assert.equal(display.getHistoricalUserDisplayName({context:'review',fallbackName:'Old name',user:{status,email:null,display_name:'Public name',first_name:'First',last_name:'Last'}}),'Public name');
});
test('actual deleted accounts never reveal old names',()=>{
 for(const context of ['review','generic','staff','owner','customer']){
 const name=display.getHistoricalUserDisplayName({context,fallbackName:'Private snapshot',user:{status:'deleted',display_name:'Private live name',email:null}});
 assert.doesNotMatch(name,/Private/);
 }
 assert.equal(display.getHistoricalUserDisplayName({context:'review',fallbackName:'Deleted user'}),'Deleted user');
});
test('missing names receive a neutral label without claiming account deletion',()=>{
 assert.equal(display.getHistoricalUserDisplayName({context:'review'}),'Reylumi customer');
 assert.equal(display.getHistoricalUserDisplayName({context:'staff'}),'Staff member');
});
test('official salon replies never expose an actor name, including deleted actors',()=>{
 assert.equal(identity.commentDisplayName({authorName:'Owner',isSalonReply:true,salonName:'King Nails'}),'King Nails');
 assert.equal(identity.commentDisplayName({authorName:'Deleted user',isSalonReply:true,salonName:'King Nails'}),'King Nails');
 assert.equal(identity.commentDisplayName({authorName:'Owner',isSalonReply:true}),'Salon');
 assert.equal(identity.commentDisplayName({authorName:'Staff',isSalonReply:false,salonName:'King Nails'}),'Staff');
});
function selectFunctions(path,names){
 const source=readFileSync(path,'utf8');
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 return ast.statements.filter(node=>ts.isFunctionDeclaration(node)&&names.includes(node.name?.text)).map(node=>'export '+source.slice(node.getStart(ast),node.end).replace(/^export\s+/, '')).join('\n');
}
// Functions selected from the real server module keep the actual display resolver.
const commentMapper=load(`import {commentDisplayName} from '@/lib/comment-identity';\n${selectFunctions('lib/post-comments.ts',['readCount','rowTargetType','rowTargetId','mapCommentRow'])}`,{'@/lib/comment-identity':identity});
const profiles=load(`import {getHistoricalUserDisplayName} from '@/lib/deleted-user-display';\n${selectFunctions('lib/salon-profile.ts',['readMoney','mapPublicReview','publicExperienceState','publicExperienceIssueStatus','mapPublicExperience'])}`,{'@/lib/deleted-user-display':display});
test('actual comment, review and experience server mappers retain active personal names',()=>{
 const row={author_display_name:'Personal name',author_user_id:'actor',body:'Hello',look_id:'look',source:'experience'};
 for(const mapper of [commentMapper.mapCommentRow,profiles.mapPublicReview,profiles.mapPublicExperience]) assert.equal(mapper(row).authorDisplayName,'Personal name');
 assert.equal(commentMapper.mapCommentRow({...row,is_salon_reply:true,salon_name:'King Nails'}).authorDisplayName,'King Nails');
 for(const mapper of [commentMapper.mapCommentRow,profiles.mapPublicReview,profiles.mapPublicExperience]) assert.equal(mapper({...row,author_display_name:'Deleted user'}).authorDisplayName,'Deleted user');
});

const realtime=load(`import {commentDisplayName} from '@/lib/comment-identity';\n${selectFunctions('app/post-comments/post-comment-thread.tsx',['nowIso','readText','readBoolean','readInteger','realtimeTargetType','realtimeTargetId','mapRealtimeComment'])}`,{'@/lib/comment-identity':identity});
test('realtime and server agree on personal, deleted and official salon identities',()=>{
 const target={sourceType:'salon_profile_look',sourceId:'look',salonName:'King Nails'};
 for(const [name,official] of [['Personal name',false],['Deleted user',false],['Owner',true]]){
  const row={id:'comment',look_id:'look',body:'Hello',author_display_name:name,is_salon_reply:official,salon_name:'King Nails'};
  assert.equal(realtime.mapRealtimeComment(row,target).authorDisplayName,commentMapper.mapCommentRow(row).authorDisplayName);
 }
});
test('replying preserves the explicitly chosen persona even for salon managers',()=>{
 const source=readFileSync('app/post-comments/post-comment-thread.tsx','utf8');
 const ast=ts.createSourceFile('thread.tsx',source,ts.ScriptTarget.Latest,true);
 let beginReply;
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='beginReply')beginReply=node;ts.forEachChild(node,visit);}visit(ast);
 const code=ts.transpileModule(source.slice(beginReply.getStart(ast),beginReply.end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const initialPersona of [false,true]){
  let persona=initialPersona;
  const context={draftVersionRef:{current:0},setReplyTo:()=>{},viewer:{canReplyAsSalon:true},setAsSalonReply:value=>{persona=value;},window:{requestAnimationFrame:callback=>callback()},textareaRef:{current:{focus:()=>{}}}};
  vm.createContext(context);vm.runInContext(code,context);context.beginReply({authorDisplayName:'Customer'});
  assert.equal(persona,initialPersona);
 }
});

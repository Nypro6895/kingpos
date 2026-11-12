// Explicitly creates a fresh loopback-only test cluster using an EXISTING
// portable PostgreSQL installation. Never reads project env/database credentials.
import fs from 'node:fs';import path from 'node:path';import net from 'node:net';
import {randomUUID,randomBytes}from'node:crypto';import{execFileSync,spawn}from'node:child_process';import assert from'node:assert/strict';
const pgBin=path.resolve(process.argv[2]??'');
if(!process.argv[2])throw Error('Provide the existing portable PostgreSQL bin directory. No software is downloaded.');
for(const exe of ['postgres.exe','initdb.exe','pg_ctl.exe','psql.exe'])if(!fs.existsSync(path.join(pgBin,exe)))throw Error('Missing existing PostgreSQL executable: '+exe);
const root=path.resolve('C:/Reylumi/tmp/kingpos-pg-race-'+randomUUID()),data=path.join(root,'data'),passwordFile=path.join(root,'ephemeral-password');
const port=55400+randomBytes(2).readUInt16BE()%1500,password=randomBytes(32).toString('base64url');
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG'))),PGPASSWORD:password,PGCONNECT_TIMEOUT:'5',PGAPPNAME:'kingpos-isolated-concurrency-test'};
const run=(exe,args,input)=>execFileSync(path.join(pgBin,exe),args,{input,encoding:'utf8',windowsHide:true,env,timeout:45000,maxBuffer:4*1024*1024});
const args=['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','kingpos_test','-d','postgres'];
const sql=text=>run('psql.exe',args,text);
function definition(file,name){const s=fs.readFileSync(file,'utf8'),start=s.search(new RegExp('create (?:or replace )?function public\\.'+name+'\\('));assert(start>=0);return s.slice(start,s.indexOf('$$;',s.indexOf('as $$',start))+3);}
const id=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1),author=id(2),third=id(3),topic=id(10),reply=id(11);
let sessionA,postgresProcess,stopped=false,receipt;
try{
 const probe=net.createServer();await new Promise((resolve,reject)=>probe.once('error',reject).listen(port,'127.0.0.1',resolve));await new Promise(resolve=>probe.close(resolve));
 assert(!fs.existsSync(root));fs.mkdirSync(root,{recursive:true});fs.writeFileSync(passwordFile,password+'\n',{mode:0o600,flag:'wx'});
 run('initdb.exe',['-D',data,'--username=kingpos_test','--encoding=UTF8','--locale=C','--auth=scram-sha-256','--pwfile='+passwordFile]);fs.unlinkSync(passwordFile);
 // Standard foreground entrypoint, under exactly the current non-elevated
 // account. No restricted-token override, impersonation or security flag.
 const serverLog=fs.openSync(path.join(root,'server.log'),'a');
 postgresProcess=spawn(path.join(pgBin,'postgres.exe'),['-D',data,'-h','127.0.0.1','-p',String(port)],{env,windowsHide:true,stdio:['ignore',serverLog,serverLog]});fs.closeSync(serverLog);
 let startupError;postgresProcess.on('error',error=>{startupError=error;});
 const startupDeadline=Date.now()+20000;
 while(true){
  if(startupError||postgresProcess.exitCode!==null)throw Error('Test PostgreSQL did not start; inspect '+path.join(root,'server.log'));
  try{sql('select 1;');break;}catch{if(Date.now()>startupDeadline)throw Error('Test PostgreSQL readiness timed out');await new Promise(r=>setTimeout(r,100));}
 }
 assert.equal(path.resolve(sql('show data_directory;').trim()),data,'Refuse to use any preexisting cluster');
 assert.equal(sql('show listen_addresses;').trim(),'127.0.0.1');
 const version=sql('select version();').trim();
 sql(`create role anon;create role authenticated;create role service_role;
 create table users(id uuid primary key,status text,display_name text);create table roles(id uuid primary key,code text);create table salon_memberships(user_id uuid,role_id uuid,status text);
 create table platform_admin_memberships(user_id uuid,role_id uuid,status text);create table platform_admin_role_permissions(role_id uuid,permission_id uuid);create table platform_admin_permissions(id uuid,code text);
 create table forum_topics(id uuid primary key,author_id uuid,title text,deleted_at timestamptz);create table forum_replies(id uuid primary key,topic_id uuid,author_id uuid,body text,deleted_at timestamptz);
 create table forum_subscriptions(user_id uuid,topic_id uuid,enabled boolean,last_read_at timestamptz,updated_at timestamptz default now(),primary key(user_id,topic_id));
 create table user_blocks(blocker_user_id uuid,blocked_user_id uuid,primary key(blocker_user_id,blocked_user_id));
 create table app_notifications(id uuid primary key default gen_random_uuid(),recipient_user_id uuid,recipient_kind text,notification_type text,booking_id uuid,salon_id uuid,forum_topic_id uuid,title text,body text,href text,event_key text,read_at timestamptz,created_at timestamptz default now());
 create unique index forum_unread_notification on app_notifications(recipient_user_id,forum_topic_id) where notification_type='forum_reply' and read_at is null;
 create table bookings(id uuid,salon_id uuid,staff_id uuid,status text,confirmation_status text,updated_at timestamptz,start_at timestamptz,salon_timezone_snapshot text,customer_id uuid);
 create table customers(id uuid,name text);create table staff(id uuid,salon_id uuid,is_active boolean,account_user_id uuid,user_id uuid);create table booking_lines(booking_id uuid,assigned_staff_id uuid,service_name_snapshot text,display_order integer);
 create function current_public_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function notification_delivery_enabled(uuid,text,text) returns boolean language sql as $$select true$$;
 create function financial_notice_suppressed(n app_notifications) returns boolean language sql stable security definer as $$select n.notification_type='hidden_financial'$$;
 alter table app_notifications enable row level security;grant select on app_notifications to authenticated;
 create policy notifications_recipient_read on app_notifications for select to authenticated using(recipient_user_id=current_public_user_id());
 insert into users values('${actor}','active','Recipient'),('${author}','active','Reply author'),('${third}','active','Third recipient');
 insert into roles values('${id(90)}','OWNER');insert into salon_memberships select id,'${id(90)}','active' from users;
 insert into forum_topics values('${topic}','${third}','Isolated test topic',null);insert into forum_subscriptions(user_id,topic_id,enabled) values('${actor}','${topic}',true);
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title) values('${actor}','customer','payment_receipt','Keep receipt'),('${actor}','customer','hidden_financial','Keep financial suppression');
 insert into bookings(id,salon_id,staff_id,status) values('${id(31)}','${id(32)}','${id(33)}','scheduled');
 insert into staff values('${id(34)}','${id(32)}',true,'${actor}',null);
 insert into app_notifications(recipient_user_id,recipient_kind,notification_type,title,booking_id) values('${actor}','staff','booking_confirmed','Keep staff assignment guard','${id(31)}');`);
 sql(definition('supabase/migrations/202610140002_user_blocking.sql','social_users_blocked'));
 sql(definition('supabase/migrations/20261104010000_forum_continuous_feed.sql','forum_is_following'));
 let producer=definition('supabase/migrations/20261104010000_forum_continuous_feed.sql','forum_notify_reply');
 const marker='where recipient.id<>new.author_id';assert(producer.includes(marker));
 producer=producer.replace(marker,marker+' and not public.social_users_blocked(recipient.id,new.author_id) and not public.social_users_blocked(recipient.id,topic.author_id)');
 sql(producer+';create trigger forum_reply_notification after insert on forum_replies for each row execute function forum_notify_reply();');
 sql(definition('supabase/migrations/20261109220000_forum_privacy_completion.sql','forum_after_personal_block')+';create trigger forum_after_personal_block after insert on user_blocks for each row execute function forum_after_personal_block();');
 let visible=definition('supabase/migrations/202610060001_unified_notification_feed.sql','notification_visible_to_actor');
 visible=visible.replace('select n.recipient_user_id','select not public.financial_notice_suppressed(n) and n.recipient_user_id');sql(visible);
 for(const name of ['notification_feed','mark_all_center_notifications'])sql(definition('supabase/migrations/202610060001_unified_notification_feed.sql',name));
 // A real persistent backend holds the trigger-generated notifications uncommitted.
 sessionA=spawn(path.join(pgBin,'psql.exe'),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output='',errors='';sessionA.stdout.on('data',b=>{output+=b;});sessionA.stderr.on('data',b=>{errors+=b;});
 const waitFor=async marker=>{const until=Date.now()+10000;while(!output.includes(marker)){if(sessionA.exitCode!==null||Date.now()>until)throw Error('Session A barrier failed: '+errors);await new Promise(r=>setTimeout(r,20));}};
 sessionA.stdin.write(`BEGIN;select 'PID_A='||pg_backend_pid();select 'ISOLATION='||current_setting('transaction_isolation');insert into forum_replies values('${reply}','${topic}','${author}','Test reply',null);select 'A_READY';\n`);
 await waitFor('A_READY');
 const b=sql(`BEGIN;select 'PID_B='||pg_backend_pid();insert into user_blocks values('${actor}','${author}');select 'B_SEES_ROWS='||count(*) from app_notifications where notification_type='forum_reply' and recipient_user_id='${actor}';COMMIT;select 'B_COMMITTED';`);
 assert(b.includes('B_COMMITTED'));assert(b.includes('B_SEES_ROWS=0'));
 sessionA.stdin.write('COMMIT;select \'A_COMMITTED\';\n');await waitFor('A_COMMITTED');sessionA.stdin.end('\\q\n');
 const pidA=Number(output.match(/PID_A=(\d+)/)?.[1]),pidB=Number(b.match(/PID_B=(\d+)/)?.[1]);assert(pidA&&pidB&&pidA!==pidB);assert(output.includes('ISOLATION=read committed'));
 const inspect=()=>JSON.parse(sql(`select set_config('test.actor','${actor}',false);set role authenticated;select json_build_object('directRows',(select count(*) from app_notifications where notification_type='forum_reply'),'feed',notification_feed('owner_manager'));`).trim().split(/\r?\n/).at(-1));
 const before=inspect();assert.equal(before.directRows,1);assert.equal(before.feed.unreadCount,2);
 assert(!before.feed.items.some(n=>n.notification_type==='hidden_financial'||n.notification_type==='booking_confirmed'));
 sql(fs.readFileSync('supabase/migrations/20261109223100_forum_notification_visibility.sql','utf8'));
 const after=inspect();assert.equal(after.directRows,0);assert.equal(after.feed.unreadCount,1);assert(!after.feed.items.some(n=>n.notification_type==='forum_reply'));
 const otherRows=Number(sql(`select set_config('test.actor','${third}',false);set role authenticated;select count(*) from app_notifications where notification_type='forum_reply';`).trim().split(/\r?\n/).at(-1));assert.equal(otherRows,1);
 assert.equal(Number(sql(`select count(*) from app_notifications where recipient_user_id='${actor}' and notification_type='forum_reply';`).trim()),1,'The fix does not rely on deleting the raced row');
 // Reverse order in two further genuine backends: committed block precedes reply.
 sql(`insert into users values('${id(4)}','active','Recipient two'),('${id(5)}','active','Author two');insert into salon_memberships values('${id(4)}','${id(90)}','active'),('${id(5)}','${id(90)}','active');insert into forum_topics values('${id(12)}','${third}','Reverse order topic',null);insert into forum_subscriptions(user_id,topic_id,enabled) values('${id(4)}','${id(12)}',true);`);
 const blockFirst=sql(`BEGIN;select 'PID_BLOCK='||pg_backend_pid();insert into user_blocks values('${id(4)}','${id(5)}');COMMIT;`);
 const replyLater=sql(`BEGIN;select 'PID_REPLY='||pg_backend_pid();insert into forum_replies values('${id(13)}','${id(12)}','${id(5)}','Reply after block',null);COMMIT;`);
 const reverse={pidBlock:Number(blockFirst.match(/PID_BLOCK=(\d+)/)?.[1]),pidReply:Number(replyLater.match(/PID_REPLY=(\d+)/)?.[1]),recipientRows:Number(sql(`select count(*) from app_notifications where recipient_user_id='${id(4)}' and notification_type='forum_reply';`).trim()),thirdRecipientRows:Number(sql(`select count(*) from app_notifications where recipient_user_id='${third}' and forum_topic_id='${id(12)}';`).trim())};
 assert(reverse.pidBlock&&reverse.pidReply&&reverse.pidBlock!==reverse.pidReply);assert.equal(reverse.recipientRows,0);assert.equal(reverse.thirdRecipientRows,1);
 receipt={passed:true,version,pidA,pidB,isolation:'read committed',interleaving:'A trigger inserts uncommitted → B block+cleanup commits seeing zero rows → A commits → fresh recipient reads',before,after,thirdRecipientRows:otherRows,reverseOrder:reverse,dataDirectory:data,port,productionUsed:false,softwareInstalled:false,startup:'standard postgres executable under current non-elevated account'};
}finally{
 if(sessionA&&sessionA.exitCode===null){sessionA.stdin.end();sessionA.kill();}
 if(data.startsWith(path.resolve('C:/Reylumi/tmp/kingpos-pg-race-'))&&fs.existsSync(path.join(data,'postmaster.pid'))){run('pg_ctl.exe',['-D',data,'-m','fast','-w','stop']);stopped=true;}
 if(fs.existsSync(passwordFile))fs.unlinkSync(passwordFile);
 if(receipt){receipt.testServerStopped=stopped;receipt.passwordFileRemoved=!fs.existsSync(passwordFile);fs.mkdirSync('artifacts/app-store-report-consumer-20261109',{recursive:true});fs.writeFileSync('artifacts/app-store-report-consumer-20261109/two-session-result.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));}
}

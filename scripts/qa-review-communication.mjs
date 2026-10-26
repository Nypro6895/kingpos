// Real local Next.js UI against the linked Supabase database. Dedicated fixtures only.
// No Twilio sends or emails. All fixture users, requests and files are removed in finally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {chromium} from 'playwright-core';
process.loadEnvFile('.env.local');
const base=process.env.REVIEW_QA_BASE_URL??'http://localhost:3105';
const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-communication-qa-'));
const output='artifacts/review-communication-qa';fs.mkdirSync(output,{recursive:true});
function sql(text){
 const file=path.join(dir,randomUUID()+'.sql');fs.writeFileSync(file,text);
 try{let result;for(let attempt=0;attempt<3;attempt++){result=spawnSync(process.execPath,[path.join(path.dirname(process.execPath),'node_modules/npm/bin/npx-cli.js'),'supabase','db','query','--linked','--file',file],{encoding:'utf8',timeout:240000});
 if(result.status===0)break;if(!/40P01/.test(result.stdout+'\n'+result.stderr)||attempt===2)throw new Error((result.stdout+'\n'+result.stderr).slice(0,5000));}
 const raw=result.stdout.slice(result.stdout.indexOf('{'));return JSON.parse(raw).rows;
 }finally{fs.unlinkSync(file);}
}
const fixtures=[];const salon=randomUUID(),account=randomUUID(),postCase=randomUUID(),source=randomUUID();
let browser;let navigationMetrics;const checks=[];const errors=[];const recordCheck=checks.push.bind(checks);checks.push=(...values)=>{for(const value of values)console.log(value);return recordCheck(...values);};
async function fixture(role){
 const ticket=randomUUID(),email=`review-qa-${randomUUID()}@example.invalid`,password=randomBytes(30).toString('hex');
 fixtures.push({ticket,email,role});const record=fixtures.at(-1);
 sql(`insert into abuse_signup_tickets(token,email_hash,device_hash) select '${ticket}',encode(extensions.hmac('email:${email}',signing_key,'sha256'),'hex'),encode(extensions.digest('qa:${ticket}','sha256'),'hex') from abuse_system_settings where id;`);
 const result=await service.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{abuse_signup_ticket:ticket,display_name:`Review QA ${role}`}});
 if(result.error)throw result.error;record.auth=result.data.user.id;
 const rows=sql(`insert into users(auth_user_id,email,display_name,status) values('${record.auth}','${email}','Review QA ${role}','active') on conflict(auth_user_id) do update set display_name=excluded.display_name returning id;`);record.user=rows[0].id;fs.writeFileSync(`${output}/fixture-ids.json`,JSON.stringify(fixtures.map(({auth,user,ticket,email})=>({auth,user,ticket,email})),null,2));
 const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const login=await client.auth.signInWithPassword({email,password});if(login.error)throw login.error;
 record.client=client;record.session=login.data.session;return record;
}
async function rpc(person,name,args){const result=await person.client.rpc(name,args);if(result.error)throw new Error(`${name}: ${result.error.message}`);return result.data;}
async function pageFor(person,width=1440){const context=await browser.newContext({viewport:{width,height:900}});await context.addCookies([
 {name:'sb-access-token',value:person.session.access_token,url:base,httpOnly:true,sameSite:'Lax'},
 {name:'sb-refresh-token',value:person.session.refresh_token,url:base,httpOnly:true,sameSite:'Lax'},
 ]);const page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',e=>errors.push(e.message));
 await page.addLocatorHandler(page.locator('dialog[aria-labelledby="windows-pos-title"][open]'),async(dialog)=>{await dialog.getByRole('button',{name:'Don’t remind me again',exact:true}).click();});
 return page;}
try{
 const user=await fixture('applicant'),admin=await fixture('reviewer'),outsider=await fixture('outsider');
 sql(`begin;
 insert into platform_admin_memberships(user_id,role_id,status) select '${admin.user}',id,'active' from platform_admin_roles where slug='platform_owner';
 insert into accounts(id,name,status) values('${account}','Review browser QA','active');
 insert into locations(id,account_id,name,status,phone,city,state,address_line1) values('${salon}','${account}','Review browser QA salon','active','555-234-6789','Madison','WI','QA fixture ${salon}');
 insert into salon_settings(salon_id,business_name,public_discovery_enabled) values('${salon}','Review browser QA salon',true);
 insert into salon_directory_listings(listing_id,salon_id,source_url,source_type,collected_on) values('review-browser-qa-${salon}','${salon}','https://example.invalid','directory',current_date);
 insert into notification_preferences(user_id,category,enabled) values('${user.user}','team',false),('${user.user}','comments',false);
 insert into post_safety_cases(id,source_type,source_id,origin,reason,content_snapshot,reporter_user_id) values('${postCase}','beauty_post','${source}','user','unwanted','{"title":"Isolated browser QA content"}','${user.user}');
 commit;`);
 const claim=await rpc(user,'request_business_claim_support',{p_salon:salon,p_reason:'I own this salon and request a review of my ownership documents.'});
 const report=await rpc(user,'get_review_support_link',{p_kind:'claim',p_request:claim});
 browser=await chromium.launch({channel:'chrome',headless:true});
 const userPage=await pageFor(user,390),adminPage=await pageFor(admin),outsiderPage=await pageFor(outsider);
 if(!process.env.REVIEW_QA_REPORT_ONLY){
 await userPage.goto(`${base}/support/${report}`,{waitUntil:'domcontentloaded'});
 await userPage.getByRole('heading',{name:'Ownership claim: Review browser QA salon'}).waitFor();checks.push('Authenticated user opens persistent claim conversation');
 await adminPage.goto(`${base}/admin/claims?q=Review%20browser%20QA&status=waiting`,{waitUntil:'domcontentloaded'});
 await adminPage.locator('main article').getByText('Review ownership claim',{exact:true}).first().click();
 await adminPage.getByLabel('Explanation for the applicant').fill('Please upload a business license and an authorization letter.');
 await adminPage.getByLabel('Internal note (optional)').fill('INTERNAL-BROWSER-QA-SECRET');
 await adminPage.getByRole('button',{name:'Request information',exact:true}).click();
 await userPage.getByRole('button',{name:'Refresh conversation',exact:true}).click();await userPage.locator('main').getByText(/Please upload a business license and an authorization letter/).first().waitFor();
 assert.ok(!(await userPage.locator('body').innerText()).includes('INTERNAL-BROWSER-QA-SECRET'));checks.push('Admin requests specific documents; public message arrives and private note stays private');
 await userPage.screenshot({path:`${output}/claim-needs-information-mobile.png`,fullPage:true});
 const notifications=await user.client.from('app_notifications').select('id,title,notification_type,href').eq('recipient_user_id',user.user).eq('href',`/support/${report}`);
 assert.ifError(notifications.error);assert.ok(notifications.data.some(n=>n.title.includes('needs more information')));checks.push('Mandatory notification delivered with team/comments disabled');
 const viewedReleases=[];let holdViewed=Boolean(process.env.REVIEW_QA_POPOVER);
 if(holdViewed)await userPage.route('**/api/notifications',async route=>{if(route.request().method()==='POST'&&holdViewed)await new Promise(resolve=>viewedReleases.push(resolve));await route.continue();});
 let notificationScope=userPage.locator('main');
 if(process.env.REVIEW_QA_POPOVER){await userPage.goto(`${base}/account`,{waitUntil:'domcontentloaded'});await userPage.locator('summary[aria-label="Notifications"]:visible').first().click();notificationScope=userPage.locator('details[data-dismissible-popover][open]');}
 else await userPage.goto(`${base}/notifications`,{waitUntil:'domcontentloaded'});
 await notificationScope.getByText('Your ownership claim needs more information',{exact:true}).first().waitFor();
 if(holdViewed)await new Promise(resolve=>setTimeout(resolve,400));
 const navigationStart=Date.now();let serverActionPosts=0;userPage.on('request',request=>{if(request.method()==='POST'&&request.headers()['next-action'])serverActionPosts++;});
 await notificationScope.getByText('Your ownership claim needs more information',{exact:true}).first().click();
 await userPage.waitForURL(`**/support/${report}`);const urlMs=Date.now()-navigationStart;
 await userPage.getByRole('heading',{name:'Ownership claim: Review browser QA salon'}).waitFor();navigationMetrics={urlMs,contentMs:Date.now()-navigationStart,serverActionPosts};console.log(JSON.stringify({navigationMetrics}));checks.push('Real notification click opens the correct private conversation');
 if(holdViewed){assert.ok(viewedReleases.length>0,'Read-save request must still be pending during navigation');holdViewed=false;viewedReleases.forEach(resolve=>resolve());assert.equal(await userPage.locator('details[data-dismissible-popover][open]').count(),0);checks.push('Popover closes and conversation opens while read-save requests are held');}
 if(!process.env.REVIEW_QA_NAV_ONLY){
 await userPage.locator('main input[type=file]').setInputFiles({name:'ownership-proof-qa.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});
await userPage.getByRole('button',{name:'Upload',exact:true}).click();await userPage.getByRole('link',{name:/ownership-proof-qa.png/}).waitFor();checks.push('Private evidence uploads and remains visible in the request history');
const evidenceConversation=await rpc(user,'get_support_conversation',{p_report_id:report});
const blockedDownload=await outsider.client.storage.from('support-evidence').download(evidenceConversation.attachments[0].path);assert.ok(blockedDownload.error);checks.push('Another account cannot download private evidence from storage');
await userPage.getByLabel('Message support',{exact:true}).fill('Here are the requested details about my ownership and authority.');
 await userPage.getByRole('button',{name:'Send message',exact:true}).click();await userPage.locator('main article').getByText('Here are the requested details about my ownership and authority.',{exact:true}).waitFor();
 const claimRows=await rpc(user,'get_business_claim_requests',{p_salon:salon});assert.equal(claimRows[0].status,'waiting');checks.push('User reply persists and requeues ownership review');
 if(process.env.REVIEW_QA_ADMIN_CHAT){const chat=adminPage.getByRole('dialog',{name:'Reporter conversation',exact:true});await chat.getByText('Here are the requested details about my ownership and authority.',{exact:true}).waitFor();assert.ok(new URL(adminPage.url()).pathname.startsWith('/admin/'));await chat.getByRole('button',{name:'Close conversation',exact:true}).click();checks.push('Claim reply opens chat inside Platform Admin');}
 await adminPage.reload({waitUntil:'domcontentloaded'});await adminPage.locator('main article').getByText('Review ownership claim',{exact:true}).first().click();
 await adminPage.getByLabel('Explanation for the applicant').fill('The document does not establish authority. Please provide an authorization letter.');
 await adminPage.getByRole('button',{name:'Reject',exact:true}).click();
 await userPage.getByRole('button',{name:'Refresh conversation',exact:true}).click();await userPage.locator('main').getByText(/The document does not establish authority/).first().waitFor();
 await userPage.getByLabel('Still need help? Explain what remains unresolved.').fill('I have new authorization evidence. Please reconsider this claim.');
 await userPage.getByRole('button',{name:'Reopen & send',exact:true}).click();await userPage.locator('main article').getByText('I have new authorization evidence. Please reconsider this claim.',{exact:true}).waitFor();checks.push('Rejected claim can be reconsidered without losing its history');
 assert.equal((await rpc(user,'get_business_claim_requests',{p_salon:salon}))[0].status,'waiting');
 await adminPage.reload({waitUntil:'domcontentloaded'});await adminPage.locator('main article').getByText('Review ownership claim',{exact:true}).first().click();
 await adminPage.getByLabel('Explanation for the applicant').fill('Ownership evidence and authority have been verified.');
 await adminPage.getByRole('button',{name:'Approve claim',exact:true}).click();
 await userPage.goto(`${base}/claim/${salon}`,{waitUntil:'domcontentloaded'});await userPage.getByRole('button',{name:'Open salon management',exact:true}).waitFor();
 checks.push('Approval grants management access and shows management action');
 await outsiderPage.goto(`${base}/support/${report}`,{waitUntil:'domcontentloaded'});assert.ok(!(await outsiderPage.locator('body').innerText()).includes('authorization letter'));checks.push('Other signed-in user cannot read the private conversation');
 const outsiderRead=await outsider.client.rpc('get_support_conversation',{p_report_id:report});assert.ok(outsiderRead.error);
 }
 }
 if(!process.env.REVIEW_QA_NAV_ONLY){
 const postReport=await rpc(user,'get_review_support_link',{p_kind:'post_report',p_request:postCase});
 await adminPage.goto(`${base}/admin/post-safety?origin=user&case=${postCase}&status=all`,{waitUntil:'domcontentloaded'});
 await adminPage.getByRole('button',{name:'Request information',exact:true}).click();await adminPage.getByLabel('Explanation for the reporter').fill('Please provide the date and a screenshot of the issue.');
 await adminPage.getByRole('button',{name:'Confirm',exact:true}).click();
 await userPage.goto(`${base}/support/${postReport}`,{waitUntil:'domcontentloaded'});await userPage.locator('main article').getByText('Please provide the date and a screenshot of the issue.',{exact:true}).waitFor();checks.push('Report information request arrives in persistent conversation');
 if(process.env.REVIEW_QA_ADMIN_CHAT){
  await adminPage.getByText('Waiting for reporter',{exact:true}).first().waitFor();checks.push('Information request shows Waiting for reporter in admin queue');
  await adminPage.getByRole('button',{name:'Open reporter conversation',exact:true}).click();
  const chat=adminPage.getByRole('dialog',{name:'Reporter conversation',exact:true});await chat.getByRole('heading',{name:'Content report',exact:true}).waitFor();assert.ok(new URL(adminPage.url()).pathname.startsWith('/admin/post-safety'));checks.push('Open reporter conversation opens a right-side chat without leaving Platform Admin');
  await chat.getByRole('button',{name:'Close conversation',exact:true}).click();
  await userPage.getByLabel('Message support',{exact:true}).fill('The issue happened today. Here are the requested report details.');await userPage.getByRole('button',{name:'Send message',exact:true}).click();
  await chat.getByText('The issue happened today. Here are the requested report details.',{exact:true}).waitFor();await adminPage.getByText('Reporter responded · review needed',{exact:true}).waitFor();checks.push('User reply automatically opens the correct chat and changes waiting status');
  await chat.getByRole('button',{name:'Close conversation',exact:true}).click();
  await userPage.locator('main input[type=file]').setInputFiles({name:'report-proof-qa.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64')});await userPage.getByRole('button',{name:'Upload',exact:true}).click();await chat.getByRole('link',{name:/report-proof-qa.png/}).waitFor();
  const activity=await rpc(admin,'get_platform_admin_activity',{});assert.ok(activity.items.some(item=>item.report_id===postReport&&item.kind==='user_attachment'));checks.push('New evidence reaches admin chat and team notifications');
  if(process.env.REVIEW_QA_ADMIN_NOTIFICATIONS){await adminPage.getByRole('button',{name:'Team notifications',exact:true}).click();const team=adminPage.getByRole('region',{name:'Team notifications',exact:true});await team.getByText('New evidence: Content report',{exact:true}).first().waitFor();const marked=adminPage.waitForResponse(response=>response.url().includes('/admin/api/support-activity')&&response.request().method()==='POST');await team.getByRole('button',{name:'Mark shown as read',exact:true}).click();assert.equal((await marked).status(),200);await team.getByRole('button',{name:'Close team notifications',exact:true}).click();checks.push('Topbar team notifications remain accessible over chat and save read receipts');}
  await chat.getByLabel('Reply to the user',{exact:true}).fill('Thank you. We received your evidence and are reviewing the report.');await chat.getByRole('button',{name:'Send message',exact:true}).click();await chat.getByText('Thank you. We received your evidence and are reviewing the report.',{exact:true}).waitFor();
  await userPage.getByRole('button',{name:'Refresh conversation',exact:true}).click();await userPage.locator('main article').getByText('Thank you. We received your evidence and are reviewing the report.',{exact:true}).waitFor();checks.push('Admin replies from the popup and the user receives the message');
  await chat.getByLabel('Reply to the user',{exact:true}).fill('Unsent admin QA draft');
  const otherCase=await rpc(user,'submit_user_support_case',{p_request_id:randomUUID(),p_category:'other',p_summary:'Other review QA request',p_message:'A separate isolated request for draft preservation testing.',p_context:{path:'/support'}});
  await rpc(user,'send_support_case_message_once',{p_report_id:otherCase,p_body:'A new reply in the other QA conversation.',p_request_id:randomUUID()});await adminPage.getByText('User replied: Other review QA request',{exact:true}).waitFor();assert.equal(await chat.getByLabel('Reply to the user',{exact:true}).inputValue(),'Unsent admin QA draft');checks.push('Another conversation alerts the team without replacing an unsent draft');
  await adminPage.getByRole('button',{name:'Dismiss new reply',exact:true}).click();await chat.getByLabel('Reply to the user',{exact:true}).fill('');
  await chat.getByLabel('Reply to the user',{exact:true}).fill('Draft survives minimize');
  await chat.getByRole('button',{name:'Minimize conversation',exact:true}).click();assert.equal(await chat.getByLabel('Reply to the user',{exact:true}).isVisible(),false);
  await chat.getByRole('button',{name:'Restore conversation',exact:true}).click();assert.equal(await chat.getByLabel('Reply to the user',{exact:true}).inputValue(),'Draft survives minimize');
  await chat.getByLabel('Reply to the user',{exact:true}).fill('Keyboard QA reply');await chat.getByLabel('Reply to the user',{exact:true}).press('Shift+Enter');assert.ok((await chat.getByLabel('Reply to the user',{exact:true}).inputValue()).includes('\n'));await chat.getByLabel('Reply to the user',{exact:true}).press('Enter');await chat.getByText('Sending…',{exact:true}).waitFor({state:'hidden'});
  await userPage.getByRole('button',{name:'Refresh conversation',exact:true}).click();await userPage.locator('main article').getByText('Keyboard QA reply',{exact:true}).waitFor();checks.push('Minimize preserves draft; Shift+Enter inserts newline and Enter delivers a message');
  const conditional=await adminPage.evaluate(async id=>{const url='/admin/api/support-conversation?case='+id;const first=await fetch(url);const etag=first.headers.get('etag');const second=await fetch(url,{headers:{'If-None-Match':etag}});return {first:first.status,second:second.status};},postReport);assert.deepEqual(conditional,{first:200,second:304});checks.push('Authorized unchanged conversation returns 304 without downloading evidence again');
  await chat.getByRole('button',{name:'Close conversation',exact:true}).click();
  await adminPage.route('**/admin/api/support-conversation?*',async route=>{await new Promise(resolve=>setTimeout(resolve,1200));await route.continue();});
  const cachedAt=Date.now();await adminPage.getByRole('button',{name:'Open reporter conversation',exact:true}).click();await chat.getByText('Keyboard QA reply',{exact:true}).waitFor();const cachedMs=Date.now()-cachedAt;assert.ok(cachedMs<1200);checks.push('Cached chat displays before the delayed network response ('+cachedMs+' ms)');await adminPage.unrouteAll({behavior:'wait'});
  await adminPage.screenshot({path:`${output}/admin-chat-desktop.png`,fullPage:true});
  await adminPage.setViewportSize({width:390,height:900});assert.equal(await adminPage.getByRole('button',{name:'Team notifications',exact:true}).isVisible(),true);assert.equal(await adminPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await adminPage.screenshot({path:`${output}/admin-chat-mobile.png`,fullPage:true});await adminPage.setViewportSize({width:1440,height:900});checks.push('Team bell and chat remain usable on mobile without horizontal overflow');
  await chat.getByRole('button',{name:'Close conversation',exact:true}).click();
 }
 await adminPage.getByRole('button',{name:/No violation/}).click();await adminPage.getByLabel('Explanation for the reporter').fill('The reported content did not violate our policy.');
 await adminPage.getByLabel('Internal note (optional)').fill('INTERNAL-CONTENT-BROWSER-SECRET');await adminPage.getByRole('button',{name:'Confirm',exact:true}).click();
 await userPage.getByRole('button',{name:'Refresh conversation',exact:true}).click();await userPage.locator('main').getByText(/The reported content did not violate our policy/).first().waitFor();assert.ok(!(await userPage.locator('body').innerText()).includes('INTERNAL-CONTENT-BROWSER-SECRET'));checks.push('Report dismissal delivers its public explanation without internal notes');
 await userPage.screenshot({path:`${output}/report-result-mobile.png`,fullPage:true});
await userPage.getByLabel('Still need help? Explain what remains unresolved.').fill('Additional evidence is available. Please reconsider this content report.');
await userPage.getByRole('button',{name:'Reopen & send',exact:true}).click();await userPage.locator('main article').getByText('Additional evidence is available. Please reconsider this content report.',{exact:true}).waitFor();
assert.equal((await rpc(user,'get_support_conversation',{p_report_id:postReport})).review.status,'dismissed');checks.push('Reporter requests reconsideration without reversing moderation');
await adminPage.goto(`${base}/support/${postReport}`,{waitUntil:'domcontentloaded'});await adminPage.getByRole('button',{name:'Reopen content review for new evidence',exact:true}).click();
await adminPage.locator('main').getByText('Content report: pending',{exact:true}).waitFor();checks.push('Authorized reviewer explicitly reopens content review');
 for(const width of [320,390,1440]){await userPage.setViewportSize({width,height:900});assert.equal(await userPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}checks.push('Conversation has no horizontal overflow at 320, 390 and 1440 pixels');assert.deepEqual(errors,[]);
 }
 if(process.env.REVIEW_QA_EXPECT_DIRECT)assert.equal(navigationMetrics.serverActionPosts,0,'Support navigation must not wait for a server action');
 fs.rmSync(`${output}/failure.json`,{force:true});fs.writeFileSync(`${output}/results.json`,JSON.stringify({base,checks,errors,navigationMetrics},null,2));console.log(JSON.stringify({passed:checks.length,checks,navigationMetrics},null,2));
}catch(error){const pages=[];for(const context of browser?.contexts()??[]){for(const page of context.pages()){pages.push({url:page.url(),text:await page.locator('body').innerText().catch(()=>"")});await page.screenshot({path:`${output}/failure-page-${pages.length}.png`,fullPage:true}).catch(()=>{});}}fs.writeFileSync(`${output}/failure.json`,JSON.stringify({checks,errors,pages,message:error.message,stack:error.stack},null,2));throw error;}finally{
 await browser?.close();
 // Cleanup scopes are exact fixture IDs and their trusted links, never a real user's records.
 const ids=fixtures.filter(f=>f.user).map(f=>`'${f.user}'`).join(',');
 if(ids){const evidence=sql(`select object_path from support_case_attachments where actor_user_id in (${ids});`);if(evidence.length){const removed=await service.storage.from('support-evidence').remove(evidence.map(e=>e.object_path));if(removed.error)throw removed.error;}sql(`begin;
 lock table salon_directory_suppressions in row exclusive mode;
 lock table salon_directory_listings in row exclusive mode;
 delete from app_notifications where recipient_user_id in (${ids});
 delete from platform_admin_activity_reads where user_id in (${ids});
 
 delete from post_safety_decisions where actor_user_id in (${ids});
 delete from post_safety_cases where id='${postCase}';
 delete from platform_reports where reporter_user_id in (${ids});
 delete from business_claim_events where actor_user_id in (${ids});
 delete from accounts where id='${account}' or (id in (select account_id from account_memberships where user_id in (${ids})) and not exists(select 1 from account_memberships m where m.account_id=accounts.id and m.user_id not in (${ids})));
 delete from salon_directory_suppressions where listing_id='review-browser-qa-${salon}';
 delete from account_memberships where user_id in (${ids});
 delete from salon_memberships where user_id in (${ids});
 delete from platform_admin_memberships where user_id in (${ids});
 delete from users where id in (${ids}) and not exists(select 1 from platform_admin_audit_logs where actor_user_id=users.id);
update users set auth_user_id=null,email=null,status='deleted',display_name='Removed review QA fixture' where id in (${ids});
 commit;`);}
 for(const f of fixtures){if(f.auth){const deleted=await service.auth.admin.deleteUser(f.auth);if(deleted.error)throw deleted.error;}sql(`delete from abuse_signup_tickets where token='${f.ticket}';`);}
 fs.rmdirSync(dir);fs.rmSync(`${output}/fixture-ids.json`,{force:true});console.log('Dedicated QA fixtures removed. No emails or verification codes sent.');
}

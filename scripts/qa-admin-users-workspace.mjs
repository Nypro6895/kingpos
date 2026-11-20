import {build} from 'esbuild';

import {chromium} from 'playwright-core';

import fs from 'node:fs';

import path from 'node:path';

import http from 'node:http';

import assert from 'node:assert/strict';

const root=process.cwd();const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

const permissions=['access','auditRead','usersRead','usersReadSensitive','locationsRead','usersCreate','usersAuthManage','usersUpdate','usersRestore','usersSuspend','usersDelete','usersMembershipsManage','teamRead','teamManage','notesRead','notesCreate','recoveryRead','recoveryManage','reportsRead','reportsCreate','reportsUpdate','reportsAssign','reportsResolve','notificationsRead','notificationsSend'];

const actor={userId:id(99),membershipId:id(98),roleId:id(97),roleSlug:'platform_owner',roleName:'Platform Owner',permissions};

const names=['Emma Nguyen','Michael Tran','Sophia Le','Taylor Chen','Olivia Vo'];

const users=names.map((name,i)=>({id:id(i+1),display_name:name,first_name:name.split(' ')[0],last_name:name.split(' ')[1],email:name.split(' ')[0].toLowerCase()+'@example.com',phone:'+1 (312) 555-0189',status:i===2?'suspended':i===3?'pending_deletion':'active',created_at:'2026-10-01T12:00:00Z',updated_at:'2026-10-07T15:00:00Z',last_login_at:'2026-10-07T15:42:00Z',organization_count:1,roles:[i===0?'owner':'staff'],businesses:[{id:id(50),name:i%2?'Madison Nails':'Lumi Beauty Bar'}]}));

const fixture=user=>({user:{...user,language:'en',timezone:'America/Chicago',auth_user_id:null},organization_memberships:[{id:id(52),organization_id:id(50),organization_name:'Lumi Beauty Bar',role:'OWNER',status:'active',joined_at:'2026-10-01',created_at:'2026-10-01'}],salon_memberships:[{id:id(53),salon_id:id(51),salon_name:'Madison Nails',role:'STAFF',status:'active',created_at:'2026-10-01'}],access_stores:[{id:id(51),name:'Lumi Beauty Bar',status:'active',staff_linked:false,sources:[{membership_id:id(52),scope:'business',entity_id:id(50),role:'OWNER',status:'active',account_status:'active',store_count:1},{membership_id:id(53),scope:'salon',entity_id:id(51),role:'OWNER',status:'active',account_status:'active',store_count:1}]}],platform_membership:null,related_reports:[],authentication:{email_confirmed_at:'2026-10-01',invited_at:null,last_sign_in_at:'2026-10-07',banned_until:null,factors:[{id:id(60),factor_type:'totp',status:'verified'}]},sessions:[{id:id(61),device_label:'Chrome on Windows',created_at:'2026-10-07T15:42:00Z',updated_at:'2026-10-07T15:42:00Z'},{id:id(62),device_label:'Safari on iOS',created_at:'2026-10-06T15:42:00Z',updated_at:'2026-10-06T15:42:00Z'}],identity_jobs:[{id:id(63),operation:'password_reset',status:'accepted',created_at:'2026-10-07T15:42:00Z'}],cases:[{id:id(64),reference:'CASE-024',category:'account_takeover',summary:'Account takeover',description:'User reports an unrecognized login.',status:'under_review',priority:'high',assigned_membership_id:id(98),resolution:null,created_at:'2026-10-07T15:12:00Z',updated_at:'2026-10-07T15:42:00Z',context:{identity_verified:true,contact_verified:true,ownership_verified:true,recovery_contact:'recovery@example.com',verification_evidence:'Independent recovery contact and identity confirmed.'}}],assignees:[{id:id(98),name:'Support team'}],permissions:[],ownAccount:false,identityReady:true,notes:[],activity:[{id:id(65),title:'Login succeeded',body:'Chrome on Windows',at:'2026-10-07T15:42:00Z',actor:null}],deletion:{blocked:true,grace_days:30,salons:[{id:id(51),name:'Lumi Beauty Bar',status:'active',last_owner:true}]},errors:[]});

const aliases={

 'next/link':`import React from 'react';export default function Link({children,href,...p}){return <a href={href} {...p}>{children}</a>}`,

 'next/form':`import React from 'react';export default function Form({action,...p}){return <form action={action} {...p}/>} `,

 'next/navigation':`export function useRouter(){return {refresh:()=>{},replace:()=>{}}}`,

 './workspace-actions':`export async function userWorkspaceAction(form){const data=Object.fromEntries(form);window.__calls.push(data);if(data.operation==='profile'&&data.display_name==='Fail validation')return {ok:false,message:'This profile changed. Refresh before saving.'};return {ok:true,message:'Changes saved.',userId:data.user_id||'${id(1)}',caseId:data.operation==='case'?'${id(64)}':undefined};}export async function bulkUserAccessAction(form){const data=Object.fromEntries(form);window.__calls.push(data);return {ok:true,message:'Bulk complete',results:JSON.parse(data.selection).map(id=>({id,ok:true,message:'Suspended'}))};}`,

};

const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {UsersWorkspace} from './app/(app)/admin/users/users-workspace';import {PLATFORM_ADMIN_PERMISSIONS as P} from './types/platform-admin';const actor=${JSON.stringify(actor)};actor.permissions=actor.permissions.map(p=>P[p]);window.__calls=[];createRoot(document.getElementById('root')).render(<div className='admin-workspace'><aside className='admin-sidebar'><strong>REYLUMI</strong><nav className='admin-navigation'>${['Overview','Users','Businesses','Attention','Inbox','Reports','Recovery','Audit log','Admin team','Settings'].map(v=>`<div className='shell-nav ${v==='Users'?'selected':''}'>${v}</div>`).join('')}</nav></aside><div><header className='qa-topbar'>Admin / Users <span>Platform owner · Full access</span></header><main><UsersWorkspace users={{items:${JSON.stringify(users)},total:248,page:1,page_size:50,can_read_sensitive:true}} context={actor} query={{}} identityReady={true}/></main></div></div>);`;

const result=await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,outdir:'artifacts/admin-users-workspace',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'fixture',setup(api){api.onResolve({filter:/.*/},args=>aliases[args.path]?{path:args.path,namespace:'fixture'}:undefined);api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:aliases[args.path],loader:'tsx',resolveDir:root}));}}]});

const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text;const css=result.outputFiles.find(f=>f.path.endsWith('.css')).text;

const base=`*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}button,input,textarea,select{font:inherit}button{background:transparent;border:0}a{color:inherit;text-decoration:none}h1,h2,h3,p,dl,dd{margin:0}fieldset{padding:0;border:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}.admin-sidebar{position:fixed;inset:0 auto 0 0;background:#fff;border-right:1px solid #e3e8ee;padding:20px 12px}.admin-sidebar>strong{display:block;letter-spacing:1px;padding:0 8px 18px}.shell-nav{padding:10px 8px;font-size:12px;color:#637185}.shell-nav.selected{background:#fff6ef;color:#e65c0b;border-radius:4px}.qa-topbar{height:46px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e3e8ee;padding:0 20px;font-size:11px}.qa-topbar span{color:#687487}@media(max-width:1023px){.admin-sidebar{display:none}}`;

const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/admin/users/workspace'){const user=users.find(u=>u.id===url.searchParams.get('id'))??users[0];const data=fixture(user);data.permissions=Object.values(JSON.parse(JSON.stringify(globalThis.__qaPermissionMap??{})));res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(data));}if(url.pathname==='/admin/lookup'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({items:[{id:id(51),label:'Madison Nails'}]}));}res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${fs.readFileSync("app/(app)/admin/admin.css", "utf8")}\n${base}\n${css}</style></head><body><div id="root"></div><script>${js.replaceAll('</script>','<\\/script>')}</script></body></html>`);});

// The real permission constants are read by the bundled app and copied into fixture requests.

const permissionMap=await build({entryPoints:['types/platform-admin.ts'],bundle:true,write:false,platform:'node',format:'esm'});globalThis.__qaPermissionMap=(await import('data:text/javascript;base64,'+Buffer.from(permissionMap.outputFiles[0].text).toString('base64'))).PLATFORM_ADMIN_PERMISSIONS;

fs.mkdirSync('artifacts/admin-users-workspace',{recursive:true});

await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'chrome',headless:true});

try{

 const page=await browser.newPage({viewport:{width:1536,height:1024}});const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR: '+e.message)});

 await page.goto(`http://127.0.0.1:${server.address().port}/admin/users`);

 const more=page.getByLabel('More actions for Emma Nguyen',{exact:true});const menu=more.locator('..');

 await more.click();assert.equal(await menu.getAttribute('open'),'');await page.getByRole('heading',{name:'Users',exact:true}).click();assert.equal(await menu.getAttribute('open'),null);

 await more.click();await page.mouse.move(220,70);assert.equal(await menu.getAttribute('open'),null);

 await more.click();await page.getByRole('button',{name:'Access & roles',exact:true}).click();assert.equal(await menu.getAttribute('open'),null);await page.getByRole('tab',{name:'Access',exact:true}).waitFor();

 await more.click();await page.keyboard.press('Escape');assert.equal(await menu.getAttribute('open'),null);assert.equal(await page.getByRole('dialog').count(),1);

 await more.click();await page.getByRole('button',{name:'Security',exact:true}).first().click();assert.equal(await menu.getAttribute('open'),null);

 await page.getByRole('button',{name:'Security',exact:true}).first().click();await page.getByRole('button',{name:'Change email',exact:true}).waitFor();

 assert.equal(new URL(page.url()).pathname,'/admin/users');assert.equal(await page.getByRole('table').count(),1);

 await page.screenshot({path:'artifacts/admin-users-workspace/security-desktop.png',fullPage:true});

 await page.getByRole('tab',{name:'Profile',exact:true}).click();await page.getByLabel('Display name',{exact:true}).fill('Emma updated');assert.equal(await page.getByLabel('Display name',{exact:true}).evaluate(e=>document.activeElement===e),true);

 page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('tab',{name:'Security',exact:true}).click();assert.equal(await page.getByRole('tab',{name:'Profile'}).getAttribute('aria-selected'),'true');

 await page.getByLabel('Display name',{exact:true}).fill('Fail validation');await page.getByLabel('Reason',{exact:true}).fill('Contact correction');await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Display name',{exact:true}).inputValue(),'Fail validation');

 page.once('dialog',dialog=>dialog.accept());await page.getByRole('tab',{name:'Access',exact:true}).click();await page.getByRole('button',{name:'Transfer ownership',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Lumi Beauty Bar',exact:true}).count(),1);assert.equal(await page.getByText('Shared access · 1 business',{exact:true}).isVisible(),false);await page.getByText('Access settings',{exact:true}).click();await page.getByText('Shared access · 1 business',{exact:true}).waitFor();await page.screenshot({path:'artifacts/admin-users-workspace/access-desktop.png',fullPage:true});

 await page.getByRole('tab',{name:'Security',exact:true}).click();await page.getByRole('button',{name:'+ Create support case',exact:true}).click();await page.locator('select[name=category]').waitFor();await page.screenshot({path:'artifacts/admin-users-workspace/case-desktop.png',fullPage:true});

 await page.getByRole('button',{name:'Close drawer',exact:true}).click();await page.getByRole('checkbox',{name:'Select Emma Nguyen',exact:true}).check();await page.getByRole('checkbox',{name:'Select Michael Tran',exact:true}).check();await page.getByRole('button',{name:'Suspend',exact:true}).click();await page.getByLabel('Reason',{exact:true}).fill('Security containment');await page.getByRole('button',{name:'Suspend 2 users',exact:true}).click();assert.equal(await page.evaluate(()=>window.__calls.filter(c=>c.operation==='suspend').length),0);await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.getByRole('status').filter({hasText:'Bulk complete'}).waitFor();

 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Security',exact:true}).first().click();await page.getByRole('button',{name:'Change email',exact:true}).waitFor();await page.screenshot({path:'artifacts/admin-users-workspace/security-mobile.png',fullPage:true});

 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.getByRole('dialog').getAttribute('aria-modal'),'true');

 await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});assert.deepEqual(errors,[]);

 console.log('PASS: drawer stays on users; form focus and failed edits preserved; unsaved-change guard; access/case tabs; bulk confirmation; mobile layout and Escape.');

}finally{await browser.close();await new Promise(r=>server.close(r));}




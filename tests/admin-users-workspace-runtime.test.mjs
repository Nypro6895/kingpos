import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function load(){
 const stubs={
  'server-only':'export {};',
  'next/cache':'export function revalidatePath(){}',
  '@/lib/platform-admin/auth':`export async function requirePlatformAdmin(p){if(!globalThis.__userActor.permissions.includes(p))throw new Error('Access denied');return globalThis.__userActor;}`,
  '@/lib/platform-admin/rpc':'export async function callPlatformAdminRpc(...a){return globalThis.__userRpc(...a)}',
  '@/lib/platform-admin/user-identity':`export function adminIdentityClient(){throw new Error('Unexpected external call')}export async function runUserIdentity(){throw new Error('Unexpected identity call')}`,
  '@/lib/platform-admin/notes':'export async function createPlatformAdminNote(){throw new Error("Unexpected note")}',
  '@/lib/platform-admin/team':'export async function createPlatformAdminMembership(){throw new Error("Unexpected team change")}export async function updatePlatformAdminMembership(){throw new Error("Unexpected team change")}',
 };
 const result=await build({entryPoints:['app/(app)/admin/users/workspace-actions.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'users-fixture',setup(api){api.onResolve({filter:/.*/},args=>stubs[args.path]?{path:args.path,namespace:'fixture'}:undefined);api.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
}
function form(operation,values={}){const f=new FormData();for(const [key,value] of Object.entries({operation,user_id:id(2),reason:'Verified support request',request_id:id(10),...values}))f.set(key,value);return f;}
test('user actions authorize before mutation; malformed membership and selection never reach the database',async()=>{
 const actions=await load();const calls=[];globalThis.__userRpc=async(...a)=>{calls.push(a);return null;};globalThis.__userActor={userId:id(1),permissions:['admin.users.read']};
 assert.equal((await actions.userWorkspaceAction(form('profile'))).ok,false);assert.equal(calls.length,0);
 globalThis.__userActor.permissions.push('admin.users.memberships.manage');
 assert.equal((await actions.userWorkspaceAction(form('membership',{entity_id:'invalid',scope:'business',role:'STAFF',status:'active'}))).ok,false);assert.equal(calls.length,0);
 globalThis.__userActor.permissions.push('admin.users.suspend');
 assert.equal((await actions.bulkUserAccessAction(form('suspend',{selection:'["invalid"]'}))).ok,false);assert.equal(calls.length,0);
});
test('bulk access records partial failure and skips the administrator own account',async()=>{
 const actions=await load();const calls=[];globalThis.__userActor={userId:id(1),permissions:['admin.users.read','admin.users.suspend']};
 globalThis.__userRpc=async(name,args)=>{calls.push({name,args});if(args.p_user_id===id(3))throw new Error('Last owner protected');return null;};
 const result=await actions.bulkUserAccessAction(form('suspend',{selection:JSON.stringify([id(1),id(2),id(3),id(2)])}));
 assert.equal(result.results.length,3);assert.equal(result.results.filter(r=>r.ok).length,1);assert.equal(calls.length,2);assert.ok(result.results.some(r=>r.message.includes('Last owner')));
});
test('case evidence validates signatures before an external upload',async()=>{
 const actions=await load();globalThis.__userActor={userId:id(1),permissions:['admin.users.read','admin.users.read_sensitive','admin.reports.read','admin.reports.create','admin.recovery.manage']};
 globalThis.__userRpc=async()=>{throw new Error('Unexpected database write');};
 const data=form('case',{category:'account_takeover',description:'Compromised account',priority:'high'});data.set('evidence',new File(['not a PDF'],'proof.pdf',{type:'application/pdf'}));
 const result=await actions.userWorkspaceAction(data);assert.equal(result.ok,false);assert.match(result.message,/file|PDF|content/i);assert.ok(!result.message.includes('Unexpected'));
});

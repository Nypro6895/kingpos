import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ts from 'typescript';
import {build} from 'esbuild';

const built=await build({stdin:{contents:`export * from './lib/app-local-getter-read-scope';export * from './lib/read-context-scope';`,resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'server-only',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'empty',namespace:'empty'}));b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:''}));}}]});
const scope=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const id=(module,name)=>'action.'+crypto.createHash('sha256').update(module+'#'+name).digest('hex').slice(0,24);
const getters=[id('app/market/booking-deposit-actions.ts','loadBookingDepositAction'),...['loadBookingRulesSettingsAction','loadBookSmsSettingsAction'].map(n=>id('app/settings/plugin-settings-actions.ts',n))];
const save=id('app/settings/plugin-settings-actions.ts','saveBookSmsSettingsAction');
const file='app/api/app-local/command/route.ts',ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
const commandCode=ts.transpileModule(ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='command').getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

function fixture(){
  const state={auth:0,dispatch:0,writes:0,revoked:false,owner:true,workspace:'v3:'+'a'.repeat(64)};
  const key=Symbol('session');
  const gate=()=>scope.memoizeReadValidation(key,'viewer-session',async()=>{state.auth++;if(state.revoked)throw Object.assign(Error('revoked'),{status:401});return {user:{id:'viewer'},scope:state.workspace};});
  const unhandled=async()=>({handled:false});
  class AuthAvailabilityError extends Error{} class AppLocalUploadError extends Error{}
  const deps={...scope,connection:async()=>{},headers:async()=>new Headers(),getRequestBusinessContext:gate,getCurrentBusinessContext:gate,getCurrentStaffBusinessContext:async()=>({user:{id:'viewer'},scope:'wrong'}),getExperienceContext:c=>({scope:c.scope}),getStaffPortalIdentity:async()=>({context:{user:{id:'viewer'},scope:'wrong'},staff:null}),
    runAppLocalUploadCommand:unhandled,runAppLocalHttpCommand:unhandled,runAppLocalShellCommand:unhandled,runAppLocalRoleHttpCommand:unhandled,runAppLocalPersonalCommand:unhandled,runAppLocalExploreHttpCommand:unhandled,runAppLocalPublicHttpCommand:unhandled,
    isAppLocalScopeId:v=>/^v3:[a-f0-9]{64}$/.test(v),isAppLocalPortableScopeId:()=>false,authorizeAppLocalDisplayCommand:async()=>false,APP_LOCAL_GUEST_HIDDEN_POSTS_READ:'guest-read',decodeAppLocalValue:v=>v,
    runAppLocalCommand:async(name)=>{state.dispatch++;await gate();if(!state.owner)throw Object.assign(Error('owner required'),{status:403});if(name===save){assert.equal(scope.getReusableReadValidationToken(),undefined);state.writes++;}else{await scope.runWithReadContext(gate);}return {sameSettings:true};},AuthAvailabilityError,AppLocalUploadError};
  const command=new Function(...Object.keys(deps),commandCode+';return command')(...Object.values(deps));
  const trace={measure:async(_,fn)=>fn(),setCommand:()=>{},error:()=>{},failure:()=>{}};
  async function call(name,options={}){const request=new Request('https://reylumi.com/api/app-local/command',{method:'POST',headers:{origin:options.origin??'https://reylumi.com','content-type':'application/json'},body:JSON.stringify({schemaVersion:1,requestId:'11111111-1111-4111-8111-111111111111',name,scope:options.scope??state.workspace,args:{values:[]}})});return command(request,trace);}
  return {state,call};
}

for(const name of getters)test(name+' shares transport and getter validation only for this request',async()=>{const x=fixture();assert.equal((await x.call(name)).status,200);assert.equal(x.state.auth,1);assert.equal(x.state.dispatch,1);assert.equal(scope.getReusableReadValidationToken(),undefined);x.state.revoked=true;assert.equal((await x.call(name)).status,401);assert.equal(x.state.auth,2);assert.equal(x.state.dispatch,1);});
test('original route still denies wrong origin, changed scope and non-owner before data release',async()=>{for(const kind of ['origin','scope','owner']){const x=fixture();if(kind==='owner')x.state.owner=false;const r=await x.call(getters[0],kind==='origin'?{origin:'https://elsewhere.example'}:kind==='scope'?{scope:'v3:'+'b'.repeat(64)}:{});assert.equal(r.status,kind==='scope'?409:403);assert.equal(x.state.writes,0);if(kind!=='owner')assert.equal(x.state.dispatch,0);}});
test('a save retains fresh transport and handler checks and is never replayed',async()=>{const x=fixture();assert.equal((await x.call(save)).status,200);assert.equal(x.state.auth,2);assert.equal(x.state.writes,1);x.state.revoked=true;assert.equal((await x.call(save)).status,401);assert.equal(x.state.writes,1);});
test('unlisted action and HTTP command never receive a read scope',async()=>{for(const name of [save,'http.staff.create-appointment','action.'+'f'.repeat(24)])await scope.runWithAppLocalGetterReadScope(name,async()=>assert.equal(scope.getReusableReadValidationToken(),undefined));});
test('concurrent requests never share authority and an explicit final probe stays fresh',async()=>{const key=Symbol('validation');let calls=0;const gate=()=>scope.memoizeReadValidation(key,'same-session',async()=>++calls);await Promise.all(getters.map(name=>scope.runWithAppLocalGetterReadScope(name,async()=>{await gate();await gate();})));assert.equal(calls,3);await scope.runWithAppLocalGetterReadScope(getters[0],async()=>{await gate();await scope.runWithFreshReadValidation(gate);});assert.equal(calls,5);});

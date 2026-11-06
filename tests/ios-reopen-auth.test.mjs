import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

const entry = readFileSync('app/local-app/entry.tsx', 'utf8');
const start = entry.indexOf('    if (error !== "sign-in" || isPublic(path)');
const recovery = transformSync(entry.slice(start, entry.indexOf('\n  }, [error, path, navigate]);', start)), {loader:'ts'}).code;
function recover(path, error = 'sign-in', logout = false, family = 'account', requiresContext = true) {
  const calls = [], admitted = {current:{account:{private:true}}};
  vm.runInNewContext(`(()=>{${recovery}})()`, {
    path, error, explicitLogout:{current:logout}, admitted,
    isPublic:p=>p==='/help', authorityFamily:()=>family, getAppLocalPage:()=>({requiresContext}),
    clearAppLocalRoleResources:()=>calls.push('roles'), resetAppLocalResources:()=>calls.push('resources'),
    setAppLocalCommandScope:value=>calls.push(['commands',value]),
    setAdmissions:value=>calls.push(['admissions',value]), setHelpPresentation:()=>{},setVisited:()=>{},
    setSignInReturnPath:value=>calls.push(['next',value]), navigate:(...args)=>calls.push(['navigate',...args]),
  });
  return {calls,admitted};
}
test('cold expired Today withdraws private state, keeps query and shows Explore behind login',()=>{
  const f=recover('/staff/today?period=week');
  assert.deepEqual(Object.keys(f.admitted.current),[]);
  assert.deepEqual(f.calls.slice(-2),[['next','/staff/today?period=week'],['navigate','/explore',true]]);
  assert.ok(f.calls.indexOf('resources')<f.calls.findIndex(x=>x[0]==='navigate'));
});
test('missing saved page, explicit logout and public account pages go to guest without login',()=>{
  for(const args of [['/'],['/staff/today','sign-in',true],['/explore','sign-in',false,'account',false]]) {
    assert.deepEqual(recover(...args).calls.slice(-2),[['next',null],['navigate','/explore',true]]);
  }
});
test('outages and permission/workspace denials do not invent a logout or trigger login',()=>{
  for(const error of ['timeout','network','unavailable','access','workspace','verification','reset','invalid',false]) {
    assert.equal(recover('/staff/today',error).calls.length,0);
  }
  for(const family of ['portable','display']) assert.equal(recover('/pos/portable','sign-in',false,family).calls.length,0);
  assert.equal(recover('/help').calls.length,0);
});

const promptSource=readFileSync('components/app-local-session-expiry-prompt.tsx','utf8').replace(/^import .*;\r?\n/gm,'').replace('export function AppLocalSessionExpiryPrompt','function AppLocalSessionExpiryPrompt');
const promptCode=transformSync(promptSource+'\nglobalThis.Prompt=AppLocalSessionExpiryPrompt;', {loader:'tsx',jsxFactory:'jsx',jsxFragment:'Fragment'}).code;
function promptFixture() {
  let cursor=0,dirty=false,tree;
  const slots=[], effects=new Map(), calls=[], listeners=new Map();
  const same=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
  const sandbox={
    URLSearchParams, navigator:{onLine:true},location:{pathname:'/explore',search:''},
    document:{body:{},activeElement:null,visibilityState:'visible'},HTMLElement:class{},
    window:{addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:()=>{}},
    getAppLocalHost:()=>({openOnline:p=>{calls.push(p);return Promise.resolve();}}),
    jsx:(type,props,...children)=>({type,props:props??{},children}),Fragment:'fragment',
    createPortal:x=>x,WorkspaceText:()=>null,recordExperienceTrace:()=>{},nextExperienceTraceOperation:()=>0,
    useRef:value=>{const i=cursor++;return slots[i]??(slots[i]={current:value});},
    useState:initial=>{const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{const next=typeof value==='function'?value(slots[i]):value;if(!Object.is(next,slots[i])){slots[i]=next;dirty=true;}}];},
    useCallback:(fn,deps)=>{const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={fn,deps};return slots[i].fn;},
    useEffect:(fn,deps)=>{const i=cursor++;if(!same(slots[i]?.deps,deps)){effects.set(i,fn);slots[i]={deps};}},
    AbortController,setInterval:()=>1,clearInterval:()=>{},
  };
  vm.runInNewContext(promptCode,sandbox);
  let props={authenticated:null,signInReturnPath:'/staff/today?period=week'};
  const render=(next={})=>{props={...props,...next};for(let n=0;n<12;n++){dirty=false;cursor=0;tree=sandbox.Prompt(props);if(dirty)continue;const work=[...effects.values()];effects.clear();for(const fn of work)fn();if(!dirty)return tree;}throw Error('render did not settle');};
  return {render,calls,listeners};
}
test('cold expiry opens hosted login once with original next even though no authenticated render occurred',()=>{
  const f=promptFixture();assert.ok(f.render());
  assert.equal(f.calls.length,1);
  assert.equal(new URL(f.calls[0],'https://reylumi.com').searchParams.get('next'),'/staff/today?period=week');
  f.render();f.render({authenticated:false});assert.equal(f.calls.length,1);
  assert.equal(f.render({authenticated:true,signInReturnPath:null}),null);
  f.render({authenticated:null,signInReturnPath:'/staff/today?period=week'});
  assert.equal(f.calls.length,2,'A later expiry on the same page opens a new login once');
});
test('guest starts without a login popup and dismissing confirmed expiry chooses guest',()=>{
  const guest=promptFixture();assert.equal(guest.render({signInReturnPath:null,authenticated:false}),null);assert.equal(guest.calls.length,0);
  const f=promptFixture();let continued=0;const dialog=f.render({onContinueAsGuest:()=>continued++});
  dialog.props.onCancel({preventDefault(){}});assert.equal(continued,1);
  assert.equal(f.render({signInReturnPath:null}),null);
  assert.equal(f.calls.length,1);
});

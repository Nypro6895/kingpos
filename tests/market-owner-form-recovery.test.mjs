import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {build} from 'esbuild';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),key=Symbol.for('owner-form-recovery');let hooks;globalThis[key]={};
const built=await build({entryPoints:['app/market/developer-apps.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'actual-form-hooks',setup(b){b.onLoad({filter:/developer-apps\.tsx$/},()=>({contents:fs.readFileSync('app/market/developer-apps.tsx','utf8')+'\nexport {AppForm};',loader:'tsx',resolveDir:process.cwd()+'/app/market'}));b.onResolve({filter:/^react\/jsx-runtime$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));b.onResolve({filter:/^react$|^next\/link$|workspace-language$|^\.\/developer-app-actions$|\.css$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='react'?`export function useActionState(){return [globalThis[Symbol.for('owner-form-recovery')].result,()=>{},globalThis[Symbol.for('owner-form-recovery')].pending===true]};export function useState(initial){const h=globalThis[Symbol.for('owner-form-recovery')],i=h.cursor++;if(!(i in h.values))h.values[i]=initial;return [h.values[i],v=>h.values[i]=v]};export function useEffect(){};export function useRef(){return {current:null}}`:a.path.includes('workspace-language')?'export function WorkspaceText({text}){return text}':a.path==='next/link'?'export default function Link(){return null}':a.path==='./developer-app-actions'?'export async function ownerAppAction(){throw Error("No mutation in hook fixture")}':'export default new Proxy({},{get:(_,k)=>String(k)})'}));}}]});
const {AppForm}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const nodes=v=>Array.isArray(v)?v.flatMap(nodes):v&&typeof v==='object'?[v,...nodes(v.props?.children)]:[];
const render=()=>{hooks.cursor=0;return AppForm({requiresConsent:true,operation:'install',salon:'synthetic',label:'Activate'});};
test.after(()=>delete globalThis[key]);
test('actual Owner form binds checkbox and enabled state to the current action response; error requires fresh consent',()=>{
 hooks={result:{ok:false,message:''},values:[],cursor:0};globalThis[key]=hooks;let view=render();const checkbox=()=>nodes(view).find(n=>n.type==='input'&&n.props.name==='consent'),submit=()=>nodes(view).find(n=>n.type==='button'&&n.props.type!=='button');assert.equal(submit().props.disabled,true);checkbox().props.onChange({target:{checked:true}});view=render();assert.equal(checkbox().props.checked,true);assert.equal(submit().props.disabled,false);
 hooks.result={ok:false,message:'Definite synthetic rejection'};view=render();assert.equal(checkbox().props.checked,false);assert.equal(submit().props.disabled,true);checkbox().props.onChange({target:{checked:true}});view=render();assert.equal(submit().props.disabled,false);
 hooks.result={ok:false,uncertain:true,message:'Synthetic lost response'};view=render();assert.equal(submit().props.disabled,true);let prevented=false;view.props.onSubmit({preventDefault(){prevented=true}});assert.equal(prevented,true);assert.ok(nodes(view).some(n=>n.type==='button'&&n.props.type==='button'));
});

test('removal confirmation cannot be dismissed through Keep while pending or outcome is unknown',()=>{
 for(const [pending,uncertain,expected] of [[false,false,false],[true,false,true],[false,true,true]]){
  hooks={result:{ok:false,message:'',uncertain},pending,values:[],cursor:0};globalThis[key]=hooks;
  const view=AppForm({operation:'revoke',salon:'synthetic',label:'Confirm removal',onCancel(){}});
  const cancel=nodes(view).find(n=>n.type==='button'&&n.props.onClick&&n.props.type==='button'&&n.props.children?.props?.text==='Keep this app');
  assert.ok(cancel);assert.equal(Boolean(cancel.props.disabled),expected);
 }
});

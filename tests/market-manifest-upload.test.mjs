import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url),key=Symbol.for('manifest-upload-hooks');let hooks;globalThis[key]={};
const result=await build({entryPoints:['app/(market-platform)/developer-platform/manifest-upload.tsx'],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',alias:{'@':process.cwd()},plugins:[{name:'hooks',setup(b){b.onResolve({filter:/^react\/jsx-runtime$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));b.onResolve({filter:/^react$|^\.\/sections$|\.css$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='react'?`export function useState(initial){const h=globalThis[Symbol.for('manifest-upload-hooks')],i=h.cursor++;if(!(i in h.values))h.values[i]=initial;return [h.values[i],v=>h.values[i]=v]};export function useRef(initial){const h=globalThis[Symbol.for('manifest-upload-hooks')],i=h.cursor++;return h.values[i]??=( {current:initial} )}`:a.path==='./sections'?'export function DeveloperText({text}){return text}':'export default new Proxy({},{get:(_,k)=>String(k)})'}));}}]});
const {ManifestUpload}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test.beforeEach(()=>{hooks={values:[],cursor:0};globalThis[key]=hooks;});test.after(()=>delete globalThis[key]);
const render=(apps=[])=>{hooks.cursor=0;return ManifestUpload({apps});};
const nodes=(view)=>Array.isArray(view)?view.flatMap(nodes):view&&typeof view==='object'?[view,...nodes(view.props?.children)]:[];
const fileInput=()=>nodes(render()).find(n=>n.type==='input'&&n.props.type==='file');
const event=file=>{const input={files:file?[file]:[],validity:'',setCustomValidity(v){this.validity=v}};return {currentTarget:input};};

test('publishers with an existing app must choose update or new explicitly; update preserves the client identity',()=>{
 const apps=[{id:'existing-app',name:'QR Menu',versions:[]}];let view=render(apps),select=nodes(view).find(n=>n.type==='select');
 assert.equal(select.props.value,'');assert.equal(select.props.required,true);
 select.props.onChange({target:{value:'existing-app'}});view=render(apps);
 assert.equal(nodes(view).find(n=>n.type==='input'&&n.props.name==='app').props.value,'existing-app');
 select=nodes(view).find(n=>n.type==='select');select.props.onChange({target:{value:'__new__'}});view=render(apps);
 assert.equal(nodes(view).find(n=>n.type==='input'&&n.props.name==='app').props.value,'');
});
test('read error/oversized/wrong-extension are visible, block native submission and permit retry',async()=>{for(const file of [{name:'data.json',size:10,text:async()=>{throw Error('read failed')}},{name:'run.js',size:1},{name:'large.json',size:16385}]){const e=event(file);await fileInput().props.onChange(e);assert.notEqual(e.currentTarget.validity,'');assert.ok(nodes(render()).some(n=>n.props?.role==='alert'));}const e=event(null);await fileInput().props.onChange(e);assert.equal(e.currentTarget.validity,'');assert.ok(!nodes(render()).some(n=>n.props?.role==='alert'));});
test('an old asynchronous file read cannot overwrite the latest selection or clear its error',async()=>{let finish;const old=event({name:'old.json',size:10,text:()=>new Promise(r=>finish=r)});const first=fileInput().props.onChange(old);assert.match(old.currentTarget.validity,/Wait/);const latest=event({name:'new.json',size:10,text:async()=>'{"bad":true}'});await fileInput().props.onChange(latest);const current=latest.currentTarget.validity;finish('{}');await first;assert.equal(latest.currentTarget.validity,current);assert.match(current,/supported hosted-app/);assert.ok(nodes(render()).some(n=>n.props?.role==='alert'));});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';
import { build } from 'esbuild';

// Measure the shipped TSX with React's production JSX/runtime and serializer.
process.env.NODE_ENV = 'production';
const require = createRequire(import.meta.url);
const runtime = require('react/jsx-runtime');
const { renderToStaticMarkup } = require('react-dom/server');
const dir = 'artifacts/iphone-quality-audit-20261103/market-logo-allocation';
const beforeSource = fs.readFileSync(dir + '/app-logo-before.tsx', 'utf8');
const afterSource = fs.readFileSync('app/market/app-logo.tsx', 'utf8');
function load(source, countAllocations = true) {
  let allocations = 0;
  const instrumented = { ...runtime, jsx: (...args) => { allocations++; return runtime.jsx(...args); }, jsxs: (...args) => { allocations++; return runtime.jsxs(...args); } };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function('require','module','exports',code)(name => {
    if (name === 'react/jsx-runtime') return countAllocations ? instrumented : runtime;
    if (name.endsWith('.module.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    throw Error('Unexpected import ' + name);
  }, module, module.exports);
  return { render: app => module.exports.AppLogo({ app }), reset: () => { allocations = 0; }, count: () => allocations };
}
const before = load(beforeSource), after = load(afterSource);
const appsBundle = await build({ entryPoints: ['app/market/sample-apps.ts'], bundle: true, write: false, platform: 'node', format: 'cjs' });
const appsModule = { exports: {} }; new Function('module','exports',appsBundle.outputFiles[0].text)(appsModule,appsModule.exports);
const knownIds = [...beforeSource.matchAll(/"([a-z-]+)":\s*<>/g)].map(match => match[1]);
const apps = [...new Map([...appsModule.exports.sampleApps, ...knownIds.map(id => ({ id, color: 'mint', symbol: 'AB' })), { id: 'future-unknown', color: 'rose', symbol: 'XYZ' }, { id: 'unknown-empty', color: 'blue', symbol: '' }].map(app => [app.id,app])).values()];

test('all Market logo SVG, classes, accessibility and fallback output remain byte-identical', () => {
  const outputs = apps.map(app => {
    const old = renderToStaticMarkup(before.render(app)), next = renderToStaticMarkup(after.render(app));
    assert.equal(next,old,app.id);
    return { id:app.id,html:next };
  });
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/render-parity.json',JSON.stringify({passed:true,logos:outputs.length,knownMarks:knownIds.length,outputs},null,2));
});
test('a catalog render constructs only the chosen mark and cuts deterministic JSX allocations', () => {
  const counts=apps.map(app=>{
    before.reset();before.render(app);after.reset();after.render(app);
    return {id:app.id,before:before.count(),after:after.count()};
  });
  for(const row of counts)assert.ok(row.after<=8,row.id+' allocated unused mark elements');
  const total=key=>counts.reduce((n,row)=>n+row[key],0),previous=total('before'),current=total('after');
  assert.ok(current<previous*.15,JSON.stringify({previous,current}));
  fs.writeFileSync(dir+'/allocation-counts.json',JSON.stringify({kind:'Actual production React JSX calls in the real component per catalog render; includes SVG/span/selected fragment, excludes immutable module function definitions',logos:counts.length,before:previous,after:current,reductionPercent:(1-current/previous)*100,counts},null,2));
});
test('controlled production component and complete SVG serialization CPU benchmark', () => {
  const baseline=load(beforeSource,false),optimized=load(afterSource,false);
  const rounds=7,iterations=5000,measure=(implementation,serialize)=>{
    const started=performance.now(),cpu=process.cpuUsage();let sink=0;
    for(let i=0;i<iterations;i++)for(const app of apps){const output=implementation.render(app);sink+=serialize?renderToStaticMarkup(output).length:output.props.children.props.viewBox.length;}
    const used=process.cpuUsage(cpu);return {wallMs:performance.now()-started,cpuMs:(used.user+used.system)/1000,sink};
  };
  for(let i=0;i<2;i++){measure(baseline,false);measure(optimized,false);measure(baseline,true);measure(optimized,true);}
  const samples=[];
  for(let i=0;i<rounds;i++){
    // Alternate order to reduce warm-up and scheduling bias.
    const sample={};for(const phase of ['component','serialization'])for(const version of i%2?['after','before']:['before','after'])sample[phase+':'+version]=measure(version==='before'?baseline:optimized,phase==='serialization');samples.push(sample);
  }
  const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const summary={};for(const phase of ['component','serialization']){summary[phase]={};for(const version of ['before','after'])summary[phase][version]={medianWallMs:median(samples.map(s=>s[phase+':'+version].wallMs)),totalCpuMs:samples.reduce((n,s)=>n+s[phase+':'+version].cpuMs,0)};summary[phase].wallReductionPercent=(1-summary[phase].after.medianWallMs/summary[phase].before.medianWallMs)*100;}
  for(const s of samples){assert.equal(s['component:before'].sink,s['component:after'].sink);assert.equal(s['serialization:before'].sink,s['serialization:after'].sink);}
  fs.writeFileSync(dir+'/cpu-benchmark.json',JSON.stringify({kind:'Controlled local Node production React benchmark of actual TSX without allocation instrumentation; no network/device/app-load latency claim',logosPerBatch:apps.length*iterations,rounds,summary,samples},null,2));
  console.log('Market logo controlled render benchmark: '+JSON.stringify(summary));
});

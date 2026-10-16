import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

test('staff MyWork and schedule/workday carry the exact staff identity required by the grant-backed disk gate', async () => {
  const root = process.cwd().replaceAll('\\', '/');
  const result = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
import{StaffMyWorkClient}from'${root}/app/staff/my-work/staff-my-work-client';
import{useStaffReadResource}from'${root}/lib/use-staff-read-resource';
export function run(){
const snapshot={updatedAt:'2026-10-16T00:00:00Z',revision:'a'.repeat(64),sections:{},data:{kind:'schedule',staff:{id:'staff-a'},staffId:'staff-a',salonId:'salon-a',today:'2026-10-16'}};
StaffMyWorkClient({scope:'same-scope-as-market',initialSnapshot:snapshot,params:{tab:'payroll'}});
useStaffReadResource('same-scope-as-market',snapshot,new URLSearchParams({kind:'schedule',staffId:'staff-a'}));
useStaffReadResource('same-scope-as-market',{...snapshot,data:{...snapshot.data,kind:'workday'}},new URLSearchParams({kind:'workday',staffId:'staff-a'}));
}` }, jsx: 'automatic', bundle: true, write: false, format: 'cjs', platform: 'node',
    plugins: [{ name: 'capture-resource-opt-in', setup(builder) {
      builder.onResolve({ filter: /(?:use-experience-resource|use-live-experience-refresh|fetch-live-experience-resource|staff-my-work-view|loading-feedback)$/ }, args => ({ path: args.path.split('/').pop(), namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', contents: ({
        'use-experience-resource': 'export function useExperienceResource(options){globalThis.staffOptions.push(options);return{data:options.initialData,available:true,refresh:async()=>{}}}',
        'use-live-experience-refresh': 'export function useLiveExperienceRefresh(){}',
        'fetch-live-experience-resource': 'export function fetchLiveExperienceResource(){return async()=>{throw Error("No read expected")}}',
        'staff-my-work-view': 'export function StaffMyWorkView(){return null}',
        'loading-feedback': 'export function PageLoadingSkeleton(){return null}',
      })[args.path] }));
    } }],
  });
  const require = createRequire(import.meta.url), module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require);
  globalThis.staffOptions = [];
  try {
    module.exports.run();
    assert.equal(globalThis.staffOptions.length, 3);
    for (const options of globalThis.staffOptions) {
      assert.equal(options.persistence.params.staffId, 'staff-a', 'the foundation must match this identity to the fresh server-attested grant');
      assert.match(options.persistence.domain, /^staff-/);
      assert.equal(typeof options.fetcher, 'function', 'existing online reads remain active');
      assert.equal(options.scope, 'same-scope-as-market');
    }
  } finally { delete globalThis.staffOptions; }
});

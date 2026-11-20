import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {build} from 'esbuild';

const built=await build({
  entryPoints:['app/api/account/erase-due/route.ts'],bundle:true,write:false,format:'esm',platform:'node',
  alias:{'@':path.resolve('.')},
  plugins:[{name:'maintenance-workers',setup(api){
    api.onResolve({filter:/^(server-only|@\/lib\/(account-erasure-worker|lifecycle-export-expiry|public-image-staging-expiry|public-post-media-deletion|rights-evidence-worker))$/},a=>({path:a.path,namespace:'stub'}));
    api.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:`
      export const runAccountErasures=async()=>{globalThis.__maintenance.calls.push('accounts');return {completed:2,failed:0};};
      export const runLifecycleExportExpiry=async()=>{globalThis.__maintenance.calls.push('exports');if(globalThis.__maintenance.failExports)throw Error('provider details must remain private');return {removed:3,failed:0};};
      export const runPublicImageStagingExpiry=async()=>{globalThis.__maintenance.calls.push('staging');return {removed:4,failed:0};};
      export const runPublicPostMediaDeletions=async()=>{globalThis.__maintenance.calls.push('postMedia');if(globalThis.__maintenance.failPostMedia)throw Error('private image identity must not escape');return {claimed:1,removed:1,failed:0,deferred:0};};
      export const runRightsImageEvidence=async()=>({claimed:0,captured:0,removed:0,purged:0,failed:0,deferred:0,blocked:0});
    `}));
  }}],
});
const {GET}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('existing cron authorization and local disable gate protect every worker; independent cleanup failures stay observable',async()=>{
  const previous={secret:process.env.CRON_SECRET,disabled:process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH};
  process.env.CRON_SECRET='maintenance-test-only';delete process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH;
  globalThis.__maintenance={calls:[]};
  const rightsZero=()=>({claimed:0,captured:0,removed:0,purged:0,failed:0,deferred:0,blocked:0});
  const rightsEvidence={capture:rightsZero(),removeOrigin:rightsZero(),purge:rightsZero()};
  const request=token=>new Request('http://localhost/api/account/erase-due',{headers:token?{authorization:token}:{}});
  try{
    assert.equal((await GET(request())).status,401);
    assert.equal((await GET(request('Bearer wrong'))).status,401);
    assert.deepEqual(globalThis.__maintenance.calls,[]);
    process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH='1';
    assert.equal((await GET(request('Bearer maintenance-test-only'))).status,503);
    assert.deepEqual(globalThis.__maintenance.calls,[]);
    delete process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH;
    const success=await GET(request('Bearer maintenance-test-only'));
    assert.equal(success.status,200);assert.equal(success.headers.get('cache-control'),'no-store');
    assert.deepEqual(await success.json(),{completed:2,failed:0,exports:{removed:3,failed:0},imageStaging:{removed:4,failed:0},postMedia:{claimed:1,removed:1,failed:0,deferred:0},rightsEvidence});
    assert.deepEqual(globalThis.__maintenance.calls,['exports','staging','postMedia','accounts']);
    globalThis.__maintenance={calls:[],failExports:true};
    const partial=await GET(request('Bearer maintenance-test-only'));
    assert.equal(partial.status,503);
    assert.deepEqual(await partial.json(),{completed:2,failed:0,exports:{removed:0,failed:1},imageStaging:{removed:4,failed:0},postMedia:{claimed:1,removed:1,failed:0,deferred:0},rightsEvidence});
    assert.deepEqual(globalThis.__maintenance.calls,['exports','staging','postMedia','accounts']);
    globalThis.__maintenance={calls:[],failPostMedia:true};
    const imageFailure=await GET(request('Bearer maintenance-test-only'));
    assert.equal(imageFailure.status,503);
    assert.deepEqual(await imageFailure.json(),{completed:2,failed:0,exports:{removed:3,failed:0},imageStaging:{removed:4,failed:0},postMedia:{claimed:0,removed:0,failed:1,deferred:0},rightsEvidence});
    assert.deepEqual(globalThis.__maintenance.calls,['exports','staging','postMedia','accounts']);
  }finally{
    if(previous.secret===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous.secret;
    if(previous.disabled===undefined)delete process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH;else process.env.KINGPOS_DISABLE_BACKGROUND_DISPATCH=previous.disabled;
    delete globalThis.__maintenance;
  }
});

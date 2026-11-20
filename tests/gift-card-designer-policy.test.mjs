import assert from 'node:assert/strict';import {build} from 'esbuild';
const output=await build({entryPoints:['lib/experience-route-policies.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {getExperienceRoutePolicy:p}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const owner=p('/gift-cards/manage');assert.equal(owner.requiresAuth,true);assert.equal(owner.retainData,'none');assert.equal(owner.resetOnHide,false);assert.equal(owner.revalidateOnShow,true);assert.equal(owner.allowPrefetch,false);
for(const path of ['/gift-cards','/gift-cards/transfer','/gift-cards/manage?token=secret','/gift-cards#card=secret','/api/gift-cards'])assert.equal(p(path).resetOnHide,true,path);
console.log('PASS owner designer retains draft; wallet, transfers, tokens, API policies stay separate.');

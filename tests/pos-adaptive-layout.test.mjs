import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('POS fits multiple staff rows and services before falling back to minimum-density scrolling',async()=>{
 const built=await build({entryPoints:['lib/pos-adaptive-layout.ts'],bundle:true,write:false,format:'esm'});
 const {planPosTiles}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const roomy=planPosTiles(710,1000,18,48);
 assert.equal(roomy.overflow,false);assert.ok(roomy.staffColumns<18);assert.ok(roomy.staffRequired+roomy.serviceRequired<=1000);
 const compact=planPosTiles(710,620,18,48);assert.equal(compact.overflow,false);assert.ok(compact.density<roomy.density);
 const full=planPosTiles(710,500,80,240);assert.equal(full.overflow,true);assert.equal(full.density,0);assert.ok(full.staffSpace>=full.staffHeight);assert.ok(full.serviceSpace>=full.serviceHeight);
 for(const width of [280,480,710,1000])for(const height of [200,500,850])for(const count of [0,1,12,48,200]){
  const plan=planPosTiles(width,height,count,count*2);
  assert.ok(plan.staffColumns>=1&&plan.serviceColumns>=1);
  assert.ok(Math.abs(plan.staffSpace+plan.serviceSpace-height)<.01);
  if(plan.overflow)assert.equal(plan.density,0);else assert.ok(plan.staffRequired+plan.serviceRequired<=height);
 }
});

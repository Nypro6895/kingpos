import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const module={exports:{}};
vm.runInNewContext(transformSync(readFileSync(new URL('../lib/media-upload-progress.ts',import.meta.url),'utf8'),{loader:'ts',format:'cjs'}).code,{module,exports:module.exports});
const {mediaBatchProgress}=module.exports;
test('a small first image must not claim half of a much larger batch',()=>{
 assert.equal(mediaBatchProgress(0,100,100,1000),10);
 assert.equal(mediaBatchProgress(100,900,0,1000),10);
 assert.equal(mediaBatchProgress(100,900,50,1000),55);
 assert.equal(mediaBatchProgress(100,900,100,1000),100);
});
test('advancing to the next file keeps the displayed batch progress monotonic',()=>{
 const sizes=[800,150,50];let completed=0,last=0;
 for(const size of sizes){for(const pct of [0,1,15,70,99,100]){const next=mediaBatchProgress(completed,size,pct,1000);assert.ok(next>=last);assert.ok(next<=100);last=next;}completed+=size;}
 assert.equal(last,100);
});
test('empty or malformed totals do not report success',()=>{
 for(const total of [0,-1,NaN,Infinity])assert.equal(mediaBatchProgress(0,100,100,total),0);
 assert.equal(mediaBatchProgress(0,100,130,100),100);
 assert.equal(mediaBatchProgress(0,100,-10,100),0);
});

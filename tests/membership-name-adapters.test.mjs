import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{applyNameAdapters}from'../scripts/apply-membership-name-adapters.mjs';
test('Reviewed identity adapters refuse source drift before writing any candidate file',()=>{
 const root=fs.mkdtempSync(path.resolve('artifacts/member-everywhere/adapter-test-')),source=path.join(root,'source'),target=path.join(root,'target');fs.mkdirSync(source);
 const hash=s=>createHash('sha256').update(s).digest('hex');for(const file of['first.tsx','second.tsx'])fs.writeFileSync(path.join(source,file),'original');
 const manifest={files:['first.tsx','second.tsx'].map(file=>({file,sha256:hash('original'),edits:[{start:0,end:8,before:'original',after:'reviewed'}]}))};
 fs.writeFileSync(path.join(source,'second.tsx'),'newer source');assert.throws(()=>applyNameAdapters({source,target,manifest}),/Source drift/);assert.equal(fs.existsSync(target),false);assert.equal(fs.readFileSync(path.join(source,'first.tsx'),'utf8'),'original');
 fs.writeFileSync(path.join(source,'second.tsx'),'original');assert.equal(applyNameAdapters({source,target,manifest}).length,2);assert.equal(fs.readFileSync(path.join(target,'first.tsx'),'utf8'),'reviewed');assert.equal(fs.readFileSync(path.join(source,'first.tsx'),'utf8'),'original');
});

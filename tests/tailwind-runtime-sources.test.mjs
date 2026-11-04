import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {compile} from '@tailwindcss/node';
import {Scanner} from '@tailwindcss/oxide';

test('Tailwind scans live UI sources and preserves their generated utilities', {timeout:30000}, async()=>{
 const file=path.resolve('app/globals.css'),css=fs.readFileSync(file,'utf8');
 const compiled=await compile(css,{base:path.dirname(file),onDependency(){}});
 assert.equal(compiled.root,'none','automatic checkout scanning must remain disabled');
 const actual=new Scanner({sources:compiled.sources});
 const actualCandidates=actual.scan();
 const expected=new Scanner({sources:['app','components','lib'].map(folder=>({base:path.resolve(folder),pattern:'**/*',negated:false}))});
 const expectedCandidates=expected.scan();
 assert.deepEqual(new Set(actualCandidates),new Set(expectedCandidates));
 assert.ok(actual.files.length>1000);
 for(const file of actual.files)assert.match(path.relative(process.cwd(),file).replaceAll('\\','/'),/^(app|components|lib)\//);
 const baseline=await compile(css.replace('@import "tailwindcss" source(none);','@import "tailwindcss";'),{base:path.dirname(file),onDependency(){}});
 assert.equal(compiled.build(actualCandidates),baseline.build(expectedCandidates),'all existing runtime CSS generation remains identical');
 console.log(`Live Tailwind sources: ${actual.files.length} files, ${actualCandidates.length} candidates`);
});

import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import ts from 'typescript';
const code=ts.transpileModule(fs.readFileSync('lib/daily-closing-input.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const helpers={};new Function('exports',code)(helpers);
test('money editing accepts blanks, cents, decimal keyboards and grouped pastes without changing their value',()=>{
 for(const [input,cents]of[['',0],['0.00',0],['165',16500],['16.50',1650],['16,50',1650],['.50',50],['16.',1600],['$ 1,234.56',123456],['1,234',123400]])assert.equal(helpers.parseClosingCents(input),cents,input);
 for(const input of ['0.0016','1.234','1,23,4','NaN','Infinity','1e3','-1','10000000000'])assert.equal(helpers.parseClosingCents(input),null,input);
});
test('blur formatting keeps zero empty, preserves nonzero cents and never truncates invalid input',()=>{
 assert.equal(helpers.normalizeClosingMoney('0.00'),'');assert.equal(helpers.normalizeClosingMoney('16.5'),'16.50');assert.equal(helpers.normalizeClosingMoney('16,50'),'16.50');assert.equal(helpers.normalizeClosingMoney('0.0016'),'0.0016');
 assert.deepEqual(helpers.closingValues({cashAmount:165,creditCardAmount:0,otherAmount:0,note:null}),{cashAmount:'165.00',creditCardAmount:'',otherAmount:'',note:''});
});
test('equivalent edit formatting cannot trigger a second semantic save',()=>{
 const base={cashAmount:'16.50',creditCardAmount:'',otherAmount:'',note:' note '};assert.equal(helpers.closingSnapshot(base),helpers.closingSnapshot({...base,cashAmount:'16,5',creditCardAmount:'0.00',note:'note'}));assert.throws(()=>helpers.closingPayload({...base,cashAmount:'16.555'}),/2 decimal/);
});

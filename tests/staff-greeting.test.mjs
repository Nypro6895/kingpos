import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const exports={};
new Function('exports',ts.transpileModule(readFileSync('lib/staff-greeting.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText)(exports);
const greeting=exports.staffGreeting;
const base={name:'Tracy Nguyen',timezone:'America/Chicago',todayServices:120,businessDate:'2026-09-24',now:'2026-09-24T14:00:00Z',history:{date:'2026-09-24',history_available:true,worked_yesterday:true,yesterday_services:199.99}};
test('morning encouragement distinguishes low sales, day off, and unknown history',()=>{
 assert.match(greeting(base).text,/Morning, Tracy.*today’s your day/);
 assert.equal(greeting({...base,history:{...base.history,yesterday_services:200}}).text,'Good morning, Tracy');
 assert.match(greeting({...base,history:{...base.history,worked_yesterday:false}}).text,/rested/);
 assert.equal(greeting({...base,history:null}).text,'Good morning, Tracy');
 assert.equal(greeting({...base,history:{...base.history,history_available:false}}).text,'Good morning, Tracy');
});
test('afternoon thresholds preserve strict above 300/500 and at least 400',()=>{
 const expected=[[300,'Good afternoon'],[300.01,'great work'],[399.99,'great work'],[400,'amazing work'],[500,'amazing work'],[500.01,'celebrate tonight']];
 for(const [todayServices,phrase] of expected)assert.ok(greeting({...base,now:'2026-09-24T20:00:00Z',todayServices}).text.includes(phrase));
});
test('greeting uses salon hour, noon and evening, not the server timezone',()=>{
 assert.equal(greeting({...base,now:'2026-09-24T17:00:00Z'}).text,'Hello, Tracy');
 assert.equal(greeting({...base,now:'2026-09-24T23:00:00Z',history:null}).text,'Good evening, Tracy');
 assert.match(greeting({...base,now:'2026-09-25T01:00:00Z',todayServices:501}).text,/Evening.*celebrate tonight/);
});
test('old-day totals and yesterday context never trigger encouragement after midnight',()=>{
 assert.equal(greeting({...base,now:'2026-09-25T14:00:00Z',todayServices:501}).text,'Good morning, Tracy');
 assert.equal(greeting({...base,history:{...base.history,date:'2026-09-23'}}).text,'Good morning, Tracy');
});

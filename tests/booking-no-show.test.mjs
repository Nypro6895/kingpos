import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
const source = readFileSync('lib/booking-no-show.ts','utf8');
const {outputText} = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}});
const module = {exports:{}};
new Function('exports',outputText)(module.exports);
const {bookingStatusLabel} = module.exports;
test('explicit no-show classification is independent of optional notes',()=>{
 assert.equal(bookingStatusLabel('no_show','unexcused'),'No-show');
 assert.equal(bookingStatusLabel('no_show','excused'),'No-show · With reason');
 assert.equal(bookingStatusLabel('no_show',null),'No-show · Unclassified');
 assert.equal(bookingStatusLabel('no_show'),'No-show · Unclassified');
 assert.equal(bookingStatusLabel('checked_in','excused'),'checked in');
});

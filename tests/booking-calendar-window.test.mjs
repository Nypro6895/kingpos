import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync('lib/booking-calendar-window.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {bookingCalendarWindow}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const date='2026-09-25';

test('Today includes current time before opening, after closing and on closed days without crossing midnight',()=>{
 const hours={date,source:'salon',intervals:[{start:540,end:1020}]};
 assert.deepEqual([bookingCalendarWindow(hours,date,[],1209).start,bookingCalendarWindow(hours,date,[],1209).end],[540,1290]);
 assert.equal(bookingCalendarWindow(hours,date,[],360).start,300);
 assert.equal(bookingCalendarWindow(hours,date,[],5).start,0);
 assert.equal(bookingCalendarWindow(hours,date,[],1439).end,1440);
 const closed=bookingCalendarWindow({date,source:'salon',intervals:[]},date,[],900);
 assert.ok(closed.closed&&closed.start<900&&closed.end>900);
});
test('Calendar uses opening intervals, preserves before/after-hours appointments and recognizes closed days',()=>{
 const hours={date,source:'salon',intervals:[{start:570,end:720},{start:780,end:1110}]};
 const ordinary=bookingCalendarWindow(hours,date,[{start:600,end:645}]);assert.equal(ordinary.start,570);assert.equal(ordinary.end,1110);assert.equal(ordinary.outside,false);
 const exceptional=bookingCalendarWindow(hours,date,[{start:540,end:600},{start:1100,end:1155}]);assert.equal(exceptional.start,540);assert.equal(exceptional.end,1170);assert.equal(exceptional.outside,true);
 assert.equal(bookingCalendarWindow(hours,date,[{start:710,end:790}]).outside,true,'appointment spanning a closure is visible as an exception');
 assert.equal(bookingCalendarWindow({date,source:'salon',intervals:[]},date,[]).closed,true);
 assert.equal(bookingCalendarWindow(hours,'2026-09-26',[]).known,false,'stale day response does not apply');
 assert.equal(bookingCalendarWindow(undefined,date,[]).closed,false,'unavailable is not interpreted as closed');
});

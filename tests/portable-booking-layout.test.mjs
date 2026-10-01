import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('lib/portable-booking-layout.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { bookingDate, bookingMinute, bookingDayInterval, layoutBookingColumn } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const zone = 'America/Chicago';
const item = (id, start, end) => ({ id, startAt: `2026-09-24T${start}:00-05:00`, endAt: `2026-09-24T${end}:00-05:00` });

test('salon coordinates and midnight clipping are independent of device timezone', () => {
  assert.equal(bookingDate('2026-09-25T02:00:00Z', zone), '2026-09-24');
  assert.equal(bookingMinute('2026-09-25T02:00:00Z', zone), 1260);
  const overnight = { id: 'night', startAt: '2026-09-24T23:30:00-05:00', endAt: '2026-09-25T00:30:00-05:00' };
  assert.deepEqual(bookingDayInterval(overnight, '2026-09-24', zone), { start: 1410, end: 1440 });
  assert.deepEqual(bookingDayInterval(overnight, '2026-09-25', zone), { start: 0, end: 30 });
  assert.equal(bookingDayInterval({ ...overnight, endAt: '2026-09-25T00:00:00-05:00' }, '2026-09-25', zone), null);
  assert.equal(bookingDayInterval(overnight, '2026-09-26', zone), null);
});

test('overlaps get separate lanes; touching and later groups reclaim full width', () => {
  const rows = layoutBookingColumn([item('c', '10:00', '10:30'), item('a', '09:00', '10:00'), item('b', '09:30', '10:00'), item('d', '12:00', '12:30')], '2026-09-24', zone);
  assert.deepEqual(rows.map(r => [r.item.id, r.lane, r.lanes]), [['a', 0, 2], ['b', 1, 2], ['c', 0, 1], ['d', 0, 1]]);
});

test('nested and chained overlaps stay collision-free and inputs remain unchanged', () => {
  const source = [item('a', '09:00', '11:00'), item('b', '09:30', '10:00'), item('c', '09:45', '10:30'), item('d', '10:00', '10:15')];
  const before = JSON.stringify(source);
  const rows = layoutBookingColumn(source, '2026-09-24', zone);
  assert.equal(JSON.stringify(source), before);
  assert.ok(rows.every(r => r.lanes === 3));
  for (const a of rows) for (const b of rows) {
    if (a !== b && a.start < b.end && b.start < a.end) assert.notEqual(a.lane, b.lane);
  }
});

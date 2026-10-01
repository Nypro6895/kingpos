import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compile = path => ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const uri = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const source = compile('lib/booking-time-policy.ts')
  .replace('"./portable-booking-layout"', JSON.stringify(uri(compile('lib/portable-booking-layout.ts'))))
  .replace('"./portable-booking-time"', JSON.stringify(uri(compile('lib/portable-booking-time.ts'))));
const { DEFAULT_BOOKING_TIME_POLICY: defaults, validateBookingStart: validate, defaultBookingStart: suggest, bookingInputBounds: bounds } = await import(uri(source));
const now = Date.parse('2026-09-24T13:55:00-05:00');
const zone = 'America/Chicago';

test('14:00 cannot book 09:00; default is tomorrow with 120 minute notice and 60 day horizon', () => {
  assert.match(validate('2026-09-24T09:00:00-05:00', defaults, zone, now), /Past times/);
  assert.match(validate('2026-09-24T16:00:00-05:00', defaults, zone, now), /Same-day/);
  assert.equal(suggest('2026-09-24', defaults, zone, now), '2026-09-25T09:00');
  assert.equal(validate('2026-09-25T09:00:00-05:00', defaults, zone, now), null);
  assert.match(validate('2027-01-01T09:00:00-06:00', defaults, zone, now), /60 days/);
});

test('saved same-day and lead-time choices are honored but never allow past time', () => {
  const sameDay = { ...defaults, sameDayBookingEnabled: true, minimumLeadTimeMinutes: 0 };
  assert.match(validate('2026-09-24T09:00:00-05:00', sameDay, zone, now), /Past times/);
  assert.equal(suggest('2026-09-24', sameDay, zone, now), '2026-09-24T14:00');
  assert.equal(validate('2026-09-24T14:00:00-05:00', sameDay, zone, now), null);
  assert.match(validate('2026-09-24T14:00:00-05:00', { ...sameDay, minimumLeadTimeMinutes: 120 }, zone, now), /120 minutes/);
});

test('salon timezone, midnight lead time and DST remain consistent', () => {
  const late = Date.parse('2026-09-25T04:30:00Z'); // 23:30 salon time.
  assert.equal(bounds(defaults, zone, late).min, '2026-09-25T01:30');
  assert.equal(suggest('2026-09-24', defaults, zone, late), '2026-09-25T09:00');
  const dst = Date.parse('2026-03-08T07:30:00Z');
  const policy = { ...defaults, sameDayBookingEnabled: true };
  assert.equal(bounds(policy, zone, dst).min, '2026-03-08T04:30');
  assert.equal(validate('bad', defaults, zone, now), 'Choose a valid appointment time.');
});

test('selected future date is retained and no suggestion is returned beyond the horizon', () => {
  assert.equal(suggest('2026-10-01', defaults, zone, now), '2026-10-01T09:00');
  assert.equal(suggest('2027-01-01', defaults, zone, now), '');
});

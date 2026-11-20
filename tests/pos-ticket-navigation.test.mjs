import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transformSync } from 'esbuild';

const { code } = transformSync(readFileSync('lib/pos-ticket-navigation.ts', 'utf8'), {
  loader: 'ts', format: 'esm', target: 'es2020',
});
const navigation = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const ticketId = 'bbbbbbbb-2222-4333-8444-555555555555';

test('ticket links preserve the actual business day across midnight and daylight saving', () => {
  assert.equal(navigation.ticketBusinessDate('2026-11-14T01:25:00Z', 'America/Chicago'), '2026-11-13');
  assert.equal(navigation.ticketBusinessDate('2026-11-01T05:30:00Z', 'America/Chicago'), '2026-11-01');
  assert.equal(navigation.ticketBusinessDate('2026-11-01T07:30:00Z', 'America/Chicago'), '2026-11-01');
  assert.equal(navigation.ticketBusinessDate('2026-11-14T07:25:00Z', 'America/Chicago'), '2026-11-14');
});

test('a list link retains the selected day, search text and exact ticket identity', () => {
  const href = navigation.buildTicketListHref({ ticketId, date: '2026-11-14', q: ' 001 Nene & Kim ' });
  const url = new URL(href, 'https://local.test');
  assert.equal(url.pathname, '/pos-tickets');
  assert.equal(url.searchParams.get('ticketId'), ticketId);
  assert.equal(url.searchParams.get('date'), '2026-11-14');
  assert.equal(url.searchParams.get('q'), '001 Nene & Kim');
  assert.equal(navigation.buildTicketListHref({ date: '2026-02-30', ticketId: '../../other' }), '/pos-tickets');
});

test('return navigation accepts only ticket lists and cannot send the owner to an external or unrelated page', () => {
  for (const unsafe of [
    'https://evil.test/pos-tickets', '//evil.test/pos-tickets', '/\\evil.test/pos-tickets',
    '/settings?next=/pos-tickets', '/pos-tickets/another-ticket', '/pos-tickets\n?date=2026-11-14',
  ]) {
    assert.equal(navigation.sanitizeTicketListReturnTo(unsafe), '/pos-tickets', unsafe);
  }
  assert.equal(navigation.sanitizeTicketListReturnTo('/pos-tickets?date=2026-11-14&next=https://evil.test#ticket'), '/pos-tickets?date=2026-11-14');
  assert.equal(navigation.sanitizeTicketListReturnTo('/pos/ticket?date=2026-11-14'), '/pos/ticket?date=2026-11-14');
  assert.equal(navigation.sanitizeTicketListReturnTo('https://evil.test', '/pos-tickets?date=2026-11-13'), '/pos-tickets?date=2026-11-13');
  assert.equal(navigation.sanitizeTicketListReturnTo('https://evil.test', 'https://other.test'), '/pos-tickets');
  assert.equal(navigation.sanitizeTicketListReturnTo(['/pos-tickets', 'https://evil.test']), '/pos-tickets');
  assert.equal(navigation.isPosTicketId([ticketId]), false);
});

test('edit links carry safe list context through the detail route without hash-bearing mutation redirects', () => {
  const listHref = navigation.buildTicketListHref({ ticketId, date: '2026-11-14', q: 'Nene' });
  const editHref = navigation.buildTicketDetailHref(ticketId, { edit: true, returnTo: listHref });
  const url = new URL(editHref, 'https://local.test');
  assert.equal(url.pathname, `/pos-tickets/${ticketId}`);
  assert.equal(url.searchParams.get('edit'), '1');
  assert.equal(url.searchParams.get('returnTo'), listHref);
  assert.equal(url.hash, '');
  assert.equal(new URL(navigation.buildTicketDetailHref(ticketId, { returnTo: '//evil.test' }), 'https://local.test').searchParams.get('returnTo'), '/pos-tickets');
});

test('the shipped Reports return journey survives edit/cancel while external paths stay rejected',()=>{
  for(const report of ['/reports?month=2026-11','/pos/report?date=2026-11-14']){
    const href=navigation.buildTicketDetailHref(ticketId,{edit:true,returnTo:report});
    assert.equal(new URL(href,'https://local.test').searchParams.get('returnTo'),report);
  }
  assert.equal(navigation.sanitizeTicketDetailReturnTo('/reports?month=2026-11#ignored'),'/reports?month=2026-11');
  for(const value of ['https://evil.test/reports','//evil.test/reports','/\\evil.test/reports','/reports\n?month=2026-11','/settings?next=/reports'])assert.equal(navigation.sanitizeTicketDetailReturnTo(value),'/pos-tickets');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStaffRoster } from '../lib/portable-staff-roster.ts';

test('repeated partial attendance events and reordered full refreshes keep card positions', () => {
  let rows = ['a','b','c'].map(id => ({id,status:'working',turn:1}));
  for (let n=2;n<20;n++) {
    rows=mergeStaffRoster(rows,[{id:'a',status:'break',turn:n}],['a']);
    assert.deepEqual(rows.map(r=>r.id),['a','b','c']);
    assert.equal(rows[0].status,'break');
    assert.equal(rows[0].turn,n);
    rows=mergeStaffRoster(rows,[rows[2],rows[0],rows[1]]);
    assert.deepEqual(rows.map(r=>r.id),['a','b','c']);
  }
  rows=mergeStaffRoster(rows,[{id:'b',status:'checked_out',turn:20}],['b']);
  assert.equal(rows[1].status,'checked_out');
  assert.deepEqual(rows.map(r=>r.id),['a','b','c']);
});

test('deleted and newly added staff reconcile without moving unrelated cards', () => {
  const rows=['a','b','c'].map(id=>({id}));
  assert.deepEqual(mergeStaffRoster(rows,[],['b']).map(r=>r.id),['a','c']);
  assert.deepEqual(mergeStaffRoster(rows,[{id:'c'},{id:'d'},{id:'a'}]).map(r=>r.id),['a','c','d']);
  assert.deepEqual(mergeStaffRoster(rows,[{id:'d'}],['d']).map(r=>r.id),['a','b','c','d']);
  assert.deepEqual(rows.map(r=>r.id),['a','b','c']);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function harness() {
  const entries = new Map([
    ['kingpos-explore-continuous-feed:/explore', 'feed'], ['explore-sections:all', '2'],
    ['kingpos.publicBookingDraft.v3.salon.auth', 'handoff'], ['kingpos.publicBookingDraft.v3.salon.user', 'draft'],
    ['kingpos-portable-operations', 'outbox'], ['unrelated', 'retained'],
  ]);
  const events = [], exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('lib/reset-experience-cache.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: name => name.endsWith('experience-state') ? { clearExperienceState() { events.push('clear-ui'); } }
      : name.endsWith('experience-resource-cache') ? { resetExperienceResources(scope) { events.push(['clear-resources', scope]); }, suspendExperienceResources() { events.push('suspend-resources'); } }
      : { EXPERIENCE_RESET_EVENT:'reylumi:experience-reset', broadcastExperienceReset(reason) { events.push(['broadcast', reason]); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    window: { sessionStorage: { get length() { return entries.size; }, key: index => [...entries.keys()][index], removeItem: key => entries.delete(key) }, dispatchEvent: event => events.push(event.type) },
  });
  return { reset: exports.resetExperienceCaches, entries, events };
}

test('confirmed logout removes browsing and booking snapshots without touching POS or other storage', () => {
  const h = harness(); h.reset();
  assert.deepEqual([...h.entries.keys()], ['kingpos-portable-operations', 'unrelated']);
  assert.deepEqual(h.events, [['clear-resources', undefined], 'clear-ui', 'reylumi:experience-reset']);
});

test('identity changes preserve the single-use login handoff and let new writers run', () => {
  const h = harness(); h.reset({ notify: false, preserveBookingHandoff: true });
  assert.equal(h.entries.has('kingpos.publicBookingDraft.v3.salon.auth'), true);
  assert.equal(h.entries.has('kingpos.publicBookingDraft.v3.salon.user'), false);
  assert.deepEqual(h.events, [['clear-resources', undefined], 'clear-ui']);
});

test('expiry suspends resources and broadcasts without allowing old records to be reseeded', () => {
  const h = harness(); h.reset({ reason:'expired' });
  assert.deepEqual(h.events, ['suspend-resources','clear-ui','reylumi:experience-reset',['broadcast','expired']]);
});

test('fresh identity retirement resets only the old resource scope without interrupting new writers', () => {
  const h = harness(); h.reset({ reason:'permissions',scope:'old-grants',notify:false,bookingDrafts:false,broadcast:true });
  assert.deepEqual(h.events, [['clear-resources','old-grants'],'clear-ui',['broadcast','permissions']]);
  assert.equal(h.entries.has('kingpos-portable-operations'), true);
});

test('workspace changes preserve in-progress booking choices', () => {
  const h = harness(); h.reset({ notify: false, bookingDrafts: false });
  assert.equal(h.entries.has('kingpos.publicBookingDraft.v3.salon.user'), true);
  assert.equal(h.entries.has('kingpos-explore-continuous-feed:/explore'), false);
});

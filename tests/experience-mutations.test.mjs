import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const exports = {};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/experience-mutations.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports });
const { classifyExperienceResponse, experienceMutationTags } = exports;
const classify = (path, method = 'POST', request = {}, response = {}) => classifyExperienceResponse(path, method, new Headers(request), new Headers(response));

test('searches, availability reads and delivery telemetry do not invalidate page data or authorization', () => {
  for (const path of [
    '/api/explore/search', '/api/explore/feed', '/api/explore/area',
    '/api/explore/advertising', '/api/public-booking/inspiration-times',
    '/api/pos/windows-download', '/api/campaigns/delivery',
  ]) assert.equal(classify(path), 'none', path);
});

test('server-action reads stay passive while Next 16 revalidation and explicit change hints preserve writes', () => {
  const action = { 'Next-Action': 'fixture-action' };
  assert.equal(classify('/settings', 'POST', action), 'none');
  for (const value of ['1', '2']) assert.equal(classify('/settings', 'POST', action, { 'x-action-revalidated': value }), 'data');
  for (const value of ['', '0', 'true', '3', 'invalid']) assert.equal(classify('/settings', 'POST', action, { 'x-action-revalidated': value }), 'none', value);
  assert.equal(classify('/settings', 'POST', action, { 'x-action-revalidated': '[[],0,0]' }), 'none', 'do not interpret an obsolete Next header format as a mutation');
  assert.equal(classify('/settings', 'POST', action, { 'x-reylumi-experience-change': 'data' }), 'data');
  assert.equal(classify('/settings', 'POST', action, { 'x-reylumi-experience-change': 'scope' }), 'scope');
  assert.equal(classify('/api/explore/feed', 'POST', {}, { 'x-reylumi-experience-change': 'scope' }), 'scope', 'a confirmed access-change hint takes precedence over a normally passive route');
});

test('ordinary REST writes retain invalidation and authentication keeps its separate lifecycle', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(classify('/api/bookings', method), 'data');
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(classify('/api/bookings', method), 'none');
  for (const path of ['/api/auth/login', '/api/auth/logout', '/api/auth/admin-activity']) assert.equal(classify(path), 'none');
});

test('known data writes target the relevant cache tags while server actions use their current account scope', () => {
  assert.deepEqual(Array.from(experienceMutationTags('/api/notifications')), ['notification-center']);
  assert.deepEqual(Array.from(experienceMutationTags('/api/notifications/preferences')), ['notification-center']);
  assert.deepEqual(Array.from(experienceMutationTags('/api/market/orders')), ['market', 'catalog', 'settings']);
  assert.equal(experienceMutationTags('/settings'), undefined);
});

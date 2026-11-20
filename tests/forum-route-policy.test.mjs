import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';

const module = {exports:{}};
const source = readFileSync(new URL('../lib/experience-route-policies.ts', import.meta.url), 'utf8');
new Function('module', 'exports', transformSync(source, {loader:'ts', format:'cjs'}).code)(module, module.exports);
const {getExperienceRoutePolicy, getExperienceRouteKey} = module.exports;

test('Forum reading tabs retain authenticated browsing without admitting public or background authority', () => {
  for (const href of ['/forum', '/forum?view=following', '/forum?view=chat', '/forum?view=saved', '/forum?view=mine', '/forum?view=sections', '/forum?topic=00000000-0000-4000-8000-000000000001&reply=00000000-0000-4000-8000-000000000002', '/forum?section=operations']) {
    const policy = getExperienceRoutePolicy(href);
    assert.equal(policy.family, 'forum', href);
    assert.equal(policy.classified, true, href);
    assert.equal(policy.requiresAuth, true, href);
    assert.equal(policy.resetOnHide, false, href);
    assert.equal(policy.revalidateOnShow, true, href);
    assert.equal(policy.retainData, 'memory', href);
    assert.equal(policy.allowPrefetch, false, href);
    assert.notEqual(getExperienceRouteKey(href), null, href);
  }
});

test('Forum compose and moderation do not retain their action state or route keys', () => {
  for (const href of ['/forum?view=write', '/forum?view=manage', '/forum?view=feed&view=manage']) {
    const policy = getExperienceRoutePolicy(href);
    assert.equal(policy.family, 'forum-action', href);
    assert.equal(policy.requiresAuth, true, href);
    assert.equal(policy.resetOnHide, true, href);
    assert.equal(policy.retainData, 'none', href);
    assert.equal(getExperienceRouteKey(href), null, href);
  }
});

test('Forum cannot borrow reading retention for secret URLs, handlers or unknown child routes', () => {
  for (const href of ['/forum?token=secret', '/forum?view=chat&next=%2Fsettings', '/forum?section=delete', '/forum#private']) {
    const policy = getExperienceRoutePolicy(href);
    assert.equal(policy.family, 'transient', href);
    assert.equal(policy.resetOnHide, true, href);
    assert.equal(policy.retainData, 'none', href);
    assert.equal(getExperienceRouteKey(href), null, href);
  }
  assert.equal(getExperienceRoutePolicy('/forum', 'handler').family, 'handler');
  assert.equal(getExperienceRoutePolicy('/forum/unknown').classified, false);
  assert.equal(getExperienceRoutePolicy('/settings?section=login-security').family, 'transient');
});

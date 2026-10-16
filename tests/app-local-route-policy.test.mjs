import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { build } from 'esbuild';
import { generateAppLocalInventory } from '../scripts/generate-app-local-routes.mjs';

async function load(entry) {
  const output = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', alias: { '@': process.cwd() } });
  return import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
}

test('every real page and ancestor layout is inventoried without claiming an unregistered renderer is complete', async () => {
  const generated = await generateAppLocalInventory();
  const checkedIn = JSON.parse(await readFile('lib/app-local-route-inventory.generated.json', 'utf8'));
  assert.deepEqual(checkedIn, generated);
  assert.ok(generated.pageCount >= 133); assert.ok(generated.layoutCount >= 16);
  assert.equal(new Set(generated.routes.map(row => row.source)).size, generated.pageCount);
  for (const row of generated.routes) {
    await access(row.source);
    assert.ok(['public-static', 'business-catalog', 'live', 'sensitive-writes'].includes(row.classification));
    assert.equal(row.ui.rendererReady, false);
    assert.equal(row.data.requiresFreshServerAuthorityForWrites, true);
    assert.ok(row.authority.includes('server-validated'));
  }
  const checkIn = generated.routes.find(row => row.route === '/pos/check-in');
  assert.ok(checkIn.clientModules.some(row => row.exports.includes('PortableCheckInClient')));
  assert.ok(checkIn.propsLoaders.some(row => row.endsWith('#getOwnerCheckInData')));
  assert.ok(checkIn.layouts.includes('app/(app)/pos/(workspace)/layout.tsx'));
  const admin = generated.routes.find(row => row.route === '/admin/users/[userId]');
  assert.equal(admin.data.policy, 'online-only');
  assert.equal(admin.ui.availability, 'local-module-registration', 'online private data does not erase the separate UI implementation requirement');
});

test('route resolution prevents secret, foreign and wrong-context public retention while keeping actual reader identities', async () => {
  const { getAppLocalRoutePolicy: policy, canRetainAppLocalRead: retain } = await load('lib/app-local-route-policy.ts');
  for (const href of ['https://foreign.test/help', '/no-such-page', '/more/no-such-section', '/help%2fprivate', '/help#token', '/explore/beauty/%E0%A4%A']) assert.equal(policy(href), null, href);
  for (const href of ['/market?payment=received', '/settings?section=login-security', '/activity?token=private', '/booking/manage/opaque']) assert.equal(retain(policy(href)), false, href);
  assert.equal(policy('/explore/beauty/profile?customerId=private').data.scope, 'viewer');
  assert.equal(policy('/explore/beauty/profile').data.scope, 'public');
  assert.deepEqual(policy('/more/saved-post?q=manicure').readResources, ['customer.saved-posts']);
  assert.deepEqual(policy('/more/following').readResources, ['customer.following']);
  assert.equal(policy('/staff/my-work').data.scope, 'staff-binding');
  assert.equal(policy('/staff/my-work').authority, 'server-validated-context-and-resource-ownership');
  assert.equal(policy('/help/owner-tips?lang=vi').rendererId, 'help.guide');
});

test('the complete public guide catalog and every actually rendered localized illustration can be bundled', async () => {
  const api = await load('lib/app-local-reference-content.ts');
  const { HELP_GUIDES } = await load('lib/help-guides.ts');
  assert.equal(api.APP_LOCAL_HELP_GUIDES.length, HELP_GUIDES.length);
  for (const original of HELP_GUIDES) for (const language of ['en', 'vi']) {
    const guide = api.getAppLocalHelpGuide(original.slug, language);
    assert.equal(guide.steps.length, original.steps.length);
    assert.equal(guide.sections.length, original.sections.length);
    assert.equal(guide.notes.length, original.notes.length);
    for (const [index, section] of guide.sections.entries()) {
      assert.equal(section.steps.length, original.sections[index].steps.length);
      assert.equal(section.issues.length, original.sections[index].issues.length);
      assert.ok(section.check && section.example);
    }
    for (const image of guide.evidence.screenshots) for (const mode of ['desktop', 'mobile']) assert.ok(api.APP_LOCAL_REFERENCE_ASSETS.includes(image[mode].src));
  }
  assert.ok(api.APP_LOCAL_REFERENCE_ASSETS.length >= 100);
  for (const asset of api.APP_LOCAL_REFERENCE_ASSETS) { assert.match(asset, /^\/help\/[\w/-]+\.(?:jpg|png|webp)$/); await access('public' + asset); }
  assert.equal(api.getAppLocalHelpGuide('not-a-guide'), null);
  assert.ok(api.APP_LOCAL_SUPPORT_INSTRUCTIONS.confirmation.includes('server'));
  assert.deepEqual(api.APP_LOCAL_REFERENCE_MODULES.settings.onlineOnlySections, ['login-security', 'delete-account', 'ownership', 'close-salon']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const bundle = await build({ entryPoints: ['lib/public-image-safety.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'server-only-test-boundary', setup(b) { b.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'empty' })); b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' })); } }] });
const compiled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, compiled, compiled.exports);
const { preparePublicPostImage, removeOwnStagedPostImage } = compiled.exports;
const actor = '11111111-1111-4111-8111-111111111111';
const path = `${actor}/beauty/image/22222222-2222-4222-8222-222222222222.webp`;
const source = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#93a3b1' } }).png().withMetadata().toBuffer();
const approved = { allowed: true, provider: 'isolated-test', model: 'fixture-only', policyVersion: 'fixture-v1' };

function fixture(overrides = {}) {
  const calls = [];
  const row = { bucket: 'beauty-profile-media', object_path: path, quarantine_path: `beauty-profile-media/${path}`, uploaded_by_user_id: actor,
    salon_id: null, purpose: 'image', status: 'staged', sha256: null, width: null, height: null, bytes: null, ...overrides };
  const read = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: row, error: null }; } };
  const client = { from() { return read; }, storage: { from(bucket) { return { async download(object) { calls.push(['download', bucket, object]); return { data: new Blob([source]), error: null }; } }; } } };
  const service = { storage: { from(bucket) { return {
    async upload(object, bytes, options) { calls.push(['upload', bucket, object, Buffer.from(bytes), options]); return { error: null }; },
    async remove(paths) { calls.push(['remove', bucket, paths]); return { error: null }; },
  }; } }, async rpc(name, args) { calls.push(['rpc', name, args]); return { data: { ...row, status: 'approved', sha256: args.p_sha256,
    width: args.p_width, height: args.p_height, bytes: args.p_bytes, object_id: actor }, error: null }; } };
  return { calls, row, client, service, input: { client, service, bucket: 'beauty-profile-media', path, userId: actor, purpose: 'image', salonId: null } };
}

test('missing verifier fails closed without reading or publishing private bytes', async () => {
  const f = fixture();
  await assert.rejects(preparePublicPostImage(f.input), { code: 'unavailable' });
  assert.deepEqual(f.calls, []);
});
for (const [name, override] of [
  ['another author', { uploaded_by_user_id: 'other' }], ['another salon', { salon_id: actor }],
  ['another purpose', { purpose: 'after' }], ['another private path', { quarantine_path: `payroll/${path}` }],
]) test(`${name} cannot reach privileged image promotion`, async () => {
  const f = fixture(override);
  await assert.rejects(preparePublicPostImage({ ...f.input, verify: async () => approved }), { code: 'invalid' });
  assert.deepEqual(f.calls, []);
});
test('rejected photo never reaches the public bucket', async () => {
  const f = fixture();
  await assert.rejects(preparePublicPostImage({ ...f.input, verify: async () => ({ ...approved, allowed: false }) }), { code: 'rejected' });
  assert.deepEqual(f.calls.map(c => c[0]), ['download']);
});
test('provider failures and malformed decisions never become approvals', async () => {
  for (const verify of [async () => { throw new Error('provider detail must not escape'); }, async () => ({ allowed: false }), async () => ({ ...approved, allowed: 'yes' })]) {
    const f = fixture();
    await assert.rejects(preparePublicPostImage({ ...f.input, verify }), e => e.code === 'unavailable' && !e.message.includes('provider detail'));
    assert.deepEqual(f.calls.map(c => c[0]), ['download']);
  }
});
test('the full normalized bytes checked are exactly the bytes publicly uploaded and hashed', async () => {
  const f = fixture(); let checked;
  const result = await preparePublicPostImage({ ...f.input, verify: async bytes => { checked = Buffer.from(bytes); return approved; } });
  const upload = f.calls.find(c => c[0] === 'upload');
  const finish = f.calls.find(c => c[0] === 'rpc');
  assert.deepEqual(upload[3], checked);
  assert.equal(upload[4].upsert, false);
  assert.equal(upload[4].metadata.sha256, createHash('sha256').update(checked).digest('hex'));
  assert.equal(finish[1], 'finish_public_post_image');
  assert.equal(finish[2].p_sha256, upload[4].metadata.sha256);
  assert.equal(finish[2].p_policy_version, approved.policyVersion);
  assert.equal(result.path, path);
  const info = await sharp(checked).metadata();
  assert.equal(info.format, 'webp'); assert.equal(info.exif, undefined); assert.equal(info.icc, undefined);
});
test('an upload duplicate is not enough to approve a different or unverified object', async () => {
  const f = fixture();
  f.service.storage.from = () => ({ upload: async () => ({ error: { message: 'The resource already exists' } }) });
  f.service.rpc = async () => ({ error: null, data: false });
  await assert.rejects(preparePublicPostImage({ ...f.input, verify: async () => approved }), { code: 'unavailable' });
});
test('approval persistence failure never reports a successful photo preparation', async () => {
  const f = fixture(); f.service.rpc = async () => ({ error: { message: 'database unavailable' }, data: null });
  await assert.rejects(preparePublicPostImage({ ...f.input, verify: async () => approved }), { code: 'unavailable' });
});
test('immutable approved bytes are reused without another external scan', async () => {
  const f = fixture({ status: 'approved', width: 12, height: 9, bytes: 100, sha256: 'a'.repeat(64) });
  const result = await preparePublicPostImage(f.input);
  assert.equal(result.width, 12); assert.deepEqual(f.calls, []);
});
test('cancelled reservation cannot be promoted', async () => {
  const f = fixture({ status: 'cancelled' });
  await assert.rejects(preparePublicPostImage({ ...f.input, verify: async () => approved }), { code: 'invalid' });
  assert.deepEqual(f.calls, []);
});
test('staging cleanup checks author before privileged deletion and cannot target a financial bucket', async () => {
  const f = fixture({ uploaded_by_user_id: 'other' });
  await assert.rejects(removeOwnStagedPostImage(f.client, { bucket: 'beauty-profile-media', path, userId: actor }), { code: 'invalid' });
  assert.deepEqual(f.calls, []);
});
test('explicit cleanup fences the staged reservation then removes only its private source', async () => {
  const f = fixture();
  f.service.rpc = async (name, args) => { f.calls.push(['rpc', name, args]); return { data: true, error: null }; };
  await removeOwnStagedPostImage(f.client, f.input, { service: f.service });
  assert.equal(f.calls[0][1], 'cancel_public_post_image');
  assert.deepEqual(f.calls[1], ['remove', 'public-image-quarantine', [`beauty-profile-media/${path}`]]);
});
test('clearing an approved draft never cancels or removes its public copy', async () => {
  const f = fixture({ status: 'approved' });
  await removeOwnStagedPostImage(f.client, f.input, { service: f.service });
  assert.deepEqual(f.calls, [['remove', 'public-image-quarantine', [`beauty-profile-media/${path}`]]]);
});
test('failed cancellation cannot delete bytes still being processed', async () => {
  const f = fixture(); f.service.rpc = async () => ({ data: false, error: null });
  await assert.rejects(removeOwnStagedPostImage(f.client, f.input, { service: f.service }), { code: 'unavailable' });
  assert.deepEqual(f.calls, []);
});

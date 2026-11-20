import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { build, transformSync } from 'esbuild';
import ts from 'typescript';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
async function moduleFromSource(file, define = {}) {
  const bundle = await build({ entryPoints: [file], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', define,
    plugins: [{ name: 'isolated-server-boundary', setup(api) {
      api.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'empty' }));
      api.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
    } }] });
  const result = { exports: {} };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(require, result, result.exports);
  return result.exports;
}
function actualFunction(file, name, dependencies) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const node = source.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, `Actual source function ${name} exists`);
  const body = node.getText(source).replace(/^export\s+/, '');
  return new Function(...Object.keys(dependencies), transformSync(body, { loader: 'ts', format: 'cjs' }).code + `\nreturn ${name};`)(...Object.values(dependencies));
}
const core = await moduleFromSource('lib/public-image-safety.ts');
const adapter = await moduleFromSource('lib/public-image-verifier-openai.ts', { 'process.env.OPENAI_API_KEY': 'undefined' });
const permission = await moduleFromSource('lib/public-photo-processing-consent.ts');
const beautyMedia = await moduleFromSource('lib/beauty-media.ts');
const salonMedia = await moduleFromSource('lib/salon-profile-media.ts');
const staging = await moduleFromSource('lib/public-image-staging.ts');
const user = '11111111-1111-4111-8111-111111111111', salon = '22222222-2222-4222-8222-222222222222';
const imageId = '33333333-3333-4333-8333-333333333333';
const consent = { provider: 'openai', noticeVersion: permission.PUBLIC_PHOTO_PROCESSING_NOTICE_VERSION, accepted: true };
const raw = await sharp({ create: { width: 12, height: 9, channels: 3, background: '#648d91' } }).png().withMetadata().toBuffer();
const imageCategories = ['sexual','self-harm','self-harm/intent','self-harm/instructions','violence','violence/graphic'];
const categories = [...imageCategories,'sexual/minors','harassment','harassment/threatening','hate','hate/threatening','illicit','illicit/violent'];
function response(flagged = false) {
  return new Response(JSON.stringify({ id: 'modr-fixture', model: adapter.OPENAI_PUBLIC_PHOTO_MODEL, results: [{ flagged,
    categories: Object.fromEntries(categories.map(key => [key, flagged && key === 'sexual'])),
    category_scores: Object.fromEntries(categories.map(key => [key, flagged ? 0.9 : 0.001])),
    category_applied_input_types: Object.fromEntries(categories.map(key => [key, imageCategories.includes(key) ? ['image'] : []])),
  }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
function fixture(kind = 'beauty', reply = () => response()) {
  const calls = [], path = kind === 'beauty' ? `${user}/beauty/image/${imageId}.webp` : `${salon}/looks/${imageId}/${imageId}.webp`;
  const bucket = kind === 'beauty' ? beautyMedia.BEAUTY_MEDIA_BUCKET : salonMedia.SALON_PROFILE_MEDIA_BUCKET;
  const row = { bucket, object_path: path, quarantine_path: `${bucket}/${path}`, uploaded_by_user_id: user,
    salon_id: kind === 'beauty' ? null : salon, purpose: kind === 'beauty' ? 'image' : 'look', status: 'staged' };
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: row, error: null }; } };
  const client = { from() { return query; }, storage: { from(value) { return {
    async download(object) { calls.push({ kind: 'private-read', bucket: value, path: object }); return { data: new Blob([raw]), error: null }; },
    async list() { calls.push({ kind: 'identity-read' }); return { error: { message: 'fixture identity branch' } }; },
  }; } } };
  const service = { storage: { from(value) { return {
    async upload(object, bytes) { calls.push({ kind: 'public-write', bucket: value, path: object, bytes: Buffer.from(bytes) }); return { error: null }; },
    async remove() { return { error: null }; },
  }; } }, async rpc(name, input) { calls.push({ kind: 'attestation', name, input }); return { data: { ...row, status: 'approved', object_id: imageId,
    sha256: input.p_sha256, width: input.p_width, height: input.p_height, bytes: input.p_bytes }, error: null }; } };
  const verifier = adapter.createOpenAIPublicPostVerifier({ apiKey: 'synthetic-fixture-key-never-live', fetchImpl: async (url, request) => {
    calls.push({ kind: 'provider', url, body: JSON.parse(request.body) }); return reply();
  } });
  const common = {
    preparePublicPostImage: input => { assert.equal(input.verify, verifier); return core.preparePublicPostImage({ ...input, service }); },
    verifyOpenAIPublicPostImage: verifier, withPublicPhotoProcessingConsent: permission.withPublicPhotoProcessingConsent,
    publicImageFinalPath: staging.publicImageFinalPath,
  };
  const beauty = actualFunction('lib/beauty.ts', 'assertTrustedBeautyMedia', { ...common, ...beautyMedia });
  const salonCall = actualFunction('lib/salon-profile.ts', 'assertTrustedSalonProfileMediaPath', {
    ...common, ...salonMedia, requireCurrentAccountAndSalon: () => ({ salon: { id: salon } }),
    createAuthenticatedSupabaseServerClient: async () => client,
    markSalonProfileMediaAssetActive: async () => { calls.push({ kind: 'asset-active' }); },
    getStorageParent: value => ({ folder: value.slice(0, value.lastIndexOf('/')), name: value.split('/').at(-1) }),
  });
  return { calls, path, bucket, client, beauty, salonCall,
    run: photoProcessingConsent => kind === 'beauty'
      ? beauty({ userId: user, supabase: client, media: { objectPath: path, role: 'image' }, photoProcessingConsent })
      : salonCall({ context: { user: { id: user } }, allowedKinds: ['look'], path, photoProcessingConsent }),
  };
}
for (const kind of ['beauty', 'salon']) {
  test(`${kind}: current affirmative permission reaches real normalization, adapter and exact-byte attestation`, async () => {
    const f = fixture(kind);
    await f.run(consent);
    assert.equal(f.calls.filter(call => call.kind === 'provider').length, 1);
    const provider = f.calls.find(call => call.kind === 'provider');
    const upload = f.calls.find(call => call.kind === 'public-write');
    assert.equal(provider.url, 'https://api.openai.com/v1/moderations');
    assert.deepEqual(Object.keys(provider.body).sort(), ['input','model']);
    assert.deepEqual(Buffer.from(provider.body.input[0].image_url.url.split(',')[1], 'base64'), upload.bytes);
    assert.equal((await sharp(upload.bytes).metadata()).exif, undefined);
    const finish = f.calls.find(call => call.kind === 'attestation');
    assert.equal(finish.input.p_provider, 'openai');
    assert.equal(finish.input.p_policy_version, adapter.OPENAI_PUBLIC_PHOTO_POLICY_VERSION);
  });
  test(`${kind}: missing, declined or stale permission stops before private read or provider`, async () => {
    for (const value of [undefined, { ...consent, accepted: false }, { ...consent, noticeVersion: 'old' }]) {
      const f = fixture(kind);
      await assert.rejects(f.run(value), /agree.*OpenAI/);
      assert.deepEqual(f.calls, []);
    }
  });
  test(`${kind}: explicit rejection and provider failure cannot publish`, async () => {
    for (const reply of [() => response(true), () => new Response('SYNTHETIC_PROVIDER_ERROR_MUST_NOT_ESCAPE', { status: 429 })]) {
      const f = fixture(kind, reply);
      await assert.rejects(f.run(consent), error => ['rejected','unavailable'].includes(error.code) && !error.message.includes('SYNTHETIC'));
      assert.equal(f.calls.some(call => ['public-write','attestation','asset-active'].includes(call.kind)), false);
    }
  });
}
test('Salon identity image branch does not request post-photo AI permission or call the adapter', async () => {
  const f = fixture('salon');
  await assert.rejects(f.salonCall({ context: { user: { id: user } }, allowedKinds: ['cover'], path: `${salon}/profile/cover/${imageId}.webp` }), /fixture identity branch|does not belong/);
  assert.equal(f.calls.some(call => call.kind === 'provider' || call.kind === 'private-read'), false);
});
test('completed Beauty request recovers before new consent, admission or image processing and preserves legacy intent', async () => {
  const input = { requestId: imageId, postType: 'regular', caption: 'Previously published', media: [{ objectPath: `${user}/beauty/image/${imageId}.webp`, role: 'image' }] };
  const calls = [], unavailable = () => { assert.fail('Completed request must not re-enter new processing'); };
  const run = actualFunction('lib/beauty.ts', 'createBeautyPost', {
    getAuthenticatedBeautyContext: async () => ({ user: { id: user }, supabase: { async rpc(name, args) { calls.push({ name, args }); return { data: { postId: imageId } }; } } }),
    cleanUuid: value => value || null, ...beautyMedia, publicImageFinalPath: staging.publicImageFinalPath,
    beautyPostCreationResult: value => ({ ok: true, data: value }), failure: unavailable,
    assertAbuseRequest: unavailable, runPublicImageUploadBatch: unavailable,
  });
  assert.equal((await run(input)).ok, true);
  assert.equal(calls[0].name, 'lookup_beauty_post_submission');
  assert.equal(Object.hasOwn(calls[0].args.p_input, 'photoProcessingConsent'), false);
});
test('completed Salon request recovers before new consent or any new publication call', async () => {
  const input = { requestId: imageId, caption: 'Previously published', imagePath: `${salon}/looks/${imageId}.webp` };
  const calls = [], unavailable = () => { assert.fail('Completed request must not publish or process again'); };
  const row = { id: imageId, salon_id: salon, author_user_id: user, status: 'published', safety_hold: false };
  const run = actualFunction('lib/salon-profile.ts', 'createCurrentSalonProfileSocialPost', {
    getCurrentBusinessContext: async () => ({ user: { id: user }, currentSalon: { id: salon } }),
    createAuthenticatedSupabaseServerClient: async () => ({ async rpc(name, args) { calls.push({ name, args }); return { data: { row, kind: 'look' } }; } }),
    mapPublicLook: value => value, extractHashtags: () => [], buildSalonProfileFeed: () => [row],
    createCurrentSalonProfileLook: unavailable, createCurrentSalonProfileUpdate: unavailable,
  });
  assert.equal((await run(input)).post.id, imageId);
  assert.equal(calls[0].name, 'lookup_salon_post_submission');
  assert.deepEqual(calls[0].args.p_request, input);
});
test('new Beauty request forwards the same explicit permission to verification and frozen request intent', async () => {
  const input = { requestId: imageId, postType: 'regular', caption: 'Chosen photo', photoProcessingConsent: consent,
    media: [{ objectPath: `${user}/beauty/image/${imageId}.webp`, role: 'image' }] };
  const calls = [], mediaInputs = [];
  const run = actualFunction('lib/beauty.ts', 'createBeautyPost', {
    getAuthenticatedBeautyContext: async () => ({ user: { id: user }, supabase: { async rpc(name, args) {
      calls.push({ name, args }); return { data: name === 'lookup_beauty_post_submission' ? null : { postId: imageId } };
    } } }),
    cleanUuid: value => value || null, ...beautyMedia, publicImageFinalPath: staging.publicImageFinalPath,
    beautyPostCreationResult: value => ({ ok: true, data: value }), failure: () => assert.fail('Unexpected admission failure'),
    assertAbuseRequest: async () => {}, runPublicImageUploadBatch: async ({ items, upload }) => Promise.all(items.map(upload)),
    assertTrustedBeautyMedia: async value => { mediaInputs.push(value); return value.media; },
  });
  assert.equal((await run(input)).ok, true);
  assert.equal(mediaInputs[0].photoProcessingConsent, consent);
  assert.equal(calls[1].name, 'create_beauty_post_once');
  assert.equal(calls[1].args.p_request_input.photoProcessingConsent, consent);
});
test('new Salon look/update requests retain permission in frozen intent and forward it to their exact media path', async () => {
  for (const contentType of ['look','update']) {
    const input = { requestId: imageId, caption: 'Chosen photo', imagePath: `${salon}/updates/${imageId}.webp`, contentType, photoProcessingConsent: consent };
    const calls = [], published = [];
    const forward = async value => { published.push(value); return { acceptedByFixture: true }; };
    const run = actualFunction('lib/salon-profile.ts', 'createCurrentSalonProfileSocialPost', {
      getCurrentBusinessContext: async () => ({ user: { id: user }, currentSalon: { id: salon } }),
      createAuthenticatedSupabaseServerClient: async () => ({ async rpc(name, args) { calls.push({ name, args }); return { data: null }; } }),
      optionalText: value => value?.trim() || null,
      createCurrentSalonProfileLook: forward, createCurrentSalonProfileUpdate: forward,
    });
    assert.equal((await run(input)).acceptedByFixture, true);
    assert.equal(published[0].photoProcessingConsent, consent);
    assert.deepEqual(published[0].submission.request.photoProcessingConsent, consent);
    assert.deepEqual(calls[0].args.p_request, input);
  }
});

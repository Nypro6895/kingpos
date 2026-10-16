import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { buildOfflineAssets } from '../scripts/build-offline-assets.mjs';

async function load(file, stubs = {}) {
  const output = await build({ entryPoints: [path.resolve(file)], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', plugins: [{ name: 'isolated-reads', setup(builder) {
      builder.onResolve({ filter: /^(?:@\/|next\/server$)/ }, args => {
        assert.ok(args.path in stubs, 'Unexpected read dependency ' + args.path);
        return { path: args.path, namespace: 'probe' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'probe' }, args => ({ contents: stubs[args.path], loader: 'js' }));
    } }] });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', output.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports;
}

test('owner refresh binds the request and response to the original owner, without retrying writes', async () => {
  const { fetchOwnerWorkspace } = await load('lib/owner-workspace-client.ts');
  const original = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return Response.json({ ownerScope: 'owner:salon:viewer', staff: [{ id: 'member' }] });
    };
    const result = await fetchOwnerWorkspace('owner:salon:viewer', 'staff', ['member']);
    assert.equal(result.staff[0].id, 'member');
    const request = new URL(calls[0].url, 'https://fixture.invalid');
    assert.equal(request.searchParams.get('ownerScope'), 'owner:salon:viewer');
    assert.equal(request.searchParams.get('ids'), 'member');
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.equal(calls[0].init.method, undefined);
    globalThis.fetch = async () => Response.json({ ownerScope: 'owner:salon:another-user', staff: [{ id: 'private-other-member' }] });
    await assert.rejects(fetchOwnerWorkspace('owner:salon:viewer', 'staff'), /different session/);
    globalThis.fetch = async () => new Response(null, { status: 409 });
    await assert.rejects(fetchOwnerWorkspace('owner:salon:viewer', 'catalog'), /could not be refreshed/);
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = original; }
});

test('owner read endpoint rejects another account before any catalog/desk query', async () => {
  const state = globalThis.ownerWorkspaceProbe = { context: { user: { id: 'viewer' }, currentSalon: { id: 'salon' }, manage: true }, reads: 0, auth: 0 };
  const stubs = {
    'next/server': 'export class NextResponse extends Response {static json(data,init){return Response.json(data,init)}}',
    '@/lib/current-context': 'export async function getCurrentBusinessContext(){globalThis.ownerWorkspaceProbe.auth++;return globalThis.ownerWorkspaceProbe.context}export function isSalonManageContext(c){return c.manage}',
    '@/lib/pos-desk': 'export async function getCurrentSalonPosDeskData(){globalThis.ownerWorkspaceProbe.reads++;throw Error("Unexpected complete desk read")}',
    '@/lib/pos-settings': 'export async function getCurrentSalonPosSettings(){throw Error("Unexpected settings read")}export function getPosDeskDefaults(){return {}}',
    '@/lib/supabase/server': 'export async function createAuthenticatedSupabaseServerClient(){globalThis.ownerWorkspaceProbe.reads++;const q={select(){return q},eq(){return q},order(){return Promise.resolve({data:[{id:"service"}],error:null})}};return{from(){return q}}}',
    '@/lib/pos-workspace-preferences': 'export function normalizeWorkspacePreferences(x){return x}',
    '@/lib/staff-profile': 'export function getStaffProfileAvatarUrl(){return null}',
  };
  const { GET } = await load('app/api/pos/owner/workspace/route.ts', stubs);
  try {
    let response = await GET(new Request('https://fixture.invalid/api/pos/owner/workspace?resource=catalog&ownerScope=owner:salon:other'));
    assert.equal(response.status, 409);
    assert.equal(state.reads, 0);
    response = await GET(new Request('https://fixture.invalid/api/pos/owner/workspace?resource=catalog&ownerScope=owner:salon:viewer'));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ownerScope: 'owner:salon:viewer', salonId: 'salon', services: [{ id: 'service' }] });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('vary'), 'Cookie');
    const authenticatedReads = state.auth;
    response = await GET(new Request('https://fixture.invalid/api/pos/owner/workspace?resource=catalog', { headers: { 'x-reylumi-auth-unavailable': '1' } }));
    assert.equal(response.status, 503);
    assert.equal(state.auth, authenticatedReads, 'temporary auth unavailability is not classified as logout');
    state.context = { user: null, currentSalon: null };
    response = await GET(new Request('https://fixture.invalid/api/pos/owner/workspace?resource=catalog'));
    assert.equal(response.status, 401);
    assert.equal(state.reads, 1);
  } finally { delete globalThis.ownerWorkspaceProbe; }
});

test('complete build manifest includes lazy code and fonts, changes with content and excludes source maps', async () => {
  const parent = path.resolve('artifacts/local-first-20261016');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'asset-contract-'));
  try {
    await mkdir(path.join(root, '.next/static/chunks'), { recursive: true });
    await mkdir(path.join(root, '.next/static/media'), { recursive: true });
    await writeFile(path.join(root, '.next/static/chunks/main.js'), 'main();');
    await writeFile(path.join(root, '.next/static/chunks/lazy.js'), 'openTicket();');
    await writeFile(path.join(root, '.next/static/chunks/app.css'), '@font-face{}');
    await writeFile(path.join(root, '.next/static/media/font.woff2'), Buffer.from([0, 1, 2, 3]));
    await writeFile(path.join(root, '.next/static/chunks/main.js.map'), 'privateSourceMap');
    const first = await buildOfflineAssets(root);
    const manifest = JSON.parse(await readFile(path.join(root, 'public/experience-build-assets.json'), 'utf8'));
    assert.equal(manifest.assets.length, 4);
    assert.ok(manifest.assets.includes('/_next/static/chunks/lazy.js'));
    assert.ok(manifest.assets.includes('/_next/static/media/font.woff2'));
    assert.ok(!manifest.assets.some(file => file.endsWith('.map')));
    assert.ok(manifest.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256)));
    await writeFile(path.join(root, '.next/static/chunks/lazy.js'), 'openNewTicket();');
    const next = await buildOfflineAssets(root);
    assert.notEqual(next.version, first.version);
    const deployed = await buildOfflineAssets(root, '.next', 'dpl_fixture-deployment-one');
    const deploymentManifest = JSON.parse(await readFile(path.join(root, 'public/experience-build-assets.json'), 'utf8'));
    assert.equal(deploymentManifest.deploymentId, 'dpl_fixture-deployment-one');
    const anotherDeployment = await buildOfflineAssets(root, '.next', 'dpl_fixture-deployment-two');
    assert.notEqual(deployed.version, anotherDeployment.version, 'the same static filenames cannot borrow another deployment authority');
    await assert.rejects(buildOfflineAssets(root, '.next', 'invalid deployment/identifier'), /Invalid static asset deployment/);
  } finally {
    assert.ok(path.resolve(root).startsWith(parent + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});

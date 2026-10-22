import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareBundle, verifyBundle } from './local-bundle-release.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const environment = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-fixture-key' };
const fixtureBuilder = `
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
if(process.env.FIXTURE_FAIL==='1')process.exit(9);
if(process.env.FIXTURE_CHANGE_SOURCE==='1')writeFileSync('app/entry.tsx','changed-during-build');
mkdirSync('ios/Reylumi/LocalAppBundle',{recursive:true});mkdirSync('ios/build',{recursive:true});
const body=readFileSync('app/entry.tsx');
writeFileSync('ios/Reylumi/LocalAppBundle/app.js',body);
const files=[{path:'app.js',bytes:body.length,sha256:hash(body),mime:'text/javascript'}];
writeFileSync('ios/Reylumi/LocalAppBundle/manifest.json',JSON.stringify({productionReady:process.argv.includes('--activate')&&process.env.FIXTURE_INACTIVE!=='1',buildId:hash(JSON.stringify(files)),files,coverage:{missing:[]}}));
writeFileSync('lib/app-local-commands-server.generated.ts','current command mapping');
writeFileSync('lib/app-local-command-trace-names.generated.json','[]');
writeFileSync('ios/build/called.json',JSON.stringify(process.argv.slice(2)));
`;

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reylumi-bundle-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => { const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value); };
  write('app/entry.tsx', 'current R10 source');
  write('scripts/build-app-local-bundle.mjs', fixtureBuilder);
  write('lib/app-local-commands-server.generated.ts', 'inherited mapping');
  write('lib/app-local-command-trace-names.generated.json', '[]');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root });
  execFileSync('git', ['add', 'app', 'scripts', 'lib'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Bundle QA', '-c', 'user.email=bundle-qa@invalid.local', 'commit', '-qm', 'fixture source'], { cwd: root });
  return { root, write, receipt: path.join(root, 'ios/build/local-bundle-provenance.json'), bundle: path.join(root, 'ios/Reylumi/LocalAppBundle') };
}

test('inherited self-consistent bundle cannot pass without an actual source-bound preparation', t => {
  const f = fixture(t);
  execFileSync(process.execPath, ['scripts/build-app-local-bundle.mjs', '--activate'], { cwd: f.root, env: environment });
  assert.throws(() => verifyBundle({ root: f.root }), /Missing source-bound bundle receipt/);
});

test('stale inherited assets are removed before a rebuilt bundle receives provenance', t => {
  const f = fixture(t);
  f.write('ios/Reylumi/LocalAppBundle/deleted-public-asset.svg', '<svg>obsolete</svg>');
  const result = prepareBundle({ root: f.root, env: environment });
  assert.equal(result.servicesCatalogPilot, false);
  assert.equal(existsSync(path.join(f.bundle, 'deleted-public-asset.svg')), false);
});

test('cleanup refuses a linked generated directory and preserves its target bytes', t => {
  const f = fixture(t), protectedDirectory = path.join(f.root, 'ios/build/protected');
  mkdirSync(protectedDirectory, { recursive: true });
  writeFileSync(path.join(protectedDirectory, 'keep.txt'), 'preserve this data');
  mkdirSync(path.dirname(f.bundle), { recursive: true });
  symlinkSync(protectedDirectory, f.bundle, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareBundle({ root: f.root, env: environment }), /Linked or unexpected generated bundle directory/);
  assert.equal(readFileSync(path.join(protectedDirectory, 'keep.txt'), 'utf8'), 'preserve this data');
  assert.equal(existsSync(f.receipt), false);
});

test('prepare runs the builder with activation only and verifies the exact emitted bytes and mappings', t => {
  const f = fixture(t), result = prepareBundle({ root: f.root, env: environment });
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.root, 'ios/build/called.json'))), ['--activate']);
  assert.equal(result.servicesCatalogPilot, false);
  assert.equal(result.sourceCommit.length, 40);
  assert.equal(result.bundleFiles, 2);
  assert.deepEqual(verifyBundle({ root: f.root }), result);
  const receipt = JSON.parse(readFileSync(f.receipt));
  assert.equal(receipt.generatedMappings.length, 2);
  assert.equal(receipt.publicConfiguration.NEXT_PUBLIC_SUPABASE_ANON_KEY.sha256, hash(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY));
  assert.ok(!readFileSync(f.receipt, 'utf8').includes(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY));
  assert.ok(receipt.source.files.every(row => !row.path.includes('/build/') && !row.path.includes('generated.')));
});

test('changed tracked source or a new untracked source blocks packaging even while old bundle integrity passes', t => {
  const f = fixture(t);
  prepareBundle({ root: f.root, env: environment });
  f.write('app/entry.tsx', 'new source not yet rebuilt');
  assert.throws(() => verifyBundle({ root: f.root }), /Stale bundle receipt/);
  f.write('app/entry.tsx', 'current R10 source');
  f.write('app/new-route.tsx', 'untracked source');
  assert.throws(() => verifyBundle({ root: f.root }), /Untracked release inputs/);
});

test('a different Git commit requires new preparation even when source bytes are unchanged', t => {
  const f = fixture(t);
  prepareBundle({ root: f.root, env: environment });
  execFileSync('git', ['-c', 'user.name=Bundle QA', '-c', 'user.email=bundle-qa@invalid.local', 'commit', '--allow-empty', '-qm', 'new exact release commit'], { cwd: f.root });
  assert.throws(() => verifyBundle({ root: f.root }), /Stale bundle receipt/);
});

test('changing generated mappings is rejected despite their exclusion from recursive source inputs', t => {
  const f = fixture(t);
  prepareBundle({ root: f.root, env: environment });
  f.write('lib/app-local-commands-server.generated.ts', 'stale server command mapping');
  assert.throws(() => verifyBundle({ root: f.root }), /Generated command mappings changed/);
});

test('self-consistent replacement bundle and unexpected extra resource cannot reuse a prepared receipt', t => {
  const f = fixture(t);
  prepareBundle({ root: f.root, env: environment });
  const manifestPath = path.join(f.bundle, 'manifest.json'), manifest = JSON.parse(readFileSync(manifestPath));
  const replacement = Buffer.from('stale inherited JS');
  writeFileSync(path.join(f.bundle, 'app.js'), replacement);
  manifest.files[0].bytes = replacement.length; manifest.files[0].sha256 = hash(replacement);
  manifest.buildId = hash(JSON.stringify(manifest.files));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.throws(() => verifyBundle({ root: f.root }), /Bundle differs from the source-bound/);
  prepareBundle({ root: f.root, env: environment });
  writeFileSync(path.join(f.bundle, 'extra.js'), 'unmanifested');
  assert.throws(() => verifyBundle({ root: f.root }), /Unmanifested package entry/);
});

test('archive/export copy must match receipt and checkout bundle exactly', t => {
  const f = fixture(t);
  prepareBundle({ root: f.root, env: environment });
  const copied = path.join(f.root, 'ios/build/export/Payload/Reylumi.app/LocalAppBundle');
  cpSync(f.bundle, copied, { recursive: true });
  assert.equal(verifyBundle({ root: f.root, bundleDirectory: copied }).servicesCatalogPilot, false);
  writeFileSync(path.join(copied, 'app.js'), 'changed exported bytes');
  assert.throws(() => verifyBundle({ root: f.root, bundleDirectory: copied }), /Bundled resource integrity mismatch/);
});

test('failed, unconfigured or inactive rebuild deletes prior receipt instead of silently retaining it', t => {
  const f = fixture(t);
  for (const env of [{ ...environment, FIXTURE_FAIL: '1' }, { ...environment, NEXT_PUBLIC_SUPABASE_URL: '' }, { ...environment, FIXTURE_INACTIVE: '1' }]) {
    prepareBundle({ root: f.root, env: environment });
    assert.throws(() => prepareBundle({ root: f.root, env }));
    assert.equal(existsSync(f.receipt), false);
    assert.throws(() => verifyBundle({ root: f.root }), /Missing source-bound bundle receipt/);
  }
});

test('source mutation during generation fails closed without writing a receipt', t => {
  const f = fixture(t);
  assert.throws(() => prepareBundle({ root: f.root, env: { ...environment, FIXTURE_CHANGE_SOURCE: '1' } }), /source changed during bundle generation/);
  assert.equal(existsSync(f.receipt), false);
});

test('generated Xcode projects and journals do not become recursive source inputs', t => {
  const f = fixture(t);
  prepareBundle({ root: f.root, env: environment });
  f.write('ios/Reylumi.xcodeproj/project.pbxproj', 'generated xcode project');
  f.write('releases/changes/new-event.json', '{}');
  assert.equal(verifyBundle({ root: f.root }).servicesCatalogPilot, false);
});

test('archive and IPA upload gates are placed before signing side effects and before upload', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const signing = readFileSync(path.join(root, 'ios/scripts/testflight.sh'), 'utf8');
  assert.ok(signing.indexOf('local-bundle-release.mjs verify') >= 0 && signing.indexOf('local-bundle-release.mjs verify') < signing.indexOf('SIGNING=$(mktemp'));
  assert.ok(signing.indexOf('local-bundle-release.mjs verify "$ROOT/build/Reylumi.xcarchive') > signing.indexOf('xcodebuild archive'));
  assert.ok(signing.indexOf('local-bundle-release.mjs verify "$SIGNING/export-check/Payload/') >= 0 && signing.indexOf('local-bundle-release.mjs verify "$SIGNING/export-check/Payload/') < signing.indexOf('altool --upload-app'));
  const check = readFileSync(path.join(root, 'ios/scripts/check-build.sh'), 'utf8');
  assert.ok(check.indexOf('local-bundle-release.mjs verify') >= 0 && check.indexOf('local-bundle-release.mjs verify') < check.indexOf('xcodebuild build-for-testing'));
});

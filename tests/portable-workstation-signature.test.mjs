import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { build } from 'esbuild';

// Bundle the actual client envelope gate/helper and maintained verifier. Only
// unrelated app transport dependencies are inert; no provider or fixture keys.
const compiled = await build({
  absWorkingDir: process.cwd(),
  stdin: { contents: 'export { verifyWorkstationEnvelope } from "./lib/portable-workstation-client";export { verifyPortableWorkstationSignature } from "./lib/portable-workstation-signature";export { workstationSignedBody } from "./lib/portable-workstation-protocol";', resolveDir: process.cwd() },
  bundle: true, write: false, platform: 'browser', target: 'safari16', format: 'iife', globalName: 'verifier',
  plugins: [{ name: 'inert-unrelated-transports', setup(b) {
    b.onResolve({ filter: /^@\/lib\/(?:app-local-host|supabase\/browser)$/ }, ({ path }) => ({ path, namespace: 'inert' }));
    b.onLoad({ filter: /.*/, namespace: 'inert' }, ({ path }) => ({ contents: path.endsWith('app-local-host')
      ? 'export function getAppLocalHost(){throw Error("Transport must not run")};export function appLocalRequestId(){throw Error("Transport must not run")}'
      : 'export function createSupabaseBrowserClient(){throw Error("Transport must not run")}' }));
  } }],
});
function runtime(crypto = webcrypto) {
  const context = vm.createContext({ crypto, TextEncoder, atob, Uint8Array, ArrayBuffer, DataView, DOMException, console });
  vm.runInContext(compiled.outputFiles[0].text, context);
  return context.verifier;
}
function unsupportedRuntime() {
  let imports = 0;
  const api = runtime({ subtle: { async importKey() { imports++; throw new DOMException('Algorithm is unavailable', 'NotSupportedError'); }, async verify() { throw Error('Unexpected native verify'); } } });
  return { api, imports: () => imports };
}
const keys = generateKeyPairSync('ed25519');
const otherKeys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const now = 1_800_000_000_000;
function signedEnvelope(api, overrides = {}) {
  const envelope = { version: 1, workstationId: 'station-fixture', generation: 3, sequence: 9, kind: 'preview', messageId: 'message-fixture', issuedAt: now, expiresAt: now + 60_000, payload: { cartId: 'cart-fixture', revision: 'revision-fixture', payload: { total: 35, tip: 5 } }, ...overrides };
  return { ...envelope, signature: sign(null, Buffer.from(api.workstationSignedBody(envelope)), keys.privateKey).toString('base64') };
}
function descriptor(key = publicKey) { return { id: 'station-fixture', generation: 3, verificationKey: key }; }

test('native WebCrypto verifies genuine server signatures and reuses its imported key', async () => {
  let imports = 0, verifications = 0;
  const api = runtime({ subtle: {
    importKey(...args) { imports++; return webcrypto.subtle.importKey(...args); },
    verify(...args) { verifications++; return webcrypto.subtle.verify(...args); },
  } });
  const envelope = signedEnvelope(api);
  assert.equal(await api.verifyWorkstationEnvelope(envelope, descriptor(), now), true);
  assert.equal(await api.verifyWorkstationEnvelope(envelope, descriptor(), now), true);
  assert.equal(imports, 1);
  assert.equal(verifications, 2);
});

test('a Safari-style unsupported native algorithm uses real strict verification', async () => {
  const f = unsupportedRuntime(), envelope = signedEnvelope(f.api);
  assert.equal(await f.api.verifyWorkstationEnvelope(envelope, descriptor(), now), true);
  assert.equal(await f.api.verifyWorkstationEnvelope(signedEnvelope(f.api, { sequence: 10 }), descriptor(), now), true);
  assert.equal(f.imports(), 1, 'unsupported native algorithm is not retried on every frame');
  assert.equal(await f.api.verifyWorkstationEnvelope({ ...envelope, payload: { ...envelope.payload, payload: { total: 3500, tip: 5 } } }, descriptor(), now), false);
  const badSignature = Buffer.from(envelope.signature, 'base64'); badSignature[20] ^= 1;
  assert.equal(await f.api.verifyWorkstationEnvelope({ ...envelope, signature: badSignature.toString('base64') }, descriptor(), now), false);
  assert.equal(await f.api.verifyWorkstationEnvelope(envelope, descriptor(otherKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')), now), false);
});

test('fallback preserves workstation, generation, sequence and expiry envelope gates', async () => {
  const { api } = unsupportedRuntime();
  for (const override of [
    { workstationId: 'different-station' }, { generation: 4 }, { version: 2 },
    { sequence: -1 }, { sequence: 1.5 }, { issuedAt: now + 30_001 },
    { expiresAt: now - 1 }, { expiresAt: now + 86_400_001 },
    { kind: 'intent', expiresAt: now + 300_001 }, { messageId: 7 },
  ]) assert.equal(await api.verifyWorkstationEnvelope(signedEnvelope(api, override), descriptor(), now), false, JSON.stringify(override));
  assert.equal(await api.verifyWorkstationEnvelope(signedEnvelope(api), descriptor(), now), true);
});

test('malformed SPKI cannot be reinterpreted as an Ed25519 raw key by fallback', async () => {
  const f = unsupportedRuntime(), envelope = signedEnvelope(f.api), der = Buffer.from(publicKey, 'base64');
  const wrongOid = Buffer.from(der); wrongOid[8] = 0x6e;
  const badUnusedBits = Buffer.from(der); badUnusedBits[11] = 1;
  const nullParameters = Buffer.concat([Buffer.from('302c300706032b65700500032100', 'hex'), der.subarray(12)]);
  for (const malformed of [wrongOid, badUnusedBits, nullParameters, der.subarray(0, 43), Buffer.concat([der, Buffer.from([0])]), der.subarray(12)]) {
    assert.equal(await f.api.verifyWorkstationEnvelope(envelope, descriptor(malformed.toString('base64')), now), false);
  }
  assert.equal(await f.api.verifyWorkstationEnvelope(envelope, descriptor('%%%'), now), false);
  assert.equal(f.imports(), 0, 'invalid DER is rejected before selecting an implementation');
});

test('truncated, oversized and malformed signature encodings fail closed', async () => {
  const f = unsupportedRuntime(), envelope = signedEnvelope(f.api);
  for (const signature of ['', '%%%', 'A'.repeat(89), Buffer.alloc(63).toString('base64'), Buffer.alloc(65).toString('base64')]) {
    assert.equal(await f.api.verifyWorkstationEnvelope({ ...envelope, signature }, descriptor(), now), false);
  }
  assert.equal(f.imports(), 0);
});

test('unexpected native errors and a negative native result are never retried in fallback', async () => {
  for (const mode of ['DataError', 'OperationError', 'false']) {
    const api = runtime({ subtle: {
      importKey(...args) { return webcrypto.subtle.importKey(...args); },
      async verify() { if (mode === 'false') return false; throw new DOMException('Simulated native failure', mode); },
    } });
    assert.equal(await api.verifyWorkstationEnvelope(signedEnvelope(api), descriptor(), now), false, mode);
  }
  const noCrypto = runtime({});
  assert.equal(await noCrypto.verifyWorkstationEnvelope(signedEnvelope(noCrypto), descriptor(), now), false);
});

test('native verify NotSupportedError falls back after a successful import', async () => {
  const api = runtime({ subtle: {
    importKey(...args) { return webcrypto.subtle.importKey(...args); },
    async verify() { throw new DOMException('Algorithm is unavailable', 'NotSupportedError'); },
  } });
  assert.equal(await api.verifyWorkstationEnvelope(signedEnvelope(api), descriptor(), now), true);
});

test('strict fallback rejects the small-order signature accepted by permissive ZIP215', async () => {
  const { api } = unsupportedRuntime();
  const identity = Buffer.alloc(32); identity[0] = 1;
  const key = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), identity]).toString('base64');
  const signature = Buffer.concat([identity, Buffer.alloc(32)]).toString('base64');
  assert.equal(await api.verifyPortableWorkstationSignature(key, signature, 'not signed by the server'), false);
});

test('the published notices retain both installed complete MIT license texts', () => {
  const html = fs.readFileSync('public/third-party-noble-notices.html', 'utf8');
  const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  for (const name of ['curves', 'hashes']) {
    const license = fs.readFileSync(`node_modules/@noble/${name}/LICENSE`, 'utf8');
    assert.ok(html.includes(escape(license)), name + ' full installed license');
  }
});

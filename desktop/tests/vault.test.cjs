const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, sep } = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Vault } = require('../vault.cjs');
const { validConfig, allowedPage } = require('../policy.cjs');
const codec = { encryptString: v => Buffer.from(v), decryptString: b => b.toString() };
function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), 'kingpos-vault-'));
  try { run(dir); } finally { if (!resolve(dir).startsWith(resolve(tmpdir()) + sep + 'kingpos-vault-')) throw Error('Unexpected directory'); rmSync(dir, { recursive: true, force: true }); }
}
function operation() { return { id: randomUUID(), scope: 'salon:key', kind: 'receipt', occurredAt: new Date().toISOString(), payload: { localDraftKey: 'draft', lines: [{ total: 125 }] }, state: 'pending' }; }
test('cancel rejected ticket survives restart, preserves audit and checkpoint, never cancels pending or uploaded work', () => fixture(dir => {
  let v = new Vault(dir, codec); const rejected = operation(), unrelated = operation();
  v.save(rejected); v.save(unrelated);
  assert.throws(() => v.save({...rejected, state:'cancelled'}), /rejected/);
  const failure = {...rejected, state:'attention', error:'Assigned staff must be checked in and working.'};
  v.save(failure); v.save({...failure,state:'cancelled',cancelledAt:new Date().toISOString()});
  assert.equal(v.pending(),1); v.close(); v = new Vault(dir,codec);
  assert.equal(v.list(rejected.scope)[0].state,'cancelled');
  assert.deepEqual(v.list(rejected.scope)[0].payload,rejected.payload);
  assert.ok(v.checkpoint(rejected.scope,'draft'));
  assert.throws(()=>v.save(rejected),/reset/);
  v.save({...unrelated,state:'synced'});
  assert.throws(()=>v.save({...unrelated,state:'cancelled'}),/reset/);
  assert.equal(v.pending(),0);v.close();
}));
test('receipt and checkpoint survive process termination without close; retry identity survives reopen', () => fixture(dir => {
  const op = operation();
  const child = spawnSync(process.execPath, ['-e', `const {Vault}=require(${JSON.stringify(resolve(__dirname, '../vault.cjs'))});const v=new Vault(${JSON.stringify(dir)},{encryptString:x=>Buffer.from(x),decryptString:x=>x.toString()});v.save(${JSON.stringify(op)});process.exit(0);`]);
  assert.equal(child.status, 0, child.stderr.toString());
  const v = new Vault(dir, codec);
  assert.equal(v.list(op.scope)[0].id, op.id);
  assert.ok(v.checkpoint(op.scope, 'draft') > 0);
  v.save(op); assert.equal(v.list(op.scope).length, 1);
  assert.throws(() => v.save({ ...op, payload: { total: 999 } }), /replaced/);
  v.save({ ...op, state: 'synced', result: { ticketId: 'server-id' } });
  assert.equal(v.pending(), 0);
  assert.throws(() => v.save(op), /reset/);
  assert.equal(v.list('other:key').length, 0); v.close();
}));
test('saved and active tickets survive close/reopen and data stays separated by POS key', () => fixture(dir => {
  let v = new Vault(dir, codec);
  const draft = 'kingpos:portable-draft:v1:salon:key:desktop', parked = 'kingpos:parked-tickets:v1:salon:key';
  v.set(draft, '{"amount":125}'); v.set(parked, '[{"amount":50}]'); v.close();
  v = new Vault(dir, codec);
  assert.equal(v.get(draft), '{"amount":125}'); assert.equal(v.get(parked), '[{"amount":50}]');
  assert.equal(v.get(parked + 'other'), null);
  assert.throws(() => v.set('../../file', 'x'), /Invalid/);
  v.remove(draft); assert.equal(v.get(draft), null); assert.ok(v.get(parked)); v.close();
}));
test('storage faults never acknowledge a saved ticket', () => fixture(dir => {
  const v = new Vault(dir, { ...codec, encryptString() { throw Error('disk encryption unavailable'); } });
  assert.throws(() => v.save(operation()), /unavailable/);
  assert.equal(v.list('salon:key').length, 0); v.close();
}));
test('production origin and navigation are constrained to Portable', () => {
  assert.throws(() => validConfig({ origin: 'http://example.com', channel: 'release' }));
  assert.throws(() => validConfig({ origin: 'https://user:secret@example.com', channel: 'release' }));
  assert.equal(validConfig({ origin: 'http://localhost:3107', channel: 'test' }).origin, 'http://localhost:3107');
  for (const path of ['/pos', '/pos/portable-evil', '/owner']) assert.equal(allowedPage('https://example.com' + path, 'https://example.com'), false);
  assert.equal(allowedPage('https://evil.com/pos/portable', 'https://example.com'), false);
  assert.equal(allowedPage('https://example.com/pos/portable/check-in', 'https://example.com'), true);
});
test('updates never auto-install on exit, require signed production and preserve app data', () => {
  const main = readFileSync(join(__dirname,'../main.cjs'),'utf8'), build = readFileSync(join(__dirname,'../build.cjs'),'utf8');
  assert.match(main, /autoInstallOnAppQuit = false/); assert.match(main,/vault.pending\(\)/);
  assert.match(build, /forceCodeSigning: release/); assert.match(build,/deleteAppDataOnUninstall: false/);
});
test('pre-update backup is a consistent recoverable SQLite snapshot', async () => {
  const { readdirSync } = require('node:fs');
  const { DatabaseSync } = require('node:sqlite');
  const dir=mkdtempSync(join(tmpdir(),'kingpos-vault-'));
  const v=new Vault(dir,codec);
  try {
    const op=operation();v.save(op);await v.backup();
    const files=readdirSync(join(dir,'backups'));assert.equal(files.length,1);
    const snapshot=new DatabaseSync(join(dir,'backups',files[0]),{readOnly:true});
    assert.equal(snapshot.prepare('SELECT id FROM operations').get().id,op.id);
    assert.ok(snapshot.prepare('SELECT checkpoint FROM operations').get().checkpoint>0);snapshot.close();
  } finally {v.close();if(!resolve(dir).startsWith(resolve(tmpdir())+sep+'kingpos-vault-'))throw Error('Unexpected directory');rmSync(dir,{recursive:true,force:true});}
});

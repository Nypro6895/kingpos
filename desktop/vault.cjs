'use strict';
const { DatabaseSync, backup } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { validateKey } = require('./policy.cjs');
// Only this process owns the database. No plaintext passcodes, payment-card
// data or arbitrary paths are exposed through IPC. Values use Windows DPAPI.
class Vault {
  constructor(directory, codec) {
    mkdirSync(directory, { recursive: true });
    this.directory = directory;
    this.codec = codec;
    this.db = new DatabaseSync(join(directory, 'tickets.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw Error('A newer KingPOS version is required to read these tickets');
    this.db.exec(`CREATE TABLE IF NOT EXISTS operations (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL, state TEXT NOT NULL, body BLOB NOT NULL,
      draft_key TEXT, checkpoint INTEGER);
      CREATE INDEX IF NOT EXISTS operation_scope ON operations(scope, sequence);
      CREATE TABLE IF NOT EXISTS saved (key TEXT PRIMARY KEY, body BLOB NOT NULL);
      PRAGMA user_version=1;`);
  }
  encode(value) { return this.codec.encryptString(JSON.stringify(value)); }
  decode(value) { return JSON.parse(this.codec.decryptString(Buffer.from(value))); }
  list(scope) { this.scope(scope); return this.db.prepare('SELECT sequence, body FROM operations WHERE scope=? ORDER BY sequence').all(scope).map(row => ({ ...this.decode(row.body), sequence: row.sequence })); }
  scope(value) { if (typeof value !== 'string' || !value || value.length > 512) throw Error('Invalid POS identity'); }
  checkpoint(scope, key) { this.scope(scope); return this.db.prepare('SELECT MAX(checkpoint) AS value FROM operations WHERE scope=? AND draft_key=?').get(scope, key).value ?? 0; }
  save(op) {
    this.scope(op?.scope);
    if (!/^[a-f0-9-]{36}$/i.test(op.id) || !['receipt','attendance','booking','visit'].includes(op.kind) ||
        !['pending','attention','synced','cancelled'].includes(op.state) || !Number.isFinite(Date.parse(op.occurredAt)) ||
        !op.payload || typeof op.payload !== 'object' || JSON.stringify(op).length > 2_000_000) throw Error('Invalid ticket');
    const previous = this.db.prepare('SELECT body FROM operations WHERE id=?').get(op.id);
    if (previous) {
      const old = this.decode(previous.body);
      if (old.scope !== op.scope || old.kind !== op.kind || old.occurredAt !== op.occurredAt || JSON.stringify(old.payload) !== JSON.stringify(op.payload)) throw Error('A saved ticket cannot be replaced');
      if (old.state === 'synced' && op.state !== 'synced') throw Error('A completed upload cannot be reset');
      if (old.state === 'cancelled' && op.state !== 'cancelled') throw Error('A cancelled ticket cannot be reset');
      if (op.state === 'cancelled' && old.state !== 'cancelled' &&
          (old.state !== 'attention' || !(old.kind==='receipt' && old.error==='Assigned staff must be checked in and working.' || old.rejected===true && /^(This customer visit already has a ticket\.|This customer visit is no longer available\.|This staff member changed on another device\.)/.test(old.error||'')))) throw Error('Only a rejected item can be cancelled');
      this.db.prepare('UPDATE operations SET state=?, body=? WHERE id=?').run(op.state, this.encode(op), op.id);
    } else {
      if (op.state !== 'pending') throw Error('New tickets must be pending');
      const key = op.kind === 'receipt' && typeof op.payload.localDraftKey === 'string' ? op.payload.localDraftKey : null;
      // The receipt and its anti-resurrection checkpoint share one FULL-sync commit.
      this.db.prepare('INSERT INTO operations(id,scope,state,body,draft_key,checkpoint) VALUES(?,?,?,?,?,?)')
        .run(op.id, op.scope, op.state, this.encode(op), key, key ? Date.now() : null);
    }
  }
  get(key) { validateKey(key); const row = this.db.prepare('SELECT body FROM saved WHERE key=?').get(key); return row ? this.decode(row.body) : null; }
  set(key, value) {
    validateKey(key);
    if (typeof value !== 'string' || value.length > 4_000_000) throw Error('Unable to save this ticket');
    this.db.prepare('INSERT INTO saved(key,body) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key, this.encode(value));
  }
  remove(key) { validateKey(key); this.db.prepare('DELETE FROM saved WHERE key=?').run(key); }
  pending() { return this.db.prepare("SELECT COUNT(*) AS count FROM operations WHERE state NOT IN ('synced','cancelled')").get().count; }
  async backup() {
    const directory = join(this.directory, 'backups');
    mkdirSync(directory, { recursive: true });
    await backup(this.db, join(directory, `before-update-${Date.now()}.sqlite`));
  }
  close() { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); this.db.close(); }
}
module.exports = { Vault };

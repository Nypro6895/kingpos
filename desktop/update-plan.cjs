'use strict';
const { readFileSync, writeFileSync, renameSync } = require('node:fs');
class UpdatePlan {
  constructor(file, now = Date.now) {
    this.file = file; this.now = now; this.value = null;
    try { const value = JSON.parse(readFileSync(file, 'utf8')); if (Number.isFinite(value?.at) && typeof value.version === 'string') this.value = value; } catch {}
  }
  set(version, at) {
    if (at !== null && (!Number.isFinite(at) || at <= this.now() || at > this.now() + 366 * 86400000)) throw Error('Choose a future date and time.');
    const value = at === null ? null : { version, at };
    writeFileSync(this.file + '.tmp', JSON.stringify(value)); renameSync(this.file + '.tmp', this.file); this.value = value;
  }
  due(version) { return this.value?.version === version && this.value.at <= this.now(); }
}
module.exports = { UpdatePlan };

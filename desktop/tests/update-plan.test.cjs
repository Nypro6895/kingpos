const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { UpdatePlan } = require('../update-plan.cjs');
test('update appointment survives restart, binds to a version, and Later cancels it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kingpos-update-plan-'));
  try {
    const file = join(dir, 'plan.json'); let now = 1000;
    const plan = new UpdatePlan(file, () => now);
    assert.throws(() => plan.set('0.3.0', 999));
    plan.set('0.3.0', 2000); assert.equal(plan.due('0.3.0'), false);
    now = 3000;
    const reopened = new UpdatePlan(file, () => now);
    assert.equal(reopened.due('0.3.0'), true);
    assert.equal(reopened.due('0.4.0'), false);
    reopened.set('', null);
    assert.equal(new UpdatePlan(file, () => now).due('0.3.0'), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

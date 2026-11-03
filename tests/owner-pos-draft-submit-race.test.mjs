import test from 'node:test';
import assert from 'node:assert/strict';
import { createPosDraftSubmitHarness } from './helpers/owner-pos-draft-submit-harness.mjs';

for (const branch of ['queue', 'reward', 'gift']) {
  test(`${branch}: pending Submit preserves both drafts and rejects takeover/parking and duplicate Submit`, async () => {
    const h = createPosDraftSubmitHarness({ branch });
    h.submit(); await h.flush();
    assert.equal(h.attempts.length, 1);
    assert.equal(h.snapshot().busy, true);
    assert.deepEqual(h.controls(), { savedDisabled: true, parkDisabled: true, takeoverDisabled: false });
    h.submit({ force: true });
    assert.equal(h.restoreDirect(), false, 'the actual parent callback also guards a stale event before disabled UI commits');
    h.park({ force: true }); await h.flush();
    assert.equal(h.openSaved(), false);
    assert.equal(h.attempts.length, 1, 'a second Submit must not enqueue or send a duplicate mutation');
    assert.equal(h.snapshot().activeCart.id, h.cartA.id);
    assert.equal(h.snapshot().savedTickets.length, 1);
    assert.equal(h.snapshot().savedTickets[0].value.id, h.cartB.id);
    h.releaseSuccess(); await h.flush();
    assert.equal(h.snapshot().busy, false);
    assert.equal(h.snapshot().activeCart.amount, '');
    assert.notEqual(h.snapshot().activeCart.id, h.cartA.id);
    assert.equal(h.snapshot().savedTickets[0].value.id, h.cartB.id);
    assert.equal(h.queued.length, branch === 'queue' ? 1 : 0);
    assert.equal(h.actions.length, branch === 'reward' ? 1 : 0);
    assert.equal(h.takeoverSaved(), true, 'Saved tickets still opens normally after Submit settles');
    assert.equal(h.snapshot().activeCart.id, h.cartB.id);
    assert.equal(h.snapshot().savedTickets.length, 0);
  });

  test(`${branch}: an already-open saved-ticket confirmation cannot replace a pending cart`, async () => {
    const h = createPosDraftSubmitHarness({ branch });
    assert.equal(h.openSaved(), true); assert.equal(h.selectSaved(), true);
    const earlierTakeover = h.captureTakeoverHandler();
    // A controlled invocation exercises a previously rendered handler; a real
    // modal normally prevents tapping the underlying Submit button.
    h.submit({ force: true }); await h.flush();
    assert.equal(h.controls().takeoverDisabled, true);
    assert.equal(h.confirmTakeover({ force: true }), true);
    assert.equal(h.snapshot().activeCart.id, h.cartA.id);
    assert.equal(h.snapshot().savedTickets[0].value.id, h.cartB.id);
    earlierTakeover();
    assert.equal(h.snapshot().draftsError, 'Unable to open this ticket. Both tickets have been kept.', 'an earlier handler must honor the parent restore refusal before removing saved B');
    assert.equal(h.snapshot().activeCart.id, h.cartA.id);
    assert.equal(h.snapshot().savedTickets[0].value.id, h.cartB.id);
    h.releaseSuccess(); await h.flush();
    assert.equal(h.snapshot().savedTickets.length, 1);
  });

  test(`${branch}: a late successful reply only clears its submitted cart identity`, async () => {
    const h = createPosDraftSubmitHarness({ branch });
    h.submit(); await h.flush();
    h.injectDifferentCurrentCart();
    h.releaseSuccess(); await h.flush();
    assert.equal(h.snapshot().activeCart.id, h.cartB.id, 'a late reply must not clear a different current cart');
    assert.equal(h.snapshot().activeCart.amount, h.cartB.amount);
    assert.equal(h.snapshot().busy, false);
    assert.equal(h.queued.length, branch === 'queue' ? 1 : 0);
  });

  test(`${branch}: failure retains the pending cart and unlocks saved-ticket takeover`, async () => {
    const h = createPosDraftSubmitHarness({ branch });
    h.submit(); await h.flush(); h.releaseFailure(); await h.flush();
    assert.equal(h.snapshot().activeCart.id, h.cartA.id);
    assert.equal(h.snapshot().busy, false);
    assert.equal(h.snapshot().error, 'Fixture submission failed');
    assert.equal(h.queued.length, 0);
    assert.equal(h.takeoverSaved(), true);
    assert.equal(h.snapshot().activeCart.id, h.cartB.id);
    assert.equal(h.snapshot().savedTickets.length, 0);
  });
}

test('queue: an existing durable operation is not written a second time', async () => {
  const h = createPosDraftSubmitHarness({ existingOperation: true });
  h.submit(); await h.flush(); h.submit({ force: true });
  h.releaseSuccess(); await h.flush();
  assert.equal(h.attempts.length, 1);
  assert.equal(h.queued.length, 1);
  assert.equal(h.queued[0].payload.ownerCartId, h.cartA.id);
  assert.equal(h.snapshot().activeCart.amount, '');
  assert.equal(h.snapshot().savedTickets[0].value.id, h.cartB.id);
});

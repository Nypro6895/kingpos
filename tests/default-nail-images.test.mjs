import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DEFAULT_NAIL_IMAGES, resolveNailCoverImage } from '../lib/default-nail-images.ts';

test('actual salon photos take priority, including non-nail salons', () => {
  assert.equal(resolveNailCoverImage({ id: 'salon-1', categories: ['Nails'], coverImageUrl: '/real.webp' }), '/real.webp');
  assert.equal(resolveNailCoverImage({ id: 'salon-2', categories: ['Hair'], coverImageUrl: '/hair.webp' }), '/hair.webp');
});
test('nail defaults are stable, diverse, and do not appear on hair or massage profiles', () => {
  assert.equal(resolveNailCoverImage({ id: 'salon-1', categories: ['Nails'] }), resolveNailCoverImage({ id: 'salon-1', categories: ['Nails'] }));
  assert.equal(resolveNailCoverImage({ id: 'salon-2', name: 'Hair Studio', categories: ['Hair'] }), null);
  assert.equal(resolveNailCoverImage({ id: 'salon-3', categories: ['Massage'] }), null);
  const choices = new Set(Array.from({ length: 606 }, (_, i) => resolveNailCoverImage({ id: `salon-${i}`, categories: ['Nails'] })));
  assert.equal(choices.size, 20);
  for (const path of DEFAULT_NAIL_IMAGES) assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)), path);
});

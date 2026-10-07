import test from 'node:test';
import assert from 'node:assert/strict';
import { claimedSalonContent, visibleSalonPosts, salonAboutParagraphs } from '../lib/salon-profile-content.ts';

test('claim hides only the platform reference, preserving owner posts and unclaimed references', () => {
  const posts = [{ id: 'reference' }, { id: 'owner' }];
  assert.deepEqual(visibleSalonPosts(posts, { claimState: 'claimed', referencePostId: 'reference' }), [{ id: 'owner' }]);
  assert.deepEqual(visibleSalonPosts(posts, { claimState: 'unclaimed', referencePostId: 'reference' }), posts);
  assert.deepEqual(visibleSalonPosts(posts, null), posts);
});
test('saved description and story are both visible, with description first and no duplicate paragraphs', () => {
  assert.deepEqual(salonAboutParagraphs({ description: 'Owner About', story: 'Owner story' }), ['Owner About', 'Owner story']);
  assert.deepEqual(salonAboutParagraphs({ description: ' Same ', story: 'Same' }), ['Same']);
  assert.deepEqual(salonAboutParagraphs({ description: '', story: 'Story only' }), ['Story only']);
  assert.deepEqual(salonAboutParagraphs({}), []);
});

test('claimed profiles suppress exact imported text without replacing owner edits', () => {
  const seed = { name: 'Salon', city: 'Milwaukee', description: 'Salon · Nails in Milwaukee, Wisconsin. Public listing created by Reylumi; not yet claimed by the business owner.', story: 'Reference caption' };
  const listing = { claimState: 'claimed', categories: ['Nails'] };
  assert.equal(claimedSalonContent(seed, listing, 'Reference caption').story, null);
  assert.equal(claimedSalonContent(seed, listing, 'Reference caption').description, null);
  const edited = { ...seed, description: 'My About', story: 'My story' };
  assert.deepEqual(claimedSalonContent(edited, listing, 'Reference caption'), edited);
  assert.deepEqual(claimedSalonContent(seed, { ...listing, claimState: 'unclaimed' }, 'Reference caption'), seed);
});

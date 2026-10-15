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

test('Illinois claim removes its imported About and preserves owner changes', () => {
  const seed = { name: 'Chicago Salon', city: 'Chicago', state: 'IL', description: 'Chicago Salon · Hair in Chicago, Illinois. Public listing created by Reylumi; not yet claimed by the business owner.', story: 'Reference' };
  const listing = { claimState: 'claimed', categories: ['Hair'] };
  assert.equal(claimedSalonContent(seed, listing, 'Reference').description, null);
  const edited = { ...seed, description: 'Owner introduction' };
  assert.equal(claimedSalonContent(edited, listing, 'Reference').description, 'Owner introduction');
});

test('Oregon and Washington claims remove only their exact platform introduction', () => {
  for (const [state,stateName,city] of [['OR','Oregon','Portland'],['WA','Washington','Seattle'],['FL','Florida','Miami']]) {
    const seed={name:'Salon',city,state,description:`Salon · Nails in ${city}, ${stateName}. Public listing created by Reylumi; not yet claimed by the business owner.`,story:'Reference'};
    const listing={claimState:'claimed',categories:['Nails']};
    assert.equal(claimedSalonContent(seed,listing,'Reference').description,null);
    const edited={...seed,description:'Saved owner About',story:'Saved owner story'};
    assert.deepEqual(claimedSalonContent(edited,listing,'Reference'),edited);
  }
});

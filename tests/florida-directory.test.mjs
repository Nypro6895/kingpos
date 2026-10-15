import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { parseLookup, parseStructured } from '../scripts/collect-wisconsin-beauty.mjs';
import { resolveBusinessCoverImage } from '../lib/default-nail-images.ts';

test('Florida parsers reject contacts from other states',()=>{
  const region={code:'FL',name:'Florida'};
  for(const state of ['FL','GA','AL']){
    const item={name:'Beauty studio',telephone:'305-444-1234',address:{addressRegion:state,streetAddress:'100 Main St',addressLocality:'Miami',postalCode:'33101'}};
    assert.equal(parseStructured(`<article><script type="application/ld+json">${JSON.stringify(item)}</script></article>`,'https://example.com','Hair',region).length,state==='FL'?1:0);
    assert.equal(parseLookup(`<div class="business-card"><div><h3><a href="/business/studio">Beauty studio</a></h3><div class="meta">Beauty studio, 100 Main St, Miami, ${state} 33101 · (305) 444-1234</div>`,'https://example.com','Hair',region).length,state==='FL'?1:0);
  }
});

test('Florida offline profiles have complete contacts, source references and existing industry images',async()=>{
  const prepared=JSON.parse(await readFile(new URL('../data/florida-prepared-profiles.json',import.meta.url),'utf8'));
  const {businesses}=prepared;
  assert.equal(prepared.status,'prepared_only_not_imported_or_deployed');
  assert.ok(businesses.length>0);
  assert.equal(new Set(businesses.map(b=>b.id)).size,businesses.length);
  const images=new Set();
  for(const b of businesses){
    assert.equal(b.state,'FL');assert.ok(b.name&&b.city&&b.collectedOn);
    assert.match(b.address,/\b\d+[a-z]?(?:-\d+)?\s+\S+/i);
    assert.match(b.phone,/^[2-9]\d{2}-[2-9]\d{2}-\d{4}$/);assert.doesNotMatch(b.phone,/^\d{3}-555-01\d{2}$/);
    assert.match(b.sourceUrl,/^https:\/\//);assert.equal(b.email,'');
    assert.equal(b.claimState,'unclaimed');assert.equal(b.bookingEnabled,false);assert.equal(b.hoursConfirmed,false);
    assert.equal(b.defaultCoverImage,resolveBusinessCoverImage({id:b.id,name:b.name,categories:b.categories}));
    assert.ok(b.referencePost.body.includes(b.sourceUrl));assert.equal(b.referencePost.status,'prepared_not_published');
    assert.equal(b.imageCredit,'AI illustration');assert.ok(!('rating' in b));images.add(b.defaultCoverImage);
  }
  for(const image of images)await access(new URL(`../public${image}`,import.meta.url));
  for(const category of ['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care'])assert.ok(businesses.some(b=>b.categories.includes(category)),category);
});

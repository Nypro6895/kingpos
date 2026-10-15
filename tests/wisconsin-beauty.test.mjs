import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseStructured, parseLookup } from '../scripts/collect-wisconsin-beauty.mjs';
import { DEFAULT_BUSINESS_IMAGES, resolveBusinessCoverImage, isDefaultBusinessImage } from '../lib/default-nail-images.ts';

test('only factual complete Wisconsin contacts are collected, with no copied reviews or ratings', () => {
  const b={name:'Test Hair',telephone:'(608) 555-0123',address:{streetAddress:'10 Main St',addressLocality:'Madison',addressRegion:'WI'},aggregateRating:{ratingValue:5}};
  const article=x=>`<article><p>Madison, WI 53703</p><script type="application/ld+json">${JSON.stringify(x)}</script></article>`;
  const contacts=parseStructured(article(b)+article({...b,telephone:''})+article({...b,address:{...b.address,addressRegion:'IL'}}),'https://example.com','Hair');
  assert.equal(contacts.length,1);assert.equal(contacts[0].email,'');assert.equal(contacts[0].aggregateRating,undefined);
  assert.equal(parseLookup('<div class="business-card"><div><h3><a href="/business/test">Test</a></h3><div class="meta">Test, 10 Main St, Madison, WI 53703 · (608) 555-0123</div>','https://example.com','Massage')[0].city,'Madison');
});
test('the merged directory has unique identities and contacts with category coverage and original dates', () => {
  const {businesses}=JSON.parse(readFileSync(new URL('../data/wisconsin-profile-sources.json',import.meta.url)));
  const ids=new Set(),contacts=new Set();
  for(const b of businesses){assert.ok(b.name&&b.address&&b.city);assert.match(b.phone,/^\d{3}-\d{3}-\d{4}$/);assert.match(b.sourceUrl,/^https:\/\//);assert.ok(!ids.has(b.id));ids.add(b.id);const k=b.phone+'|'+b.address.toLowerCase().replace(/[^a-z0-9]/g,'');assert.ok(!contacts.has(k));contacts.add(k);}
  for(const category of ['Hair','Massage','Tattoo','Lashes'])assert.ok(businesses.filter(b=>b.categories.includes(category)).length>100);
  assert.ok(businesses.some(b=>b.collectedOn==='2026-10-05'));assert.ok(businesses.some(b=>b.collectedOn==='2026-10-08'));
});
test('category-matched defaults vary stably and never replace real photos', () => {
  for(const category of ['Hair','Massage','Tattoo','Lashes']){
    const seen=new Set();for(let i=0;i<100;i++){const input={id:`business-${i}`,categories:[category]};const image=resolveBusinessCoverImage(input);assert.equal(image,resolveBusinessCoverImage(input));assert.ok(DEFAULT_BUSINESS_IMAGES[category].includes(image));assert.ok(isDefaultBusinessImage(image));seen.add(image);}
    assert.equal(seen.size,8);for(const image of DEFAULT_BUSINESS_IMAGES[category])assert.ok(existsSync(new URL('../public'+image,import.meta.url)));
    assert.equal(resolveBusinessCoverImage({id:'business',categories:[category],coverImageUrl:'/owner.webp'}),'/owner.webp');
  }
  assert.equal(resolveBusinessCoverImage({id:'business',categories:['Yoga']}),null);
});

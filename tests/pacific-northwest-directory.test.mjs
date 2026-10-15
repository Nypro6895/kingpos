import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseLookup, parseStructured } from '../scripts/collect-wisconsin-beauty.mjs';
import { resolveBusinessCoverImage } from '../lib/default-nail-images.ts';
test('state-aware parsers do not mix Oregon, Washington or Washington DC contacts',()=>{
  for(const region of [{code:'OR',name:'Oregon'},{code:'WA',name:'Washington'}]){
    for(const state of ['OR','WA','DC']){
      const item={name:'Beauty studio',telephone:'206-555-0123',address:{addressRegion:state,streetAddress:'100 Main St',addressLocality:'City',postalCode:'98001'}};
      const structured=`<article><script type="application/ld+json">${JSON.stringify(item)}</script></article>`;
      assert.equal(parseStructured(structured,'https://example.com','Nails',region).length,state===region.code?1:0);
      const lookup=`<div class="business-card"><div><h3><a href="/business/studio">Beauty studio</a></h3><div class="meta">Beauty studio, 100 Main St, City, ${state} 98001 · (206) 555-0123</div>`;
      assert.equal(parseLookup(lookup,'https://example.com','Lashes',region).length,state===region.code?1:0);
    }
  }
});
test('both state datasets have usable public contacts and illustrations across every requested category',async()=>{
  for(const [slug,state] of [['oregon','OR'],['washington','WA']]){
    const {businesses}=JSON.parse(await readFile(new URL(`../data/${slug}-profile-sources.json`,import.meta.url),'utf8'));
    assert.equal(new Set(businesses.map(b=>b.id)).size,businesses.length);
    for(const b of businesses){assert.equal(b.state,state);assert.ok(b.name&&b.city&&b.sourceUrl&&b.collectedOn);assert.match(b.address,/\b\d+[a-z]?(?:-\d+)?\s+\S+/i);assert.match(b.phone,/^\d{3}-\d{3}-\d{4}$/);assert.equal(b.email,'');assert.ok(resolveBusinessCoverImage({id:b.id,name:b.name,categories:b.categories}));assert.ok(!('rating' in b));}
    for(const c of ['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care'])assert.ok(businesses.some(b=>b.categories.includes(c)),`${state} ${c}`);
  }
});

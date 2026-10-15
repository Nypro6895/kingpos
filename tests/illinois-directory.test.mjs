import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseLookup, parseStructured } from '../scripts/collect-wisconsin-beauty.mjs';
const region={code:'IL',name:'Illinois'};
test('Illinois parsers reject Wisconsin contacts and incomplete phone numbers',()=>{
 const item=state=>`<article><script type="application/ld+json">${JSON.stringify({name:'Salon',telephone:'312-555-0123',address:{addressRegion:state,streetAddress:'10 Main St',addressLocality:'Chicago',postalCode:'60601'}})}</script></article>`;
 assert.equal(parseStructured(item('IL'),'https://example.com','Nails',region).length,1);
 assert.equal(parseStructured(item('WI'),'https://example.com','Nails',region).length,0);
 const card=state=>`<div class="business-card"><div><h3><a href="/business/salon">Salon</a></h3><div class="meta">Salon, 10 Main St, Chicago, ${state} 60601 · (312) 555-0123</div>`;
 assert.equal(parseLookup(card('IL'),'https://example.com','Lashes',region).length,1);
 assert.equal(parseLookup(card('WI'),'https://example.com','Lashes',region).length,0);
 assert.equal(parseLookup(card('IL').replace('(312) 555-0123',''),'https://example.com','Lashes',region).length,0);
});
test('Illinois source records have complete contacts, unique identities, and all requested beauty groups',async()=>{
 const {businesses}=JSON.parse(await readFile(new URL('../data/illinois-profile-sources.json',import.meta.url),'utf8'));
 assert.equal(new Set(businesses.map(b=>b.id)).size,businesses.length);
 for(const b of businesses){assert.equal(b.state,'IL');assert.ok(b.name&&b.address&&b.city&&b.sourceUrl&&b.collectedOn);assert.match(b.phone,/^\d{3}-\d{3}-\d{4}$/);assert.equal(typeof b.email,'string');assert.ok(!('rating' in b));}
 for(const c of ['Nails','Hair','Massage','Lashes','Tattoo','Spa','Brows','Waxing','Skin Care'])assert.ok(businesses.some(b=>b.categories.includes(c)),c);
});

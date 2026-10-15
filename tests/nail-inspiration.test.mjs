import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function moduleAt(file,imports={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console,URLSearchParams,require:name=>{assert.ok(name in imports,'Unexpected import '+name);return imports[name];}});return exports;}
const catalog=moduleAt('lib/nail-inspiration-catalog.ts');
const logic=moduleAt('lib/nail-inspiration.ts',{'@/lib/nail-inspiration-catalog':catalog});
const query=moduleAt('lib/explore-query-intent.ts');
const ids=values=>Array.from(values,look=>look.id);

test('compound nail queries require every descriptor and recognize the user’s stiletto spelling',()=>{
 const looks=logic.selectNailLooks('nail red color stilitle shape');
 assert.ok(looks.length>=3);
 for(const look of looks){assert.ok(look.colors.includes('red'));assert.equal(look.shape,'stiletto');}
 assert.deepEqual(ids(logic.selectNailLooks('red stiletto')),ids(looks));
 assert.equal(logic.selectNailLooks('red square long').length,0,'never loosen required shape/length to fill an empty result');
 assert.equal(logic.selectNailLooks('hair blue').length,0,'do not inject nails into other services');
 assert.equal(logic.selectNailLooks('pedicure').length,0,'hand imagery is not tagged as a pedicure');
});
test('facet intersection, seasonal neutrals, and special occasion filters stay precise',()=>{
 const filtered=logic.selectNailLooks('',{color:'red',shape:'stiletto',length:'long'});
 assert.ok(filtered.length>=3);
 assert.ok(logic.selectNailLooks('',{tone:'pastel',season:'spring'}).length>=5);
 assert.ok(!ids(logic.selectNailLooks('',{season:'bridal'})).includes('cherry-stiletto'));
 assert.ok(ids(logic.selectNailLooks('',{season:'winter'})).includes('cherry-stiletto'));
 const coffin=logic.selectNailLooks('',{shape:'coffin'}),ballerina=logic.selectNailLooks('',{shape:'ballerina'});
 assert.deepEqual(ids(coffin),ids(ballerina),'coffin and ballerina are discoverable synonyms');
});
test('rotation is unique, repeatable within a session and independent of location',()=>{
 const first=ids(logic.selectNailLooks('',{},'session-a')),again=ids(logic.selectNailLooks('',{},'session-a'));
 assert.equal(first.length,catalog.NAIL_LOOKS.length);assert.equal(new Set(first).size,catalog.NAIL_LOOKS.length);assert.deepEqual(first,again);
 assert.notDeepEqual(first,ids(logic.selectNailLooks('',{},'session-b')));
 const milwaukee=logic.nailSalonSearchInput({query:'red stiletto',location:'Milwaukee, WI',strictLocation:true});
 const tosa=logic.nailSalonSearchInput({query:'red stiletto',location:'Wauwatosa, WI',strictLocation:true});
 assert.equal(milwaukee.query,'');assert.equal(tosa.query,'');assert.equal(milwaukee.target,'salons');assert.equal(milwaukee.category,'Nails');assert.equal(milwaukee.scopePolicy,'fixed');
 assert.equal(tosa.location,'Wauwatosa, WI');assert.notEqual(milwaukee.location,tosa.location);
 const gps=logic.nailSalonSearchInput({latitude:43.04,longitude:-87.91});assert.equal(gps.latitude,43.04);assert.equal(gps.longitude,-87.91);assert.equal(gps.locationSource,'gps');
 assert.equal(gps.sort,'closest');assert.equal(logic.nailSalonSearchInput({bookableOnly:true}).sort,'closest');
});
test('unpaired look opens actual nearby salons without repeating the Ideas query',()=>{
 const url=new URL(logic.nailSalonSearchHref('Honolulu, HI'),'https://example.test');
 assert.equal(url.pathname,'/explore');assert.equal(url.searchParams.get('type'),'salons');
 assert.equal(url.searchParams.get('category'),'Nails');assert.equal(url.searchParams.get('sort'),'closest');
 assert.equal(url.searchParams.get('location'),'Honolulu, HI');assert.equal(url.searchParams.get('locationSource'),'manual');
 assert.equal(url.searchParams.has('q'),false);
 assert.equal(new URL(logic.nailSalonSearchHref(),'https://example.test').searchParams.has('location'),false);
});
test('style searches route to Ideas without sacrificing explicit brand and salon searches',()=>{
 for(const term of ['red stiletto nails','nails red color stilitle shape','short square nude','red nails in Milwaukee']){
  const route=query.parseExploreQueryIntent(term);assert.equal(route.target,'posts');assert.equal(route.categoryHint,'Nails');
 }
 assert.equal(query.parseExploreQueryIntent('nails red color stilitle shape').locationHint,'');
 assert.equal(query.parseExploreQueryIntent('red nails in Milwaukee').locationHint,'Milwaukee');
 assert.equal(query.parseExploreQueryIntent('"Red Nails"').target,'salons');
 assert.equal(query.parseExploreQueryIntent('red nails',{target:'salons'}).target,'salons');
 assert.equal(query.parseExploreQueryIntent('King Nails').target,'salons');
});
test('salon eligibility respects canonical bookability, price and identity; contacts are safe',()=>{
 const salon={id:'10000000-0000-4000-8000-000000000001',bookingEnabled:false,bookingHref:null,startingPrice:null,isNew:false};
 assert.equal(logic.nailSalonEligible(salon,{}),true);assert.equal(logic.nailSalonEligible(salon,{bookableOnly:true}),false);
 assert.equal(logic.nailSalonEligible({...salon,id:'showcase-1'},{}),false);
 assert.equal(logic.nailSalonEligible(salon,{maxPrice:50}),false);
 assert.equal(logic.nailSalonEligible({...salon,startingPrice:45},{maxPrice:50}),true);
 assert.equal(logic.nailPhoneHref('(414) 555-0100'),'tel:4145550100');assert.equal(logic.nailPhoneHref('javascript:alert(1)'),null);
});
test('favorites resolve one global look independent of salons and reject invented IDs',async()=>{
 const favorites=moduleAt('lib/explore-reference-favorites.ts',{'server-only':{},'@/lib/nail-inspiration-catalog':catalog,'@/lib/explore-showcase-content':{getExploreShowcaseLookPage:()=>null},'@/lib/supabase/server':{createSupabaseServerClient:()=>{throw Error('Image favorites must not search a salon');}}});
 const result=await favorites.resolveReferenceFavorites(['look:nail-cherry-stiletto','look:nail-cherry-stiletto','look:nail-not-real']);
 assert.equal(result.items.length,1);assert.equal(result.items[0].href,'/explore/inspiration/cherry-stiletto');assert.equal(result.items[0].nailLookId,'cherry-stiletto');
});
test('original library has useful shape, length, color and season coverage, unique stable IDs',()=>{
 assert.ok(catalog.NAIL_LOOKS.length>=48);assert.equal(new Set(catalog.NAIL_LOOKS.map(x=>x.id)).size,catalog.NAIL_LOOKS.length);
 for(const shape of catalog.NAIL_FACETS.shape)assert.ok(catalog.NAIL_LOOKS.some(x=>x.shape===shape),shape);
 for(const color of catalog.NAIL_FACETS.color)assert.ok(catalog.NAIL_LOOKS.some(x=>x.colors.includes(color)),color);
 for(const look of catalog.NAIL_LOOKS){assert.ok(look.imageUrl.startsWith('/inspiration/nails/'));assert.ok(look.alt.length>30);}
});

test('new design names route to inspiration and match their own tags without relaxing shape or color',()=>{
 const cases=[['tortoise shell nails','amber-tortoiseshell'],['polka dots nails','cocoa-polka-dots'],['plum aura coffin','plum-aura-coffin'],['olive velvet nails','olive-velvet-almond'],['burgundy micro french','burgundy-micro-french'],['milky matcha nails','milky-matcha-squoval'],['bambi nails','fawn-print-almond'],['burgundy jelly','burgundy-jelly-oval'],['liquid metal stiletto','liquid-silver-sculpture'],['pearl french almond','pearl-french-almond'],['caramel jelly square','caramel-jelly-square'],['cheetah nails','cheetah-neutral-almond'],['mix and match nails','autumn-mix-match'],['knit sweater nails','cashmere-knit-square'],['chartreuse nails','chartreuse-gloss-oval'],['soap nails','clean-soap-round']];
 for(const [term,id] of cases){assert.ok(ids(logic.selectNailLooks(term)).includes(id),term);const route=query.parseExploreQueryIntent(term);assert.equal(route.target,'posts',term);assert.equal(route.categoryHint,'Nails',term);assert.equal(route.locationHint,'',term);}
 assert.deepEqual(ids(logic.selectNailLooks('fawn print',{color:'blue'})),[]);
 assert.deepEqual(ids(logic.selectNailLooks('jelly',{shape:'stiletto'})),[]);
 assert.equal(query.parseExploreQueryIntent('"Soap Nails"').target,'salons');
});

test('pattern and jelly facets return only matching designs, and all new metadata uses valid facets',()=>{
 for(const finish of ['tortoiseshell','polka-dot','animal-print','aura','jelly','mixed']){
  const looks=logic.selectNailLooks('',{finish});assert.ok(looks.length>0,finish);assert.ok(looks.every(look=>look.finish===finish));
 }
 for(const look of catalog.NAIL_LOOKS){assert.ok(catalog.NAIL_FACETS.finish.includes(look.finish),look.id);assert.ok(catalog.NAIL_FACETS.shape.includes(look.shape),look.id);for(const color of look.colors)assert.ok(catalog.NAIL_FACETS.color.includes(color),look.id);}
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { build } from 'esbuild';
import sharp from 'sharp';
const bundle=await build({stdin:{contents:'export * from "./types/gift-card"; export * from "./components/gift-card/gift-presets";',resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const {createGiftPreset,giftPresets,normalizeGiftDesign,defaultGiftDesign}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
assert.equal(giftPresets.length,3);
for(let i=0;i<3;i++){
 const file=fs.readFileSync('public'+giftPresets[i].image),meta=await sharp(file).metadata();assert.equal(meta.width,990);assert.equal(meta.height,600);assert.ok(file.length<60000);
 const design=createGiftPreset(i,'data:image/jpeg;base64,'+file.toString('base64'),'King Nails Spa LLC');
 const normalized=normalizeGiftDesign(normalizeGiftDesign(design));assert.equal(normalized.elements[1].font,'serif');assert.equal(normalized.elements[0].font,'sans');assert.equal(normalized.elements[1].text,'Gift Card');assert.ok(normalized.image.startsWith('data:image/jpeg;base64,'));assert.ok(JSON.stringify(normalized).length<100000);
 assert.equal(normalized.elements.some(e=>e.kind==='logo'),false);
 assert.equal(createGiftPreset(i,design.image,'Salon','https://example.invalid/logo.png').elements.filter(e=>e.kind==='logo').length,1);
}
const old=normalizeGiftDesign(defaultGiftDesign('Existing salon'));assert.equal(old.elements.some(e=>'font' in e),false);
const injected=defaultGiftDesign();injected.elements[0].font='url(https://example.invalid/font)';assert.equal(normalizeGiftDesign(injected).elements.some(e=>'font' in e),false);
console.log('PASS premium assets, payload size, editable type normalization, existing-card fallback and font allowlist.');

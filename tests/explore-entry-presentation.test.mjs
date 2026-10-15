import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function load(path,deps={}) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>deps[name]});
  return exports;
}
const defaults=load('lib/default-nail-images.ts');
const {explorePreviewImages,exploreAlternatingShortcuts,exploreShortcutIndex,exploreShortcutDiscovery}=load('lib/explore-entry-presentation.ts',{'@/lib/default-nail-images':defaults});
const home=items=>({inspiration:{items},recommendedSalons:[],newSalons:[]});

test('the preview uses one business once and adds directory photos instead of repeating the claimed salon logo',()=>{
  const content=home(Array.from({length:5},(_,i)=>({salonId:'claimed',salonName:'Claimed',imageUrl:`/work-${i}.webp`,salonLogoImageUrl:'/crown.webp'})));
  const salons=Array.from({length:6},(_,i)=>({id:`directory-${i}`,name:`Directory ${i}`,coverImageUrl:`/salon-${i}.webp`,logoImageUrl:'/same-logo.webp',hasPublicProfile:false}));
  const images=explorePreviewImages(content,salons);
  assert.equal(images.length,5);
  assert.equal(new Set(images.map(x=>x.salonId)).size,5);
  assert.equal(new Set(images.map(x=>x.imageUrl)).size,5);
  assert.equal(images[0].imageUrl,'/work-0.webp');
  assert.ok(images.slice(1).every(x=>x.salonId.startsWith('directory-')));
});

test('shared images are not repeated, actual photos precede illustrations, and missing content does not invent salons',()=>{
  const salons=[{id:'a',name:'A',coverImageUrl:defaults.DEFAULT_NAIL_IMAGES[0]},{id:'b',name:'B',coverImageUrl:'/real.webp'},{id:'c',name:'C',coverImageUrl:'/real.webp'},{id:'d',name:'D',coverImageUrl:null}];
  const images=explorePreviewImages(home([]),salons);
  assert.deepEqual(Array.from(images,x=>x.salonId),['b','a']);
  assert.equal(images[0].illustration,false);assert.equal(images[1].illustration,true);
  assert.equal(explorePreviewImages(home([]),[]).length,0);
});

test('shortcuts are available even when the small homepage preview is empty, alternate only after content, and do not mutate input',()=>{
  const originals=[{id:'recommended',previews:[{sourceId:'one'}],label:'Old title'}];
  const shortcuts=exploreAlternatingShortcuts(originals);
  assert.deepEqual(Array.from(shortcuts,s=>s.id),['trending','recommended']);
  assert.equal(shortcuts[1].previews[0].sourceId,'one');assert.equal(originals[0].label,'Old title');
  assert.deepEqual(Array.from({length:13},(_,i)=>exploreShortcutIndex(i)),[null,null,null,null,0,null,null,null,1,null,null,null,0]);
  assert.equal(exploreAlternatingShortcuts([]).length,2);
});

test('both discovery entry points retain area/category/GPS context and use distinct paginated feed ordering',()=>{
  const base={category:'Hair',location:'Chicago, IL',strictLocation:true,coordinates:{latitude:41.88,longitude:-87.63}};
  for(const [kind,intent] of [['trending','latest'],['recommended','discover']]) {
    const result=exploreShortcutDiscovery({...base,kind});
    assert.equal(result.intent,intent);assert.equal(result.category,'Hair');assert.equal(result.location,'Chicago, IL');
    assert.equal(result.strictLocation,true);assert.equal(result.latitude,41.88);assert.equal(result.longitude,-87.63);
    assert.ok(!('query' in result),'do not turn the shortcut name into a salon keyword');
  }
  const anywhere=exploreShortcutDiscovery({...base,kind:'recommended',category:'All',location:'',strictLocation:false,coordinates:null});
  assert.equal(anywhere.category,'');assert.equal(anywhere.latitude,null);assert.equal(anywhere.strictLocation,false);
});

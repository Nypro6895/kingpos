const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),ts=require('typescript'),cache=new Map();
function load(file){
 if(cache.has(file))return cache.get(file);
 const text=fs.readFileSync(path.join(root,file),'utf8');
 if(file.endsWith('.json'))return JSON.parse(text);
 const exports={};cache.set(file,exports);
 new Function('exports','require',ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText)(exports,spec=>{
  const base=spec.startsWith('@/')?spec.slice(2):path.posix.join(path.posix.dirname(file),spec);
  return load(base.endsWith('.json')?base:base+'.ts');
 });return exports;
}
const {resolveHelpLanguage,translateHelp,helpHref}=load('lib/help-language.ts'),{HELP_GUIDES,HELP_QUICK_STARTS}=load('lib/help-guides.ts'),{searchHelpGuides}=load('lib/help-search.ts');
test('Old deep links default to Vietnamese; only the explicit EN option enables English',()=>{
 for(const value of [null,undefined,'vi','fr','EN',['en'],''])assert.equal(resolveHelpLanguage(value),'vi');assert.equal(resolveHelpLanguage('en'),'en');
});
test('Language navigation preserves article anchor and unrelated query values; support source stays unchanged',()=>{
 assert.equal(helpHref('/help/owner-tips?from=menu#money','en'),'/help/owner-tips?from=menu&lang=en#money');
 assert.equal(helpHref('/help?lang=vi','en'),'/help?lang=en');
 for(const href of ['/support?from=%2Fhelp%2Fowner-tips','/helpful','https://other.invalid/help','//other.invalid/help','/pos/settings'])assert.equal(helpHref(href,'en'),href);
});
test('All thirteen guides, Owner Tips, alt texts and action labels have a complete Vietnamese counterpart',()=>{
 assert.equal(HELP_GUIDES.length,13);assert.equal(HELP_GUIDES.find(g=>g.slug==='owner-tips').sections.length,8);
 const copy=load('app/help/help-copy.json');
 const strings=HELP_GUIDES.flatMap(g=>[g.title,g.summary,g.entry.label,g.prerequisite,...g.notes,...g.steps.flatMap(s=>[s.title,s.body]),...g.sections.flatMap(s=>[s.title,s.check,s.example,...s.steps,...s.issues]),...g.evidence.screenshots.flatMap(s=>[s.alt,s.caption])]);
 strings.push(...HELP_QUICK_STARTS.flatMap(r=>[r.title,r.summary]));
 for(const text of strings){assert(copy[text]?.trim(),text);assert.equal(translateHelp(text,'en'),text);assert.equal(translateHelp(text,'vi'),copy[text]);}
});
test('Search finds tasks in either language and respects role filters',()=>{
 for(const q of ['hoa hong','commission'])assert(searchHelpGuides(q).some(g=>g.slug==='payroll-and-tax'),q);
 for(const q of ['dat lich','booking'])assert(searchHelpGuides(q,'staff').length>0,q);
 for(const role of ['customer','owner','staff'])assert(searchHelpGuides('',role).every(g=>g.roles.includes(role)));
 assert.equal(searchHelpGuides('zz-no-such-task-zz').length,0);
});
test('Each illustration has a distinct EN/VI desktop/mobile asset with valid dimensions and unchanged provenance',()=>{
 const map=load('lib/help-illustrations.json');assert.equal(Object.keys(map).length,27);
 for(const screen of HELP_GUIDES.flatMap(g=>g.evidence.screenshots)){
 assert.equal(screen.provenance,'source-grounded-simulation');
 for(const language of ['en','vi'])for(const viewport of ['desktop','mobile']){
 const image=map[screen.id][language][viewport];assert(image.src.includes('/'+language+'/'));assert(image.width>0&&image.height>0);assert(fs.existsSync(path.join(root,'public',image.src)));
 }}
});
test('Personal, Owner and Staff each retain support and expose a distinct Help entry',()=>{
 const {ROLE_MORE_ITEMS,ROLE_NAVIGATION}=load('app/role-navigation.ts');
 for(const role of ['personal','owner','staff']){
 const items=ROLE_MORE_ITEMS[role];assert.equal(items.filter(i=>i.href==='/support'&&i.label==='Report / Contact').length,1);assert.equal(items.filter(i=>i.href==='/help'&&i.label==='Help').length,1);
 assert.equal(new Set(items.map(i=>i.id)).size,items.length);
 assert(ROLE_NAVIGATION[role].moreLinks.some(l=>l.href==='/support'));assert(ROLE_NAVIGATION[role].moreLinks.some(l=>l.href==='/help'));
 }
});

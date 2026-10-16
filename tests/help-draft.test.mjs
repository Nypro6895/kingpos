import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url),root=process.cwd();
function harness(env={},vietnamese=false){
 const cache=new Map();
 function load(file){
  if(cache.has(file))return cache.get(file);
  if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));
  if(file.endsWith('.css'))return {__esModule:true,default:new Proxy({},{get:(_,name)=>String(name)})};
  const exports={};cache.set(file,exports);
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  function resolve(name){
   if(name==='server-only')return {};
   if(name==='next/navigation')return {notFound(){throw new Error('NEXT_NOT_FOUND');}};
   if(name==='next/link')return {__esModule:true,default:({children,...props})=>{delete props.prefetch;return React.createElement('a',props,children);}};
   if(name==='@/components/experience-page')return {withExperiencePage:Page=>Page};
   if(name==='@/components/workspace-language'){
    const translate=value=>typeof value==='string'?load(path.join(root,'lib/vietnamese-dictionary.ts')).translateVietnamese(value,vietnamese):value;
    return {useWorkspaceTranslation:()=>translate,WorkspaceText:({text})=>translate(text),WorkspaceElement:({as,children,...props})=>React.createElement(as,Object.fromEntries(Object.entries(props).map(([key,value])=>[key,['aria-label','title','alt'].includes(key)?translate(value):value])),children)};
   }
   if(name.startsWith('@/')||name.startsWith('.')){const base=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(file),name);const target=[base,base+'.ts',base+'.tsx'].find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());assert(target,'Unresolved '+name);return load(target);}
   return require(name);
  }
  new Function('require','exports','process',code)(resolve,exports,{env});return exports;
 }
 return relative=>load(path.join(root,relative));
}


test('reviewed Help is available without a preview flag; unknown slugs remain notFound',async()=>{
 const load=harness({NODE_ENV:'production'}),catalog=load('lib/help-guides.ts'),article=load('app/(app)/help/[slug]/page.tsx');
 assert.equal(load('lib/help-draft.ts').isHelpAvailable(),true);
 assert.equal(load('app/(app)/help/page.tsx').metadata.robots.index,true);
 assert.match(renderToStaticMarkup(await load('app/(app)/help/page.tsx').default()),/Hướng dẫn Reylumi/);
 assert.match(renderToStaticMarkup(load('app/help/help-content.tsx').HelpSupportEntry()),/href="\/help"/);
 for(const g of catalog.HELP_GUIDES){const html=renderToStaticMarkup(await article.default({params:Promise.resolve({slug:g.slug})}));assert.equal((html.match(/<h1>/g)||[]).length,1);assert.match(html,/Ảnh minh họa/);assert.doesNotMatch(html,/Pending real screenshot|Local draft/);assert(html.includes(encodeURIComponent('/help/'+g.slug)));}
 for(const slug of ['missing-guide','constructor','__proto__','../settings'])await assert.rejects(article.default({params:Promise.resolve({slug})}),/NEXT_NOT_FOUND/);
});
test('quick starts, destinations and source evidence stay valid',()=>{
 const load=harness(),{HELP_GUIDES,HELP_QUICK_STARTS,HELP_VERSION}=load('lib/help-guides.ts');
 assert.equal(HELP_VERSION.publicationStatus,'ready');assert.equal(new Set(HELP_GUIDES.map(g=>g.slug)).size,13);
 const routes=new Set();function walk(dir,parts=[]){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.isDirectory())walk(path.join(dir,e.name),[...parts,e.name]);else if(e.name==='page.tsx')routes.add('/'+parts.filter(p=>!/^\(.*\)$/.test(p)).join('/'));}}walk(path.join(root,'app'));
 for(const role of HELP_QUICK_STARTS)for(const slug of role.slugs){const g=HELP_GUIDES.find(g=>g.slug===slug);assert(g?.roles.includes(role.id));}
 for(const g of HELP_GUIDES){assert(routes.has(g.entry.href));assert(!g.entry.href.includes('['));assert.equal(g.evidence.productionFlowVerified,false);for(const file of g.evidence.sourceFiles)assert(fs.existsSync(path.join(root,file)),file);}
});
test('each illustration has existing responsive images and honest provenance',()=>{
 const load=harness(),seen=new Set();
 for(const g of load('lib/help-guides.ts').HELP_GUIDES)for(const s of g.evidence.screenshots){assert(s.alt.length>20);assert.equal(s.status,'illustrated');assert.equal(s.provenance,'source-grounded-simulation');for(const vp of ['desktop','mobile']){const a=s[vp];assert(a.src.startsWith('/help/2026-10-15/'));assert(a.width>300&&a.height>500);const b=fs.readFileSync(path.join(root,'public',a.src));assert.equal(b[0],255);assert.equal(b[1],216);seen.add(a.src);}}
 assert.equal(seen.size,54);
});
test('Vietnamese copy covers walkthroughs, captions and accessible alt text',async()=>{
 const load=harness({NODE_ENV:'production'},true),{HELP_GUIDES,HELP_QUICK_STARTS}=load('lib/help-guides.ts'),{translateHelp}=load('app/help/help-language.tsx');const strings=[];
 for(const g of HELP_GUIDES)strings.push(g.title,g.summary,g.prerequisite,g.entry.label,...g.steps.flatMap(s=>[s.title,s.body]),...g.notes,...g.sections.flatMap(s=>[s.title,...s.steps,s.check,s.example,...s.issues]),...g.evidence.screenshots.flatMap(s=>[s.caption,s.alt]));
 for(const r of HELP_QUICK_STARTS)strings.push(r.title,r.summary);
 for(const text of strings){assert.notEqual(translateHelp(text),text,text);}
 const html=renderToStaticMarkup(await load('app/(app)/help/[slug]/page.tsx').default({params:Promise.resolve({slug:'payroll-and-tax'})}));assert.match(html,/Ảnh minh họa/);assert.doesNotMatch(html,/Demo illustration|Illustrated guide/);
});
test('search accepts English, Vietnamese and missing diacritics with role filtering',()=>{
 const {searchHelpGuides,normalizeHelpQuery}=harness()('lib/help-search.ts');
 assert.equal(normalizeHelpQuery('ĐẶT LỊCH'),'dat lich');
 for(const query of ['payroll','hoa hong','statement','ten phap ly'])assert(searchHelpGuides(query).some(g=>g.slug==='payroll-and-tax'),query);
 for(const query of ['đặt lịch','dat lich'])assert(searchHelpGuides(query,'customer').some(g=>g.slug==='find-and-book'));
 assert(searchHelpGuides('','staff').every(g=>g.roles.includes('staff')));assert.equal(searchHelpGuides('zzzz-not-a-task-zzzz').length,0);assert.equal(searchHelpGuides('').length,13);
});

test('Help stays Vietnamese and keeps the approved owner walkthrough complete',async()=>{
 const load=harness({NODE_ENV:'production'},false),catalog=load('lib/help-guides.ts'),page=load('app/help/help-content.tsx');
 const owner=catalog.findHelpGuide('owner-tips');assert.equal(owner.sections.length,8);assert(owner.sections.every(s=>s.illustrationId&&s.steps.length>=3&&s.check&&s.example&&s.issues.length));
 for(const guide of catalog.HELP_GUIDES){assert(guide.sections.length);for(const section of guide.sections){assert(section.steps.length>=2);assert(section.check&&section.example&&section.issues.length);}}
 const home=renderToStaticMarkup(page.HelpHome());assert.match(home,/lang="vi"/);assert.match(home,/Mẹo cho chủ tiệm/);assert.doesNotMatch(home,/Illustrated guide|Images are simplified|Content reviewed|2026-10-15\.3/);
 const html=renderToStaticMarkup(page.HelpArticle({guide:owner}));assert.equal((html.match(/<picture>/g)||[]).length,8);assert.match(html,/Credit Card/);assert.match(html,/Ảnh minh họa/);assert.doesNotMatch(html,/Sample data|layout differences|UI MOCKUP/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import ts from 'typescript';

test('Library entry shows the photo library while ordinary profiles retain Overview and tab navigation', {timeout: 60000}, async () => {
  const path = process.cwd().replaceAll('\\', '/') + '/app/beauty/beauty-profile-client.tsx';
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const mocks = new Map();
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || !node.importClause || node.importClause.isTypeOnly) continue;
    const module = node.moduleSpecifier.text;
    // Exercise the real component, real photo-library view and CSS.
    if (['react', 'react-dom', './beauty-library'].includes(module)) continue;
    const bindings = node.importClause.namedBindings;
    const names = bindings && ts.isNamedImports(bindings) ? bindings.elements.filter(n => !n.isTypeOnly).map(n => n.propertyName?.text ?? n.name.text) : [];
    let code = node.importClause.name ? 'export default function Stub(){return null;}\n' : '';
    for (const name of names) {
      if (name === 'POST_CHANGED_EVENT') code += `export const ${name}='fixture-post-change';\n`;
      else if (/ALLOWED_IMAGE_TYPES$/.test(name)) code += `export const ${name}=['image/jpeg'];\n`;
      else if (/IMAGE_LIMIT$/.test(name)) code += `export const ${name}=1000000;\n`;
      else code += `export function ${name}(){return null;}\n`;
    }
    mocks.set(module, code);
  }
  const bundle = await build({bundle:true,write:false,outdir:'fixture',jsx:'automatic',stdin:{loader:'tsx',resolveDir:process.cwd(),contents:`
    import React from 'react';import{createRoot}from'react-dom/client';import{BeautyProfileClient}from'./app/beauty/beauty-profile-client';
    const initialSection=new URLSearchParams(location.search).get('section')||undefined;
    createRoot(document.getElementById('root')).render(<BeautyProfileClient initialSection={initialSection} profile={{id:'self',isSelf:true,displayName:'QA',initials:'Q',visibility:'public',avatarUrl:null,coverImageUrl:null}} initialTimeline={{items:[],nextCursor:null,hasMore:false,error:null}} commentViewer={{isAuthenticated:true,userId:'self'}} visitCandidates={[]}/>);
  `},plugins:[{name:'isolated-library-services',setup(b){
    b.onResolve({filter:/.*/},a=>a.importer.replaceAll('\\','/')===path && mocks.has(a.path)?{path:a.path,namespace:'mock'}:undefined);
    b.onResolve({filter:/^next\/(link|image)$/},a=>({path:a.path,namespace:'next-mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:mocks.get(a.path),loader:'tsx',resolveDir:process.cwd()}));
    b.onLoad({filter:/.*/,namespace:'next-mock'},a=>({contents:a.path.endsWith('image')?'export default function Image(props){return <img {...props}/>}':'export default function Link({children,...props}){return <a {...props}>{children}</a>}',loader:'tsx',resolveDir:process.cwd()}));
  }}]});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text,css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).text;
  const html=`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:Arial;margin:0}button{font:inherit}${css}</style><div id="root"></div><script>${js}</script>`;
  mkdirSync('artifacts/ipad-page-audit-fixes-20261104',{recursive:true});
  writeFileSync('artifacts/ipad-page-audit-fixes-20261104/library-fixture.html',html);
  const server=createServer((_,res)=>{res.setHeader('Content-Type','text/html');res.end(html)});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({executablePath:process.env.TEST_BROWSER_PATH??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const [width,height] of [[834,1194],[1194,834],[1032,1376],[1376,1032],[390,844]]){
      await page.setViewportSize({width,height});await page.goto(`http://127.0.0.1:${server.address().port}/?section=library`);
      const nav=page.getByRole('navigation',{name:'Beauty sections'});
      await page.getByRole('heading',{name:'Your photo library'}).waitFor();
      assert.equal(await nav.getByRole('button',{name:'Library',exact:true}).getAttribute('aria-pressed'),'true');
      assert.equal(await page.getByRole('heading',{name:'Latest post'}).isVisible(),false);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await nav.getByRole('button',{name:'Overview',exact:true}).click();
      await page.getByRole('heading',{name:'Latest post'}).waitFor();
      await nav.getByRole('button',{name:'My posts',exact:true}).click();
      await page.getByRole('heading',{name:'Moments & Transformations'}).waitFor();
      await nav.getByRole('button',{name:'Library',exact:true}).click();
      await page.getByRole('heading',{name:'Your photo library'}).waitFor();
    }
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('heading',{name:'Latest post'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Overview',exact:true}).getAttribute('aria-pressed'),'true');
    assert.deepEqual(errors,[]);
    assert.match(readFileSync('app/(app)/beauty/library/page.tsx','utf8'),/<BeautyProfileClient\s+initialSection="library"/);
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});

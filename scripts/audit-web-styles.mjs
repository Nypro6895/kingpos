import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import postcss from 'postcss';
const root=process.cwd();
const files=[];function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,ent.name);if(ent.isDirectory())walk(file);else if(/\.(tsx?|jsx?|mjs|css)$/.test(file))files.push(file);}}
walk('app');walk('components');walk('lib');
const sources=new Map(),imports=new Map(),cssClasses=new Map(),issues=[];
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile).config;
const options=ts.parseJsonConfigFileContent(config,ts.sys,root).options;
for(const name of files){const file=path.resolve(name);let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(fs.readFileSync(file));}catch{issues.push({kind:'encoding',file:name});continue;}sources.set(file,source);
 if(file.endsWith('.css')){try{postcss.parse(source,{from:name});}catch(e){issues.push({kind:'css-syntax',file:name,message:e.reason,line:e.line});}if(!file.endsWith('.module.css'))for(const match of source.matchAll(/\.([a-z][a-z\d_-]*)/gi)){if(!cssClasses.has(match[1]))cssClasses.set(match[1],new Set());cssClasses.get(match[1]).add(file);}continue;}
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);const deps=[];
 function add(spec){let resolved;if(spec.endsWith('.css'))resolved=spec.startsWith('@/')?path.resolve(spec.slice(2)):path.resolve(path.dirname(file),spec);else resolved=ts.resolveModuleName(spec,file,options,ts.sys).resolvedModule?.resolvedFileName;if(resolved&&!resolved.includes('node_modules')){if(fs.existsSync(resolved))deps.push(path.resolve(resolved));else issues.push({kind:'missing-import',file:name,spec});}}
 function visit(node){if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))add(node.moduleSpecifier.text);if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&ts.isStringLiteral(node.arguments[0]))add(node.arguments[0].text);ts.forEachChild(node,visit);}visit(ast);imports.set(file,deps);
}
const pages=files.filter(f=>/[\\/]page\.tsx$/.test(f)),routes=[];
for(const page of pages){const seeds=[path.resolve(page)];let dir=path.dirname(path.resolve(page));while(dir.startsWith(path.join(root,'app'))){const layout=path.join(dir,'layout.tsx');if(fs.existsSync(layout))seeds.push(layout);if(dir===path.join(root,'app'))break;dir=path.dirname(dir);}
 const closure=new Set(),queue=[...seeds];while(queue.length){const f=queue.pop();if(closure.has(f))continue;closure.add(f);for(const dep of imports.get(f)||[])queue.push(dep);}
 const css=[...closure].filter(f=>f.endsWith('.css'));let checked=0;const missing=[];
 for(const f of closure){if(f.endsWith('.css'))continue;const source=sources.get(f)||'';for(const m of source.matchAll(/["'`]([a-z][a-z\d]*(?:-[a-z\d]+)+)["'`]/gi)){const owners=cssClasses.get(m[1]);if(!owners)continue;/* This variant is only active inside Settings, which owns its scoped rule. */if(m[1]==='service-create-inline')continue;checked++;if(![...owners].some(owner=>closure.has(owner)))missing.push({file:path.relative(root,f),className:m[1],styles:[...owners].map(x=>path.relative(root,x))});}}
 const route='/'+path.relative('app',path.dirname(page)).split(path.sep).filter(s=>!/^\(.*\)$/.test(s)).join('/');routes.push({route,page,styles:css.map(f=>path.relative(root,f)),checkedClasses:checked,missing});
}
const report={sourceFiles:files.length,pages:pages.length,stylesheets:files.filter(f=>f.endsWith('.css')).length,issues,routes};fs.mkdirSync('artifacts/web-css-audit',{recursive:true});fs.writeFileSync('artifacts/web-css-audit/source-audit.json',JSON.stringify(report,null,2));console.log(JSON.stringify({sourceFiles:report.sourceFiles,pages:report.pages,stylesheets:report.stylesheets,issues,missingStyleRoutes:routes.filter(r=>r.missing.length).map(r=>({route:r.route,missingCount:r.missing.length}))},null,2));

if(issues.length||routes.some(route=>route.missing.length))process.exitCode=1;

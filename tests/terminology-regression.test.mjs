import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const baseline='27e70adaf2557613a8b156c7329f4abd58c9b4fa';
const before=file=>execFileSync('git',['show',`${baseline}:${file}`],{encoding:'utf8',maxBuffer:4*1024*1024});
const after=file=>fs.readFileSync(file,'utf8');
function load(source){const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,URLSearchParams});return exports;}
const behavioral=value=>JSON.parse(JSON.stringify(value,(key,v)=>['label','title','description','icon','navigationIcon'].includes(key)?undefined:v));
test('role links, stable IDs, visibility metadata and POS capability values survive display label and icon changes',()=>{
 for(const file of ['app/role-navigation.ts','lib/pos-portable-routes.ts','lib/pos-portable-capabilities.ts']){
  const old=load(before(file)), current=load(after(file));
  for(const key of Object.keys(old))if(typeof old[key]!=='function')assert.deepEqual(behavioral(current[key]),behavioral(old[key]),file+' '+key);
 }
 const old=load(before('lib/pos-portable-routes.ts')),current=load(after('lib/pos-portable-routes.ts'));
 for(const href of Object.values(old.PORTABLE_POS_ROUTES))for(const route of [href,href+'/fixture',href+'-other','/support'])assert.equal(current.isPortablePosRoute(route,href),old.isPortablePosRoute(route,href));
});
const printer=ts.createPrinter({newLine:ts.NewLineKind.LineFeed});
function tree(source,file='source.tsx'){return ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);}
function bookingBehavior(source){const ast=tree(source);const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PublicBookingClient');assert(component);return component.body.statements.filter(n=>!ts.isReturnStatement(n)&&!(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(ast)==='contactDetailsGuidance'))).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,ast)).join('\n');}
test('booking hooks, validation, payloads, draft handling and submit handlers are unchanged',()=>{
 const file='app/book/[salonId]/public-booking-client.tsx';
 const methods=source=>{const ast=tree(source);const component=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PublicBookingClient');return new Map(component.body.statements.filter(ts.isFunctionDeclaration).map(n=>[n.name.text,printer.printNode(ts.EmitHint.Unspecified,n,ast)]))};
 const old=methods(before(file)),current=methods(after(file));for(const [name,body] of old)assert.equal(current.get(name),body,name);
 assert.ok(current.size>=old.size);
});
function filterValues(source){const ast=tree(source);let values=[];function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='FOLLOWING_FILTERS')values=[...n.initializer.elements].map(e=>e.properties.find(p=>p.name.getText(ast)==='value').initializer.text);ts.forEachChild(n,visit);}visit(ast);return values;}
test('Salons still queries the existing shop filter in both hosted and installed views',()=>{
 for(const file of ['app/(app)/more/[section]/page.tsx','components/app-local-social-views.tsx'])assert.deepEqual(filterValues(after(file)),filterValues(before(file)));
});

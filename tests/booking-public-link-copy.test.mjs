import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync('app/bookings/booking-workspace-client.tsx','utf8');
const ast=ts.createSourceFile('workspace.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const handlers=[];
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='copyPublicUrl') handlers.push(node.getText(ast));ts.forEachChild(node,visit)}
visit(ast);
for(const [index,handler] of handlers.entries()) {
  test(`booking copy control ${index+1} uses public HTTPS across app, POS and preview origins`,async()=>{
    for(const origin of ['reylumi-app://bundle','http://localhost:3000','https://preview.vercel.app']) {
      let copied; const messages=[];
      const context=vm.createContext({URL,window:{location:{origin}},publicBookingHref:'/book/11111111-1111-4111-8111-111111111111',getPublicAppOrigin:()=> 'https://reylumi.com',navigator:{clipboard:{writeText:async value=>{copied=value}}},setCopyMessage:v=>messages.push(v),setResult:v=>messages.push(v)});
      vm.runInContext(handler,context); await vm.runInContext('copyPublicUrl()',context);
      assert.equal(copied,'https://reylumi.com/book/11111111-1111-4111-8111-111111111111'); assert.match(JSON.stringify(messages),/Link copied/);
    }
  });
  test(`booking copy control ${index+1} reports unavailable clipboard`,async()=>{
    const messages=[];const context=vm.createContext({URL,publicBookingHref:'/book/test',getPublicAppOrigin:()=> 'https://reylumi.com',navigator:{},setCopyMessage:v=>messages.push(v),setResult:v=>messages.push(v)});
    vm.runInContext(handler,context);await vm.runInContext('copyPublicUrl()',context);assert.match(JSON.stringify(messages),/Could not copy/);
  });
}
assert.equal(handlers.length,2);

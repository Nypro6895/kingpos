import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import jsQR from 'jsqr';

test('QR parser accepts exact receipt/pass formats and rejects foreign URLs, arbitrary UUIDs and malformed amounts',async()=>{
 const bundle=await build({entryPoints:['lib/staff-scan.ts'],bundle:true,write:false,platform:'node',format:'esm'});
 const {parseStaffScanCode,validScanLines}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const id='00000000-0000-4000-8000-000000000030';
 assert.deepEqual(parseStaffScanCode(`reylumi:checkin:${id}`),{visitId:id});
 assert.deepEqual(parseStaffScanCode(`https://reylumi.com/visit/${id}`),{passToken:id});
 for(const code of [id,'#28',`https://evil.test/visit/${id}`,`https://reylumi.com.evil.test/visit/${id}`,`http://reylumi.com/visit/${id}`,`https://reylumi.com/visit/${id}?redirect=x`,`https://reylumi.com@evil.test/visit/${id}`,`javascript:${id}`]) assert.equal(parseStaffScanCode(code),null,code);
 assert.equal(validScanLines([{id,serviceId:'service',amount:'45.50'}]),true);
 for(const amount of ['','0','-1','1.999','1e2','NaN'])assert.equal(validScanLines([{id,serviceId:'service',amount}]),false);
});

test('The fallback decoder reads the exact QR produced by the existing check-in receipt component',async()=>{
 const bundle=await build({bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react-dom/server','react/jsx-runtime'],stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
  import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {QrCodeTile} from './components/qr-code-tile';
  export const render=code=>renderToStaticMarkup(<QrCodeTile valueToEncode={code} ariaLabel="QR" fallbackMessage="Unavailable"/>);
 `},plugins:[{name:'language',setup(b){b.onResolve({filter:/workspace-language$/},()=>({path:'language',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const WorkspaceText=({text})=>text;export const useWorkspaceTranslation=()=>text=>text;',loader:'js'}));}}]});
 const mod={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
 for(const code of ['reylumi:checkin:00000000-0000-4000-8000-000000000030','https://reylumi.com/visit/00000000-0000-4000-8000-000000000030']){
  const svg=mod.exports.render(code),size=Number(/viewBox="0 0 (\d+)/.exec(svg)[1]),scale=8,width=size*scale;
  const pixels=new Uint8ClampedArray(width*width*4).fill(255);
  for(const rect of svg.matchAll(/<rect[^>]*fill="#18181b"[^>]*>/g)){
   const x=Number(/\bx="(\d+)"/.exec(rect[0])[1]),y=Number(/\by="(\d+)"/.exec(rect[0])[1]);
   for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const i=((y*scale+dy)*width+x*scale+dx)*4;pixels[i]=pixels[i+1]=pixels[i+2]=24;}
  }
  assert.equal(jsQR(pixels,width,width)?.data,code);
 }
});

test('Scan is a Staff route for login returns and workspace handoffs',async()=>{
 const bundle=await build({entryPoints:['lib/auth-routing.ts'],bundle:true,write:false,platform:'node',format:'esm'});
 const {getAuthRouteWorkspaceKind,resolvePostAuthRoute}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 assert.equal(getAuthRouteWorkspaceKind('/staff/scan'),'staff');
 const workspaces=[{id:'owner',type:'salon',salonMode:'manage'},{id:'staff',type:'salon',salonMode:'staff'},{id:'personal',type:'personal',salonMode:null}];
 assert.equal(resolvePostAuthRoute({requestedPath:'/staff/scan',preferredWorkspaceId:'owner',workspaces}).workspaceId,'staff');
 assert.equal(resolvePostAuthRoute({requestedPath:'/staff/scan',workspaces:workspaces.filter(w=>w.id!=='staff')}).redirectTo,'/explore');
});

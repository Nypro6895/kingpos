import fs from 'node:fs';
// Fail closed if a browser-only fixture unexpectedly invokes an unmocked server action.
export function browserServerBoundary(){return{name:'browser-server-boundary',setup(b){
 b.onResolve({filter:/^next\/image$/},()=>({path:'image',namespace:'browser-boundary'}));
 b.onLoad({filter:/.*/,namespace:'browser-boundary'},()=>({loader:'tsx',contents:"import React from'react';export default function Image({unoptimized,priority,fill,...p}){return <img {...p}/>}",resolveDir:process.cwd()}));
 b.onLoad({filter:/\.tsx?$/},({path})=>{const s=fs.readFileSync(path,'utf8');if(!/^\s*['"]use server['"]/.test(s))return;const names=[...s.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(m=>m[1]);return{contents:names.map(n=>'export async function '+n+'(){throw Error("Unmocked server action: '+n+'")}').join('\n'),loader:'js'};});
}}}

import path from 'node:path';
import {createRequire}from'node:module';
import {execFileSync}from'node:child_process';
import fs from'node:fs';
const require=createRequire(import.meta.url),mode=process.argv[2],source=process.argv[3];
if(!['bundle','production-check'].includes(mode)||!source)throw Error('Usage: node scripts/with-app-local-public-config.mjs bundle|production-check <configuration-project>');
const inherited={...process.env};
const publicKeys=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','NEXT_PUBLIC_MAPTILER_KEY','NEXT_PUBLIC_BOOKING_STRIPE_PUBLISHABLE_KEY'];
let approved;
if(source.endsWith('.json')){
 approved=JSON.parse(fs.readFileSync(path.resolve(source),'utf8'));
 if(!approved||Object.keys(approved).some(key=>!publicKeys.includes(key))||Object.values(approved).some(value=>typeof value!=='string'))throw Error('Expected an explicit public-only configuration file');
}else{
 require('@next/env').loadEnvConfig(path.resolve(source),false,{info(){},error(){}});
 approved=Object.fromEntries(publicKeys.map(key=>[key,process.env[key]??'']));
}
// Configuration-project credentials stay in this process; only already-public
// client settings are forwarded to the build child. Never serialize env files.
const env={...inherited,...Object.fromEntries(publicKeys.map(key=>[key,approved[key]??''])),KINGPOS_DISABLE_BACKGROUND_DISPATCH:'1'};
console.log(JSON.stringify({mode,publicConfiguration:Object.fromEntries(publicKeys.map(key=>[key,Boolean(env[key])]))}));
if(mode==='bundle')execFileSync(process.execPath,['scripts/build-app-local-bundle.mjs',...(process.argv[4]==='--activate'?['--activate']:[])],{env,stdio:'inherit'});
else{
 env.KINGPOS_BUILD_OUTPUT='.next-app-local-check';
 execFileSync(process.execPath,[require.resolve('next/dist/bin/next'),'build','--webpack'],{env,stdio:'inherit'});
 execFileSync(process.execPath,['scripts/build-offline-assets.mjs'],{env,stdio:'inherit'});
}

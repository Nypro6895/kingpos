import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read the existing alias through the authenticated Vercel CLI; never promote it. */
export function readProductionAlias({ spawnProcess=spawn, platform=process.platform }={}) {
 return new Promise((resolveAlias,reject)=>{
  const args=platform==='win32'
   ? ['-NoProfile','-NonInteractive','-Command',"npx vercel api '/v4/aliases/reylumi.com' --raw"]
   : ['vercel','api','/v4/aliases/reylumi.com','--raw'];
  const child=spawnProcess(platform==='win32'?'powershell.exe':'npx',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('Production alias verification timed out.'));},30_000);
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>1_000_000){child.kill();reject(new Error('Production alias response exceeded its limit.'));}});
  // Consume diagnostics without exposing account information or credentials.
  child.stderr.on('data',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(new Error('The Vercel CLI could not read the production alias.'));});
  child.on('close',code=>{
   clearTimeout(timer);
   if(code!==0){reject(new Error('The Vercel CLI could not read the production alias.'));return;}
   try{resolveAlias(JSON.parse(output.replace(/^\uFEFF/,'')));}catch{reject(new Error('The production alias response was not valid JSON.'));}
  });
 });
}
export async function verifyProductionBase(expectedDeploymentId,{readAlias=readProductionAlias}={}) {
 if(!/^dpl_[A-Za-z0-9]+$/.test(expectedDeploymentId??''))throw new Error('Usage: node scripts/verify-production-base.mjs <expected deployment ID>');
 const alias=await readAlias();
 const actual=alias?.deploymentId??alias?.deployment?.id;
 if(alias?.alias!=='reylumi.com'||!/^dpl_[A-Za-z0-9]+$/.test(actual??'')||alias?.deployment?.id&&alias.deployment.id!==actual)throw new Error('The production alias did not identify one current deployment.');
 if(actual!==expectedDeploymentId)throw new Error(`Production changed: expected ${expectedDeploymentId}, found ${actual}. Refresh the production source baseline before deploying.`);
 return actual;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try{console.log(`Production baseline verified: ${await verifyProductionBase(process.argv[2])}`);}catch(error){console.error(error.message);process.exitCode=1;}
}

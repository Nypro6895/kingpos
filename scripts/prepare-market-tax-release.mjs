import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const root=process.cwd(),deployment=process.argv[2];
if(!/^dpl_[A-Za-z0-9]+$/.test(deployment??''))throw Error('Supply the captured production deployment.');
const manifest=JSON.parse(await fs.readFile(path.join(root,'artifacts',`market-tax-base-${deployment}`,'source-manifest.json'),'utf8'));
const source=manifest.sourceDirectory,target=path.join(root,'artifacts',`market-tax-release-${deployment}`);
if(path.resolve(source)===path.resolve(target))throw Error('The release must be separate from the baseline.');
await fs.mkdir(target,{recursive:true});await fs.cp(source,target,{recursive:true,force:true});
const changed=['lib/market-card.ts','app/market/card-payment-actions.ts','app/market/card-checkout-panel.tsx','app/market/market-client.tsx','app/(app)/market/page.tsx','app/(app)/admin/market/system-actions.ts','app/(app)/admin/market/system-workspace.tsx','app/api/payments/reconcile/route.ts'];
const added=['lib/market-tax.ts','types/market-tax.ts','app/(app)/admin/market/tax/page.tsx','app/(app)/admin/market/tax/actions.ts','app/(app)/admin/market/tax/tax-workspace.tsx','app/(app)/admin/market/tax/export/route.ts','supabase/migrations/20261011010001_market_automatic_tax.sql'];
const sha=(b)=>createHash('sha256').update(b).digest('hex'),overlays=[];
for(const file of changed){
 const ours=path.join(root,file),theirs=path.join(source,file),out=path.join(target,file);
 let before=path.join(root,'artifacts','market-tax-before',file+'.txt');
 // The checkout action was changed by the tax delegate; its original production hash was verified when captured.
 if(file==='app/market/card-payment-actions.ts'){before=theirs;if(sha(await fs.readFile(theirs))!=='c6cd1da7bbf21626aabc98a1e87e319a2c358995bc5f959599b3f6c94254d955')throw Error('Checkout source changed since its verified baseline.');}
 const base=await fs.readFile(before),current=await fs.readFile(ours),production=await fs.readFile(theirs);
 let merged=current;
 const normalized=(bytes)=>bytes.toString().replaceAll('\r\n','\n').trimEnd()+'\n';
 if(normalized(base)!==normalized(production)){
  if(file==='app/market/market-client.tsx'){
   const replacements=[['export function MarketClient({ cardReady = false,','export function MarketClient({ automaticTax, cardReady = false,'],['{ cardReady?: boolean;',"{ automaticTax?: {enabled:boolean;price_behavior:'inclusive'|'exclusive'}; cardReady?: boolean;"],['<BankCheckoutPanel key={selected.id}','<BankCheckoutPanel automaticTax={automaticTax} key={selected.id}']];
   const apply=(text)=>{for(const [old,next] of replacements){if(text.split(old).length!==2)throw Error(`The customer tax prop needs source review in ${file}.`);text=text.replace(old,next);}return text;};
   if(apply(base.toString())!==current.toString())throw Error('Unexpected local Market client changes since the tax source snapshot.');merged=Buffer.from(apply(production.toString()));
  }else if(file==='app/(app)/market/page.tsx'){
   const replacements=[['import {paymentConfig} from "@/lib/platform-payment";','import {paymentConfig} from "@/lib/platform-payment";\nimport {marketTaxCheckoutSettings} from "@/lib/market-tax";'],['  const cardConfig = await paymentConfig().catch(() => null);','  const cardConfig = await paymentConfig().catch(() => null);\n  const automaticTax = await marketTaxCheckoutSettings().catch(() => undefined);'],['return <MarketClient cardReady=','return <MarketClient automaticTax={automaticTax} cardReady=']];
   const apply=(text)=>{text=text.replaceAll('\r\n','\n');for(const [old,next] of replacements){if(text.split(old).length!==2)throw Error(`The tax pricing display needs source review in ${file}.`);text=text.replace(old,next);}return text;};
   if(apply(base.toString())!==current.toString().replaceAll('\r\n','\n'))throw Error('Unexpected local Market page changes since the tax source snapshot.');merged=Buffer.from(apply(production.toString()));
  }else{const mergeDir=path.join(root,'artifacts','market-tax-merge');await fs.mkdir(mergeDir,{recursive:true});const temp=['ours','before','production'].map(name=>path.join(mergeDir,name+'.txt'));for(const [i,bytes] of [current,base,production].entries())await fs.writeFile(temp[i],normalized(bytes));const result=spawnSync('git',['merge-file','--stdout',...temp],{encoding:null,maxBuffer:10000000,windowsHide:true});if(result.status!==0)throw Error(`Resolve the production source conflict in ${file} before releasing.`);merged=result.stdout;}
 }
 await fs.writeFile(out,merged);overlays.push({file,baselineSha256:sha(production),beforeSha256:sha(base),sourceSha256:sha(current),sha256:sha(merged)});
}
for(const file of added){const out=path.join(target,file);try{await fs.access(path.join(source,file));throw Error(`New task file already exists in production: ${file}`);}catch(error){if(error.code!=='ENOENT')throw error;}await fs.mkdir(path.dirname(out),{recursive:true});const bytes=await fs.readFile(path.join(root,file));await fs.writeFile(out,bytes);overlays.push({file,baselineSha256:null,sha256:sha(bytes)});}
async function walk(dir,prefix=''){let result=[];for(const item of await fs.readdir(dir,{withFileTypes:true})){if(['node_modules','.next','.vercel'].includes(item.name)||item.name.startsWith('.env')&&item.name!=='.env.example')continue;const name=prefix?prefix+'/'+item.name:item.name;result.push(...(item.isDirectory()?await walk(path.join(dir,item.name),name):[name]));}return result;}
const sourceFiles=(await walk(source)).sort(),allFiles=(await walk(target)).sort(),allowed=new Set(overlays.map(x=>x.file));
for(const file of sourceFiles)if(!allowed.has(file)&&sha(await fs.readFile(path.join(source,file)))!==sha(await fs.readFile(path.join(target,file))))throw Error(`Unrelated production source changed: ${file}`);
const protectedFiles=[...sourceFiles.filter(f=>f.startsWith('lib/location/')||f.startsWith('lib/explore-')||f.startsWith('app/api/explore/')||f.startsWith('app/explore/')||f.startsWith('app/(app)/explore/'))];
for(const file of protectedFiles)if(sha(await fs.readFile(path.join(source,file)))!==sha(await fs.readFile(path.join(target,file))))throw Error(`Explore source changed: ${file}`);
const aggregate=async(dir,files)=>sha(Buffer.from((await Promise.all(files.map(async file=>`${file}\t${sha(await fs.readFile(path.join(dir,file)))}`))).join('\n')+'\n'));
const receipt={baselineDeployment:deployment,baselineSourceSha256:manifest.aggregateSha256,releaseDirectory:target,assembledSourceSha256:await aggregate(target,allFiles),overlaySha256:sha(Buffer.from(overlays.map(f=>`${f.file}\t${f.sha256}`).sort().join('\n')+'\n')),overlays,sourceFiles:allFiles.length,explorePreserved:protectedFiles,automaticTaxInitiallyEnabled:false,registrationChanges:'none',preparedAt:new Date().toISOString()};
await fs.writeFile(path.join(root,'artifacts','market-tax-release-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({releaseDirectory:target,overlays:overlays.length,files:allFiles.length,explorePreserved:protectedFiles.length,baseline:deployment}));

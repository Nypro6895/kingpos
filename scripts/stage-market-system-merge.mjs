import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const receipt=JSON.parse(await fs.readFile('work/market-system-release-receipt.json','utf8'));
const tree=JSON.parse((await fs.readFile('work/market-system-baseline-files.json','utf8')).replace(/^\uFEFF/,''));
const auth=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'com.vercel.cli/Data/auth.json'),'utf8'));
const hash=v=>createHash('sha256').update(v).digest('hex');
const uids={};function walk(nodes,p=''){for(const n of nodes){const q=path.posix.join(p,n.name);if(n.children)walk(n.children,q);else if(n.type==='file')uids[q.replace(/^src\//,'')]=n.uid;}}walk(tree);
const results=[];
for(const entry of receipt.overlays){
 const file=entry.file,target=path.join('work/market-system-merge',file);await fs.mkdir(path.dirname(target),{recursive:true});const overlay=await fs.readFile(path.join(receipt.releaseDirectory,file));
 const current=await fs.readFile(file).catch(()=>null);let status,merged=overlay;
 if(!current)status='new';else if(hash(current)===entry.sha256)status='already present';else if(hash(current)===entry.baseline)status='clean baseline';else if(!entry.baseline)status='conflict new file';else{
  const r=await fetch(`https://api.vercel.com/v7/deployments/${receipt.baselineDeployment}/files/${uids[file]}`,{headers:{Authorization:`Bearer ${auth.token}`}});if(!r.ok)throw Error('Baseline source fetch failed');const payload=await r.json();const base=Buffer.from(payload.data,'base64');if(hash(base)!==entry.baseline)throw Error('Baseline hash mismatch');const basePath=path.join('work/market-system-base',file);await fs.mkdir(path.dirname(basePath),{recursive:true});await fs.writeFile(basePath,base);
  const currentPath=path.join('work/market-system-normalized-current',file),incomingPath=path.join('work/market-system-normalized-incoming',file);await fs.mkdir(path.dirname(currentPath),{recursive:true});await fs.mkdir(path.dirname(incomingPath),{recursive:true});await fs.writeFile(currentPath,current.toString().replaceAll('\r\n','\n'));await fs.writeFile(incomingPath,overlay.toString().replaceAll('\r\n','\n'));await fs.writeFile(basePath,base.toString().replaceAll('\r\n','\n'));
  const process=spawnSync('git',['merge-file','-p',currentPath,basePath,incomingPath],{encoding:'buffer',windowsHide:true,maxBuffer:10000000});if(process.status===null||process.status<0||process.status>127)throw Error('Merge failed: '+file);merged=process.stdout;status=process.status>0?'conflict':'merged';
 }
 await fs.writeFile(target,merged);results.push({file,status,previousSha256:current?hash(current):null,mergedSha256:hash(merged)});
}
await fs.writeFile('work/market-system-local-merge.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({file,status})=>({file,status})),null,2));

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,runtime} from './common.mjs';
fs.mkdirSync(path.join(runtime,'supabase/migrations'),{recursive:true});
const mapping=fs.readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort().map((original,index)=>{
 const bytes=fs.readFileSync(path.join(root,'supabase/migrations',original));
 const version=new Date(Date.UTC(2000,0,1,0,0,index+1)).toISOString().replace(/[-:T]/g,'').slice(0,14);
 return {original,generated:version+'_'+original,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),content:bytes.toString().replaceAll('\r\n','\n')};
});
const existingPath=path.join(runtime,'migration-map.json');
if(fs.existsSync(existingPath)){
 const previous=JSON.parse(fs.readFileSync(existingPath));
 if(previous.some(p=>p.sha256)&&JSON.stringify(previous.map(({original,sha256})=>({original,sha256})))!==JSON.stringify(mapping.map(({original,sha256})=>({original,sha256}))))throw Error('Source migrations changed; preserve runtime and create a new QA project');
}
for(const item of mapping)fs.writeFileSync(path.join(runtime,'supabase/migrations',item.generated),item.content);
fs.copyFileSync(path.join(root,'qa/local/config.toml'),path.join(runtime,'supabase/config.toml'));
fs.writeFileSync(existingPath,JSON.stringify(mapping.map(({original,generated,sha256})=>({original,generated,sha256})),null,2)+'\n');
console.log('Prepared '+mapping.length+' QA-only migrations in original lexical order; LF-normalized with unique local versions.');

import fs from 'node:fs';import path from 'node:path';import{createHash}from'node:crypto';
import {fileURLToPath} from 'node:url';
export function applyNameAdapters({source,target,manifest}){
 const prepared=[];
 for(const item of manifest.files){
  if(path.isAbsolute(item.file)||item.file.split(/[\\/]/).includes('..'))throw Error('Unsafe adapter path');
  let text=fs.readFileSync(path.join(source,item.file),'utf8');
  if(createHash('sha256').update(text).digest('hex')!==item.sha256)throw Error(`Source drift: rebase reviewed salon identity edits for ${item.file}`);
  for(const edit of item.edits){if(text.slice(edit.start,edit.end)!==edit.before)throw Error('Adapter context mismatch: '+item.file);text=text.slice(0,edit.start)+edit.after+text.slice(edit.end);}
  prepared.push({file:item.file,text});
 }
 for(const item of prepared){const file=path.resolve(target,item.file);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,item.text);}
 return prepared.map(p=>p.file);
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 const source=process.argv[2],target=process.argv[3];if(!source||!target||path.resolve(source)===path.resolve(target))throw Error('Provide separate source and candidate directories.');
 const files=applyNameAdapters({source,target,manifest:JSON.parse(fs.readFileSync('docs/membership/salon-name-adapters.json','utf8'))});console.log(`Applied ${files.length} reviewed salon identity adapters to ${target}`);
}

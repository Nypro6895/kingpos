import{ESLint}from'eslint';import fs from'node:fs';import path from'node:path';
const canonical='C:/Reylumi/kingpos',manifest=JSON.parse(fs.readFileSync('docs/membership/salon-name-adapters.json','utf8')),linter=new ESLint({cwd:canonical});
const errors=[];let baseline=0,candidate=0;
for(const item of manifest.files.filter(f=>f.file.endsWith('.tsx'))){
 const filePath=path.join(canonical,item.file),original=fs.readFileSync(filePath,'utf8'),changed=fs.readFileSync(path.join('artifacts/member-everywhere/candidate',item.file),'utf8'),[before]=await linter.lintText(original,{filePath}),[after]=await linter.lintText(changed,{filePath});
 // React compiler messages embed numbered source excerpts. Match the unchanged
 // offending source line rather than mistaking import-line shifts for a new defect.
 const key=(m,text)=>JSON.stringify([m.ruleId,m.message.split('\n\n')[0],text.split(/\r?\n/)[m.line-1]?.trim()]),seen=new Map();for(const m of before.messages.filter(m=>m.severity===2)){const k=key(m,original);seen.set(k,(seen.get(k)??0)+1);}baseline+=before.errorCount;candidate+=after.errorCount;
 for(const m of after.messages.filter(m=>m.severity===2)){const k=key(m,changed),remaining=seen.get(k)??0;if(remaining)seen.set(k,remaining-1);else errors.push({file:item.file,line:m.line,rule:m.ruleId,message:m.message});}
}
const receipt={baselineErrors:baseline,candidateErrors:candidate,newErrors:errors};fs.writeFileSync('artifacts/member-everywhere/lint-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));if(errors.length)process.exitCode=1;

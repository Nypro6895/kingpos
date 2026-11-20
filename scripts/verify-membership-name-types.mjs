import ts from 'typescript';import fs from'node:fs';import path from'node:path';
const canonical='C:/Reylumi/kingpos',root=process.cwd(),manifest=JSON.parse(fs.readFileSync('docs/membership/salon-name-adapters.json','utf8'));
const parsed=ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(canonical,'tsconfig.json'),ts.sys.readFile).config,ts.sys,canonical);
const featureFiles=['components/salon-member-badge.tsx','lib/salon-member-store.ts','app/api/membership/salon-badges/route.ts'];
const options={...parsed.options,incremental:false,paths:{'@/components/salon-member-badge':[path.join(root,'components/salon-member-badge.tsx')],'@/lib/salon-member-store':[path.join(root,'lib/salon-member-store.ts')],'@/*':[canonical+'/*']}};
const roots=[...manifest.files.filter(f=>/\.tsx?$/.test(f.file)).map(f=>path.join(canonical,f.file)),...featureFiles.map(f=>path.join(root,f))];
const normalize=p=>path.resolve(p).replaceAll('\\','/').toLowerCase();
const overlay=new Map(manifest.files.map(f=>[normalize(path.join(canonical,f.file)),fs.readFileSync(path.join(root,'artifacts/member-everywhere/candidate',f.file),'utf8')]));
function check(transformed){const host=ts.createCompilerHost(options);const read=host.readFile.bind(host);if(transformed)host.readFile=file=>overlay.get(normalize(file))??read(file);const program=ts.createProgram(roots,options,host);return ts.getPreEmitDiagnostics(program).map(d=>({file:d.file?path.relative(canonical,d.file.fileName).replaceAll('\\','/'):'config',code:d.code,message:ts.flattenDiagnosticMessageText(d.messageText,' '),line:d.file?d.file.getLineAndCharacterOfPosition(d.start??0).line+1:null}));}
const before=check(false),after=check(true),key=d=>JSON.stringify([d.file,d.code,d.message]),baseline=new Set(before.map(key)),newErrors=after.filter(d=>!baseline.has(key(d)));
const featureErrors=after.filter(d=>featureFiles.some(f=>normalize(path.join(canonical,d.file))===normalize(path.join(root,f))));
const receipt={baselineDiagnostics:before.length,candidateDiagnostics:after.length,newErrors,featureErrors,files:manifest.files.length};fs.writeFileSync('artifacts/member-everywhere/type-receipt.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));if(newErrors.length||featureErrors.length)process.exitCode=1;

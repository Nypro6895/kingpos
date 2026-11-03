
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{execFileSync}from'node:child_process';
import {readJournal,pendingChanges} from './release-journal.mjs';
const out=path.resolve('artifacts/combined-deploy-queue-20261103'),startedAt=new Date().toISOString();
fs.mkdirSync(out,{recursive:true});
const all=readJournal(),pending=pendingChanges(),byId=new Map(all.map(e=>[e.id,e])),latest=new Map();
for(const e of all)if(e.kind==='change')latest.set(e.changeId,e);
const worktrees=JSON.parse(fs.readFileSync(path.join(out,'worktrees.json'),'utf8'));
for(const row of worktrees.worktrees.filter(r=>r.errors?.length)){
 const run=args=>execFileSync('git',['-c','safe.directory='+row.root,...args],{cwd:row.root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
 try{row.trackedChanges=run(['status','--porcelain=v1','-z','--untracked-files=no']).split('\0').filter(Boolean);row.untracked=run(['ls-files','--others','--exclude-standard','-z']).split('\0').filter(Boolean);const[commit,committedAt,...subject]=run(['log','-1','--format=%H%n%cI%n%s']).trim().split('\n');Object.assign(row,{commit,committedAt,subject:subject.join('\n'),errors:[],readOnlyOwnershipRetry:true});}catch{row.errors=['Git state could not be read with a command-scoped ownership exception. No persistent configuration changed.'];}
}
fs.writeFileSync(path.join(out,'worktrees.json'),JSON.stringify(worktrees,null,2));
const rootList=worktrees.worktrees.map(w=>w.root).filter(p=>fs.existsSync(p)).map(p=>fs.realpathSync(p).toLowerCase());
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const bundleRoot=path.join(out,'sources-'+startedAt.replace(/[:.]/g,'-'));fs.mkdirSync(bundleRoot,{recursive:true});
const safe=f=>typeof f==='string'&&!path.isAbsolute(f)&&!f.split(/[\\/]/).some(s=>s==='..'||!s)&&!/^(\.git|node_modules|\.next|\.vercel)([\\/]|$)/.test(f)&&!f.split(/[\\/]/).some(s=>/^\.env/.test(s)&&s!=='.env.example')&&!/\.(p12|p8|pfx|key|mobileprovision)$/i.test(f);
const rows=[];let copiedFiles=0,copiedBytes=0;
for(const e of pending){
 const original=byId.get(e.eventId),raw=e.source?.snapshot;
 const source=typeof raw==='string'?path.isAbsolute(raw)?path.normalize(raw):path.resolve(original.worktree,raw):null;
 const row={...e,worktree:original.worktree,notes:original.notes??null,sourcePath:source,sourceKind:!source?'absent':!fs.existsSync(source)?'missing':fs.statSync(source).isDirectory()?'directory':'archive-or-file',issues:[],observedHashes:{},copiedFiles:[],sourceVerified:false,validationPending:e.validation.filter(v=>v.result!=='passed'),deploymentTargetReview:/nails-pilot|facebook-nails|lumisocial/.test(e.changeId)?'external plugin/service; do not mix into KingPOS web by assumption':'confirm against production source at integration'};
 if(['working','blocked'].includes(e.status)){row.queueClass='hold-'+e.status;row.issues.push('Not a completed releasable change.');rows.push(row);continue;}
 if(row.sourceKind!=='directory'){row.queueClass='source-unresolved';row.issues.push('Declared source is '+row.sourceKind+'; source files were not guessed from another checkout.');rows.push(row);continue;}
 const actualRoot=fs.realpathSync(source),mutable=rootList.includes(actualRoot.toLowerCase());row.mutableWorktreeSource=mutable;
 if(mutable)row.issues.push('Declared snapshot is a mutable registered worktree, not an immutable frozen source.');
 if(e.status==='ready'&&!e.fileHashes)row.issues.push('Ready event has no frozen file hashes.');
 for(const f of e.files){
  if(!safe(f)){row.issues.push('Excluded unsafe or private artifact path: '+f);continue;}
  const absolute=path.resolve(actualRoot,f);
  if(!absolute.startsWith(actualRoot+path.sep)){row.issues.push('Source path escapes snapshot: '+f);continue;}
  const deletion=e.deletedFiles.includes(f);
  if(deletion){if(fs.existsSync(absolute))row.issues.push('Declared deletion still exists: '+f);row.observedHashes[f]=null;continue;}
  if(!fs.existsSync(absolute)||!fs.statSync(absolute).isFile()){row.issues.push('Declared file missing: '+f);continue;}
  const actual=fs.realpathSync(absolute);
  if(!actual.toLowerCase().startsWith((actualRoot+path.sep).toLowerCase())){row.issues.push('Symlink escapes source: '+f);continue;}
  const bytes=fs.readFileSync(actual),digest=hash(bytes);row.observedHashes[f]=digest;
  if(e.fileHashes&&e.fileHashes[f]!==digest){row.issues.push('Frozen hash mismatch: '+f);continue;}
  const dest=path.join(bundleRoot,e.eventId,f);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes,{flag:'wx'});row.copiedFiles.push(f);copiedFiles++;copiedBytes+=bytes.length;
 }
 row.sourceVerified=!row.issues.length&&e.files.length>0&&Object.keys(row.observedHashes).length===e.files.length;
 row.bundlePath=path.join(bundleRoot,e.eventId);
 row.queueClass=e.status==='ready'&&row.sourceVerified?'ready-snapshot-verified':row.issues.length?'needs-source-repair':'needs-integration-validation';
 rows.push(row);
}
const overlaps=new Map();
for(const r of rows.filter(r=>!r.queueClass.startsWith('hold')))for(const f of r.files){if(!overlaps.has(f))overlaps.set(f,[]);overlaps.get(f).push(r.eventId)}
const conflictFiles=[...overlaps].filter(([,ids])=>ids.length>1).map(([file,eventIds])=>({file,eventIds,distinctAvailableHashes:[...new Set(rows.filter(r=>eventIds.includes(r.eventId)).map(r=>r.observedHashes[file]).filter(Boolean))].length}));
const pendingByChange=new Map(rows.map(r=>[r.changeId,r]));
for(const r of rows){r.dependencyStates=(r.dependencies??[]).map(id=>{const p=pendingByChange.get(id),l=latest.get(id);return {changeId:id,state:p?p.queueClass:l?'not-pending-in-journal':'not-found',eventId:p?.eventId??l?.id??null}});r.overlappingFiles=conflictFiles.filter(c=>c.eventIds.includes(r.eventId)).map(c=>c.file);}
const statuses={},classes={};for(const r of rows){statuses[r.status]=(statuses[r.status]??0)+1;classes[r.queueClass]=(classes[r.queueClass]??0)+1;}
const releases=all.filter(e=>e.kind==='release').map(e=>({id:e.id,recordedAt:e.recordedAt,summary:e.summary,changes:e.changes,targets:e.targets}));
const coverage=worktrees.worktrees.map(w=>{const related=all.filter(e=>e.worktree&&path.resolve(e.worktree).toLowerCase()===path.resolve(w.root).toLowerCase());return {root:w.root,head:w.head,branch:w.branch,trackedChanges:w.trackedChanges?.length??0,untracked:w.untracked?.length??0,errors:w.errors??[],journalEvents:related.length,pendingEvents:rows.filter(e=>e.worktree&&path.resolve(e.worktree).toLowerCase()===path.resolve(w.root).toLowerCase()).map(e=>e.eventId),unregisteredLocalWorkCandidate:(!related.length)&&(Boolean(w.trackedChanges?.length)||Boolean(w.untracked?.length)),notes:'Dirty/untracked files and local commits are preserved; ownership and release intent are not inferred from Git state.'}});
const summary={capturedAt:new Date().toISOString(),startedAt,worktrees:coverage.length,dirtyWorktrees:coverage.filter(w=>w.trackedChanges||w.untracked).length,gitReadErrors:coverage.filter(w=>w.errors.length).length,unregisteredDirtyWorktreeCandidates:coverage.filter(w=>w.unregisteredLocalWorkCandidate).length,pendingEvents:rows.length,pendingChangeIds:new Set(rows.map(r=>r.changeId)).size,statuses,classes,channels:{web:rows.filter(r=>r.pendingChannels.includes('web')).length,ios:rows.filter(r=>r.pendingChannels.includes('ios')).length},copiedFiles,copiedBytes,overlappingFilePaths:conflictFiles.length,conflictingAvailableHashPaths:conflictFiles.filter(c=>c.distinctAvailableHashes>1).length,verifiedReleaseReceipts:releases.filter(r=>Object.values(r.targets).some(t=>t.verified)).length,productionAliasCaptured:false,assembledBuild:false,deployed:false};
fs.writeFileSync(path.join(out,'queue-manifest.json'),JSON.stringify({schema:1,purpose:'Combined deploy queue consolidation; not a publication receipt or assembled release',summary,bundleRoot,entries:rows,overlaps:conflictFiles,worktreeCoverage:coverage,releaseReceipts:releases},null,2));
fs.writeFileSync(path.join(out,'pending.json'),JSON.stringify(pending,null,2));
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
process.stdout.write(JSON.stringify({summary,sourceIssues:rows.filter(r=>r.issues.length&&!r.queueClass.startsWith('hold')).map(r=>({id:r.changeId,class:r.queueClass,issues:r.issues.slice(0,2)})),ready:rows.filter(r=>r.queueClass==='ready-snapshot-verified').map(r=>r.changeId)},null,2));

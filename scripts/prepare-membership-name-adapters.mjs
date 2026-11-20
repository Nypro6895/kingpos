// Produces a scoped, reviewable source patch against the current shared checkout.
// Does not mutate that checkout. Run audit-salon-name-surfaces.mjs first.
import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';import {createHash}from'node:crypto';
const base='C:/Reylumi/kingpos', files=new Map(), coverage=[];
const digest=s=>createHash('sha256').update(s).digest('hex');
const load=file=>{if(!files.has(file))files.set(file,{file,source:fs.readFileSync(path.join(base,file),'utf8'),edits:[],imports:new Set()});return files.get(file);};
function edit(file,start,end,after,reason){const f=load(file);f.edits.push({start,end,before:f.source.slice(start,end),after,reason});}
function replace(file,before,after,reason,all=false){const f=load(file);let index=f.source.indexOf(before),count=0;while(index>=0){edit(file,index,index+before.length,after,reason);count++;if(!all)break;index=f.source.indexOf(before,index+before.length);}if(!count)throw Error(`Missing ${reason} in ${file}`);}
function imports(file,...names){names.forEach(n=>load(file).imports.add(n));}
const rows=JSON.parse(fs.readFileSync('artifacts/member-everywhere/inventory.json','utf8'));
const currentFiles=['app/bookings/booking-workspace-client.tsx','app/(app)/payroll/tax-company/settings/page.tsx','app/reports/operational-report-dashboard.tsx','app/pos/portable/book/booking-editor.tsx','app/pos/portable/portable-workspace-tabs.tsx','app/(app)/salon-profile/client-transformations/page.tsx','app/staff/today/today-dashboard-view.tsx'];
for(const row of rows){
 let attributes=row.id?`${row.via==='href'?'href':'salonId'}={${row.id}}`:null,exception;
 if(!attributes){
  if(currentFiles.includes(row.file))attributes='currentSalon';
  else if(row.name==='invite.salonName')attributes='reference={{kind:"invitation",value:invite.id}}';
  else if(row.file==='app/(app)/claim/customer/page.tsx')attributes='reference={{kind:"claim",value:token}}';
  else if(row.file==='app/(app)/notifications/visits/[visitId]/page.tsx')attributes='reference={{kind:"visit",value:visitId}}';
  else if(row.file==='app/(app)/pos-tickets/[ticketId]/page.tsx')attributes='salonId={context.currentSalon?.id}';
  else if(row.file==='app/explore/explore-feed.tsx')attributes='salonId={item.salon?.id}';
  else if(row.file==='app/(app)/explore/looks/[lookId]/page.tsx')attributes='href={look.bookingHref}';
  else if(row.file==='app/pos/customer-display/customer-idle-screen.tsx'||row.file==='app/pos/customer-display/checkin-receipt-panel.tsx')attributes='reference={{kind:"display",value:token}}';
  else if(row.file==='app/pos/customer-display/customer-display-client.tsx')attributes='';
  else if(row.file==='app/pos/pos-desk-client.tsx')attributes='salonId={staffRealtimeSalonId} currentSalon';
  else if(row.file==='app/support/support-ui.tsx')attributes='salonId={typeof c.context.salon_id==="string"?c.context.salon_id:null}';
  else if(row.file==='app/check-in/[entry]/phone-checkin.tsx')attributes='reference={{kind:"entry",value:entry}}';
  else if(row.file==='app/signup/phone/signup-phone-form.tsx'){attributes='';exception='Pre-auth phone-history labels intentionally omit canonical salon IDs; cannot grant affiliation from a name.';}
  else throw Error(`Unresolved ${row.file}:${row.line}`);
 }
 edit(row.file,row.start,row.end,`<SalonName name={${row.name}} ${attributes}/>`,exception??'Canonical salon name and affiliation');imports(row.file,'SalonName');coverage.push({...row,attributes,...(exception?{exception}:{})});
}
// Shared post identity keeps personal authors unmarked and attaches affiliation
// only to the salon destination or salon attribution, using its canonical link.
{
 const file='components/post-identity.tsx';imports(file,'SalonName');
 replace(file,'{name(identity.primaryName, identity.primaryHref)}','{identity.salonPrimary ? nameWithMember(identity.primaryName, identity.primaryHref) : name(identity.primaryName, identity.primaryHref)}','Salon publisher identity');
 replace(file,'{name(identity.secondaryName, identity.secondaryHref)}','{!identity.salonPrimary ? nameWithMember(identity.secondaryName, identity.secondaryHref) : name(identity.secondaryName, identity.secondaryHref)}','Salon attribution only');
 replace(file,'  return <span data-post-identity', '  const nameWithMember = (text: string, href?: string | null) => nameNode(<SalonName name={text} href={href}/>, href);\n  function nameNode(node: React.ReactNode, href?: string | null) { return href ? <Link prefetch={false} className="min-w-0" href={href}>{node}</Link> : node; }\n  return <span data-post-identity','Shared salon identity helper');
}
// Role-aware workspace labels must never give a personal/staff name a salon mark.
{
 const file='app/navigation-shell.tsx';imports(file,'SalonName');
 const occurrences=[...load(file).source.matchAll(/<WorkspaceText text=\{label\} \/>/g)];
 if(occurrences.length!==4)throw Error('Review changed navigation label sites');
 occurrences.forEach((m,i)=>edit(file,m.index,m.index+m[0].length,`<WorkspaceMemberName workspace={${i===2?'currentWorkspace':'workspace'}} name={label}/>`, 'Workspace name, desktop/mobile switcher'));
 replace(file,'{currentLabel}','<WorkspaceMemberName workspace={currentWorkspace} name={currentLabel}/>','Current workspace name',true);
 replace(file,'<WorkspaceText text={subtitle} />','<WorkspaceMemberName workspace={workspace} name={subtitle} subtitle/>','Staff salon subtitle',true);
 replace(file,'<WorkspaceText text={isPending ? "Opening..." : subtitle} />','{isPending ? <WorkspaceText text="Opening..."/> : <WorkspaceMemberName workspace={workspace} name={subtitle} subtitle/>}','Switching workspace subtitle',true);
 edit(file,load(file).source.length,load(file).source.length,'\nfunction WorkspaceMemberName({workspace,name,subtitle=false}:{workspace:CurrentWorkspaceOption|null;name:string;subtitle?:boolean}) { const salon=workspace?.type==="salon" && (subtitle?workspace.salonMode==="staff":workspace.salonMode!=="staff"); return salon ? <SalonName name={name} salonId={workspace.salonId}/> : <WorkspaceText text={name}/>; }\n','Role-aware workspace identity');
}
for(const file of ['app/workspace-hub-ui.tsx','app/my-place/my-place-client.tsx']){
 imports(file,'SalonName');
 for(const variable of ['workspace',...(file.includes('hub-ui')?['shortcut.workspace','currentWorkspace']:[])]){
  const before=`<WorkspaceText text={${variable}.label} />`;
  if(load(file).source.includes(before))replace(file,before,`{${variable}.type==="salon"?<SalonName name={${variable}.label} salonId={${variable}.salonId}/>:<WorkspaceText text={${variable}.label}/>}`,'Salon list and quick-workspace identity',true);
 }
}
{
 const file='app/my-place/place-panels.tsx';imports(file,'SalonName');replace(file,'title={details?.salon.name ?? workspace.label}','title={<SalonName name={details?.salon.name ?? workspace.label} salonId={workspace.salonId}/>}','Salon settings drawer identity');
 const shared='app/my-place/place-ui.tsx',f=load(shared),start=f.source.indexOf('export function Sheet('),index=f.source.indexOf('title: string;',start);edit(shared,index,index+'title: string;'.length,'title: ReactNode;','Keep Sheet text labels and accept salon identity heading');
 const title=f.source.indexOf('<WorkspaceText text={title} />',start);edit(shared,title,title+'<WorkspaceText text={title} />'.length,'{typeof title==="string"?<WorkspaceText text={title}/>:title}','Accessible drawer heading');
}
{
 const file='app/(app)/admin/businesses/[businessId]/page.tsx';imports(file,'SalonName');replace(file,'label={location.name}','label={<SalonName name={location.name} salonId={location.id}/>}','Related business salon identity');
}
// Salon replies are distinct from personal commenter identities.
{
 const file='app/post-comments/post-comment-thread.tsx';imports(file,'SalonName');
 replace(file,'{comment.authorDisplayName}','{comment.isSalonReply && !comment.optimistic ? <SalonName name={comment.authorDisplayName} salonId={comment.actingSalonId ?? comment.salonId}/> : comment.authorDisplayName}','Confirmed salon reply identity');
}
// Inherited authority for descendants whose existing presentation props contain
// a name but intentionally do not carry account/credential fields.
function wrapReturns(file,functionName,attributes){const f=load(file),source=ts.createSourceFile(file,f.source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let count=0;function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===functionName){function body(x){if(x!==n&&ts.isFunctionLike(x))return;if(ts.isReturnStatement(x)&&x.expression){let e=x.expression;while(ts.isParenthesizedExpression(e))e=e.expression;if(ts.isJsxElement(e)||ts.isJsxSelfClosingElement(e)||ts.isJsxFragment(e)){edit(file,e.getStart(source),e.getStart(source),`<SalonIdentityContext ${attributes}>`,'Inherited salon authority');edit(file,e.end,e.end,'</SalonIdentityContext>','Inherited salon authority');count++;}}ts.forEachChild(x,body);}body(n);}else ts.forEachChild(n,walk);}walk(source);if(!count)throw Error('No context roots: '+file);imports(file,'SalonIdentityContext');}
wrapReturns('app/pos/customer-display/customer-display-client.tsx','CustomerDisplayClient','reference={{kind:"display",value:token}}');
{
 const file='app/pos/customer-display/customer-display-client.tsx';replace(file,'{displayName}','<SalonName name={displayName}/>','Customer display salon branding');
}
{
 const file='app/(app)/pos/portable/layout.tsx';imports(file,'SalonIdentityContext');
 replace(file,'<WorkspaceLanguageProvider portableSession','<SalonIdentityContext salonId={session.salon_id}><WorkspaceLanguageProvider portableSession','Portable inherited salon identity');
 replace(file,'</PortableWorkspaceStateProvider></WorkspaceLanguageProvider>','</PortableWorkspaceStateProvider></WorkspaceLanguageProvider></SalonIdentityContext>','Portable inherited salon identity');
}
// Details headings accept React content while existing accessible labels remain strings.
{
 const file='app/(app)/admin/locations/[locationId]/page.tsx';imports(file,'SalonName');replace(file,'title={detail.location.name}','title={<SalonName name={detail.location.name} salonId={detail.location.id}/>}','Admin business title');
 const shared='app/(app)/admin/_components/admin-ui.tsx';const f=load(shared),start=f.source.indexOf('export function AdminPageHeader('),index=f.source.indexOf('title: string;',start);edit(shared,index,index+'title: string;'.length,'title: ReactNode;','Allow accessible salon identity in Admin heading');
}
const manifest={version:1,base,coverage,files:[]};
replace('app/salon-profile/salon-website-header.module.css','.name h2{margin:0;','.name h2{min-width:0;flex:1;margin:0;','Long salon heading yields space without clipping membership marker');
for(const f of files.values()){
 if(f.imports.size){const source=ts.createSourceFile(f.file,f.source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let index=0;for(const stmt of source.statements){if(ts.isExpressionStatement(stmt)&&ts.isStringLiteral(stmt.expression))index=stmt.end;else break;}edit(f.file,index,index,`\nimport { ${[...f.imports].join(', ')} } from "@/components/salon-member-badge";\n`,'Shared compact salon identity import');}
 f.edits.sort((a,b)=>b.start-a.start||b.end-a.end);for(let i=1;i<f.edits.length;i++)if(f.edits[i].end>f.edits[i-1].start)throw Error('Overlapping edit: '+f.file);
 manifest.files.push({file:f.file,sha256:digest(f.source),edits:f.edits});
}
fs.writeFileSync('docs/membership/salon-name-adapters.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify({files:manifest.files.length,directNames:coverage.length,edits:manifest.files.reduce((n,f)=>n+f.edits.length,0)}));

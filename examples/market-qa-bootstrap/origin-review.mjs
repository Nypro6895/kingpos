// Produces an UNAPPLIED review patch. Does not edit owner.ts or enable config.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),owner='lib/market-platform/owner.ts',dir='artifacts/market-qa-origin-prep-20261030';
const hash=x=>createHash('sha256').update(x).digest('hex');
export function proposedOwnerSource(){
 const source=fs.readFileSync(path.join(root,owner),'utf8').replaceAll('\r\n','\n');
 const guard=String.raw`export function platformPublicOrigin() {
  const value = process.env.MARKET_PLATFORM_PUBLIC_ORIGIN ?? "https://reylumi.com";
  if (value !== "https://reylumi.com" && !/^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(value)) throw new PlatformError("Marketplace connection origin is not configured.");
  return value;
}`;
 if(source.split(guard).length!==2)throw Error('Canonical Owner guard changed; re-review patch');
 const proposal=String.raw`export function platformPublicOrigin() {
  const qaMode = process.env.MARKET_QA_ORIGIN_MODE;
  if (qaMode) {
    const reviewed = matchReviewedQaOwnerOrigin(qaOwnerOrigins, process.env.MARKET_PLATFORM_PUBLIC_ORIGIN, { mode: qaMode, providerProjectId: process.env.VERCEL_PROJECT_ID }, Date.now());
    if (!reviewed) throw new PlatformError("Marketplace connection origin is not configured.");
    return reviewed;
  }
  const value = process.env.MARKET_PLATFORM_PUBLIC_ORIGIN ?? "https://reylumi.com";
  if (value !== "https://reylumi.com" && !/^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(value)) throw new PlatformError("Marketplace connection origin is not configured.");
  return value;
}`;
 return 'import qaOwnerOrigins from "@/config/market-owner-qa-origins.json";\nimport { matchReviewedQaOwnerOrigin } from "./qa-owner-origin-contract";\n'+source.replace(guard,proposal);
}
export function writeOriginReview(){
 const output=path.join(root,dir);fs.mkdirSync(output,{recursive:true});const candidate=dir+'/owner.proposed.ts';fs.writeFileSync(path.join(root,candidate),proposedOwnerSource());let patch;
 try{execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'diff','--no-index','--no-ext-diff','--no-textconv','--',owner,candidate],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});throw Error('Expected proposed diff');}catch(e){if(e.status!==1||!e.stdout)throw e;patch=e.stdout;}
 patch=patch.replaceAll('b/'+candidate,'b/'+owner);fs.writeFileSync(path.join(output,'integration.patch'),patch);
 execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'apply','--check',dir+'/integration.patch'],{cwd:root,stdio:['ignore','pipe','pipe']});
 const config=fs.readFileSync(path.join(root,'config/market-owner-qa-origins.json')),parsed=JSON.parse(config);if(parsed.approved!==false||parsed.marketOrigin||parsed.qrOrigin)throw Error('Shipped proposal must remain disabled/empty');
 const receipt={scope:'Unapplied Owner-origin review proposal only; git apply --check, never apply',currentOwnerRawSha256:hash(fs.readFileSync(path.join(root,owner))),proposedSourceSha256:hash(fs.readFileSync(path.join(root,candidate))),patchSha256:hash(patch),configSha256:hash(config),contractSha256:hash(fs.readFileSync(path.join(root,'lib/market-platform/qa-owner-origin-contract.ts'))),defaultApproved:false,originsPopulated:false,runtimeGuardChanged:false,patchApplied:false,networkCalls:0,sourceBaseline:'96fb039'};
 fs.writeFileSync(path.join(output,'patch-evidence.json'),JSON.stringify(receipt,null,2));console.log('Unapplied integration patch generated and --check passed; runtime guard/config stay unchanged and off.');return receipt;
}
export function writeScopeGraph(){
 const source='supabase/migrations/202607240001_account_salon_baseline.sql',raw=fs.readFileSync(path.join(root,source)),text=raw.toString().replaceAll('\r\n','\n');
 const tableGraph=['app_notifications','bookings','customers','staff'].map(name=>{const anchor='create table public.'+name+' (',start=text.indexOf(anchor),end=text.indexOf('\n);',start);if(start<0||end<start)throw Error('Canonical FK graph anchor changed');const sql=text.slice(start,end+3);return {table:name,source,startLine:text.slice(0,start).split('\n').length,rawSourceSha256:hash(raw),statementSha256:hash(sql),references:[...new Set([...sql.matchAll(/references public\.([a-z_]+)/g)].map(m=>m[1]))]};});
 const roots=['lib/account-security.ts','app/(app)/api/auth/login/route.ts','app/(app)/api/auth/mfa/verify/route.ts','app/(app)/api/auth/signup/route.ts','lib/abuse-server.ts','supabase/migrations/202608300001_account_login_security.sql','supabase/migrations/202608110005_beauty_salon_publication_approval.sql','supabase/migrations/202610070008_abuse_prevention.sql','supabase/migrations/20261015190000_signup_admission_retries.sql'];
 const value={scope:'Design/inventory only; no additional DDL/provider mutation or acceptance',optionA:{name:'Existing confirmed QA accounts + nonfinancial Market/QR lifecycle',canReviewNow:['Current canonical context/profile/Owner/action SQL contracts','Mandatory login abuse and required-factor gates; never disable them','Exact-origin validator and unapplied defaultoff patch'],requiresOwnerDecision:['Activate exact QA origin integration with verified resource IDs and immutable review','Separately authorize resources/credentials/DDL/deployment/cleanup','Keep full signup/session/recovery/security acceptance explicitly unverified'],excludes:['Public signup, password/reset/recovery, session recording/revoke assurance','Phone/avatar/deletion/transfer and finance']},optionB:{name:'Full signup/session/account-security acceptance before hosted QA',requiresCanonicalSource:['record_account_login_session + actual notification schema/event-key index and retained booking FK','Selected exact booking/customer/staff table definitions/constraints, no permissive stand-ins','Canonical security mutation policies/grants and provider session behavior','issue_abuse_signup_ticket + updated abuse_guard_signup/Auth trigger and aligned secret configuration','Actual security-check challenge flow, profile self-insert and approved email/provider setup'],notIncludedNow:true},canonicalNotificationFkGraph:tableGraph,sourceHashes:roots.map(file=>({file,sha256:hash(fs.readFileSync(path.join(root,file)))})),resourceGate:'IDs/rights/provisioning/budget/cleanup not yet approved; not a missing-code claim',noActions:['No integration applied','No actual origin/account/Auth binding/key/resource/provider/cloud action','No existing guard or signup/session semantics changed']};
 fs.writeFileSync(path.join(root,dir,'scope-options.json'),JSON.stringify(value,null,2));return value;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){writeOriginReview();writeScopeGraph();}

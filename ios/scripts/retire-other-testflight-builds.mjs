import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {apiURL,createAppleReader,checkAvailability} from './check-testflight-availability.mjs';

export const appId='6821394475';
export const keep={id:'724004b8-8c9c-4998-b52a-f64cce84a726',version:'1.0.0',build:'33'};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const check=(condition,message)=>{if(!condition)throw Error(message);};
const identity=b=>({id:b.id,version:b.version,build:b.build,uploadedDate:b.uploadedDate});
const identities=rows=>JSON.stringify(rows.map(identity).sort((a,b)=>a.id.localeCompare(b.id)));
export async function inventory(read){
  const query=new URLSearchParams({'filter[app]':appId,include:'preReleaseVersion,app','fields[apps]':'bundleId','fields[builds]':'version,uploadedDate,expirationDate,expired,processingState,preReleaseVersion,app','fields[preReleaseVersions]':'version,platform',limit:'200'});
  const data=[],included=[];let next='builds?'+query;
  for(let page=0;next&&page<10;page++){
    check(apiURL(next).pathname==='/v1/builds','Unsupported inventory pagination');
    const result=await read(next);check(Array.isArray(result.data),'Incomplete build inventory');
    data.push(...result.data);included.push(...(result.included??[]));next=result.links?.next;
  }
  check(!next&&data.length<=200,'Build inventory exceeded bounded operation');
  const releases=new Map(included.filter(x=>x.type==='preReleaseVersions').map(x=>[x.id,x.attributes]));
  const rows=data.map(b=>{
    const release=releases.get(b.relationships?.preReleaseVersion?.data?.id);
    check(b.type==='builds'&&uuid.test(b.id)&&b.relationships?.app?.data?.id===appId&&release?.platform==='IOS','Unexpected app, platform or build in inventory');
    check(typeof b.attributes.expired==='boolean'&&Number.isFinite(Date.parse(b.attributes.uploadedDate)),'Incomplete build attributes');
    return {id:b.id,version:release.version,build:b.attributes.version,uploadedDate:b.attributes.uploadedDate,expired:b.attributes.expired,state:b.attributes.processingState,expirationDate:b.attributes.expirationDate};
  });
  check(new Set(rows.map(b=>b.id)).size===rows.length,'Duplicate build identifiers');
  return rows;
}
function requireKeep(rows,now=Date.now()){
  const found=rows.find(b=>b.id===keep.id);
  check(found&&found.version===keep.version&&found.build===keep.build&&!found.expired&&found.state==='VALID'&&Date.parse(found.expirationDate)>now,'Kept build is not valid and installable');
  check(rows.every(b=>Date.parse(b.uploadedDate)<=Date.parse(found.uploadedDate)),'A newer upload exists; stop for review');
  return found;
}
export function makePlan(rows,now=Date.now()){
  requireKeep(rows,now);
  const targets=rows.filter(b=>b.id!==keep.id&&!b.expired);
  check(targets.every(b=>b.state==='VALID'),'Non-valid old build requires review');
  return {appId,keep:{...keep},createdAt:new Date(now).toISOString(),operation:'Expire only exact listed old TestFlight builds; preserve upload history, groups, testers, app metadata and installed source',inventory:structuredClone(rows),targets:targets.map(identity)};
}
export function validatePlan(plan,rows,now=Date.now()){
  check(plan.appId===appId&&JSON.stringify(plan.keep)===JSON.stringify(keep),'Plan app or protected build differs');
  const age=now-Date.parse(plan.createdAt);check(age>=-300000&&age<3600000,'Retirement plan is stale');
  requireKeep(rows,now);
  check(identities(rows)===identities(plan.inventory),'Build inventory changed after review');
  const expected=plan.inventory.filter(b=>b.id!==keep.id&&!b.expired);
  check(identities(expected)===identities(plan.targets)&&new Set(plan.targets.map(b=>b.id)).size===plan.targets.length,'Plan target list differs');
  check(plan.targets.every(b=>uuid.test(b.id)&&b.id!==keep.id),'Protected or invalid build selected');
  check(rows.every(b=>b.id===keep.id||b.expired||plan.targets.some(t=>t.id===b.id)),'An active old build is outside the plan');
}
export function createExpirer(env,allowedIds,fetcher=fetch){
  check(env.APP_STORE_CONNECT_APP_ID===appId,'Wrong Apple app configured');
  const allowed=new Set(allowedIds);check(!allowed.has(keep.id),'Protected build cannot be selected');
  return async id=>{
    check(uuid.test(id)&&allowed.has(id)&&id!==keep.id,'Build is not in reviewed expiration list');
    const now=Math.floor(Date.now()/1000),encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned=encode({alg:'ES256',kid:env.APP_STORE_CONNECT_KEY_ID,typ:'JWT'})+'.'+encode({iss:env.APP_STORE_CONNECT_ISSUER_ID,iat:now,exp:now+300,aud:'appstoreconnect-v1'});
    const jwt=unsigned+'.'+crypto.sign('sha256',Buffer.from(unsigned),{key:env.APP_STORE_CONNECT_PRIVATE_KEY,dsaEncoding:'ieee-p1363'}).toString('base64url');
    const response=await fetcher('https://api.appstoreconnect.apple.com/v1/builds/'+id,{method:'PATCH',redirect:'error',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:JSON.stringify({data:{type:'builds',id,attributes:{expired:true}}}),signal:AbortSignal.timeout(30000)});
    check(response.ok,'Apple expiration request failed: '+response.status);
    const result=await response.json();check(result.data?.id===id&&result.data?.attributes?.expired===true,'Apple did not confirm exact build expiration');
    return {id,expired:true};
  };
}
export async function executePlan({plan,readInventory,verifyKeep,expire,progress=async()=>{},now=Date.now()}){
  const before=await readInventory();validatePlan(plan,before,now);await verifyKeep();
  const completed=[];
  for(const target of plan.targets){
    if(before.find(b=>b.id===target.id).expired){completed.push({...target,alreadyExpired:true});continue;}
    await verifyKeep();await expire(target.id);completed.push({...target,expired:true});await progress({completed});
  }
  const after=await readInventory();requireKeep(after,now);check(identities(after)===identities(before),'Inventory changed during expiration');
  check(after.every(b=>b.id===keep.id||b.expired),'Some old builds remain active');const availability=await verifyKeep();
  return {checkedAt:new Date().toISOString(),appId,keep,completed,before,after,availability,remainingActive:after.filter(b=>!b.expired),verified:true,operation:'Old-build expiration only; no group/tester/notification/App Store metadata changes'};
}
async function main(){
  check(process.env.APP_STORE_CONNECT_APP_ID===appId,'Wrong Apple app configured');
  const read=createAppleReader(),readInventory=()=>inventory(read);
  const verifyKeep=async()=>{const result=await checkAvailability({appId,build:keep.build,marketingVersion:keep.version,baselineBuild:'32.1',baselineMarketingVersion:'1.1.0',read});check(result.buildId===keep.id&&result.availableToExistingInternalGroup,'Protected build is not available to existing testers');return result;};
  await fs.mkdir('build',{recursive:true});
  const mode=process.argv[2]??'plan';
  if(mode==='plan'){
    const plan=makePlan(await readInventory());plan.availability=await verifyKeep();
    await fs.writeFile('build/testflight-retirement-plan.json',JSON.stringify(plan,null,2)+'\n');console.log(JSON.stringify({mode,keep,oldActiveBuilds:plan.targets.length}));return;
  }
  check(mode==='apply','Invalid retirement operation');
  const plan=JSON.parse(await fs.readFile('.github/testflight-retirement-20261017.json','utf8'));
  const expire=createExpirer(process.env,plan.targets.map(b=>b.id));
  const progress=result=>fs.writeFile('build/testflight-retirement-progress.json',JSON.stringify(result,null,2)+'\n');
  const result=await executePlan({plan,readInventory,verifyKeep,expire,progress});
  await fs.writeFile('build/testflight-retirement-result.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({verified:result.verified,expired:result.completed.length,keep}));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{await main();}catch(error){console.error(error.message?.startsWith('Apple expiration request failed:')?error.message:'TestFlight retirement stopped: '+error.message);process.exitCode=1;}}

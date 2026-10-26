import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function compareVersions(a,b) {
  const parse=value=>{if(!/^\d+(?:\.\d+){0,2}$/.test(value))throw Error('Invalid numeric version');return value.split('.').map(Number);};
  const left=parse(a),right=parse(b);
  for(let i=0;i<3;i++){const delta=(left[i]??0)-(right[i]??0);if(delta)return Math.sign(delta);}
  return 0;
}
export function assessVersion(requested,versions,builds) {
  compareVersions(requested,'0');
  const approved=new Set(['PENDING_DEVELOPER_RELEASE','PENDING_APPLE_RELEASE','PROCESSING_FOR_APP_STORE','PREORDER_READY_FOR_SALE','READY_FOR_SALE','READY_FOR_DISTRIBUTION','REPLACED_WITH_NEW_VERSION','REMOVED_FROM_SALE','DEVELOPER_REMOVED_FROM_SALE']);
  const blockers=versions.filter(v=>approved.has(v.state)&&compareVersions(v.version,requested)>=0);
  const maximum=builds.reduce((result,b)=>compareVersions(b.build,result)>0?b.build:result,'0');
  const nextBuild=String(Number(maximum.split('.')[0])+1);
  if(!/^\d{1,4}$/.test(nextBuild))throw Error('Build sequence exceeds the current integer policy');
  return {requestedVersion:requested,eligibleForUpload:blockers.length===0,blockers,highestUploadedBuild:maximum,nextBuild,versions,builds};
}
export async function preflight(env=process.env,fetcher=fetch) {
  const app=env.APP_STORE_CONNECT_APP_ID,requested=env.EXPECTED_MARKETING_VERSION;
  if(!/^\d+$/.test(app??'')||!requested)throw Error('App and requested marketing version are required');
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  async function list(endpoint){
    const data=[],included=[];let next=endpoint;
    for(let page=0;next&&page<25;page++){
      const url=new URL(next,'https://api.appstoreconnect.apple.com');
      if(url.origin!=='https://api.appstoreconnect.apple.com'||url.username||url.password||!(/^\/v1\/apps\/\d+\/appStoreVersions$/.test(url.pathname)||url.pathname==='/v1/builds'))throw Error('Unsupported version audit URL');
      const now=Math.floor(Date.now()/1000);
      const unsigned=encode({alg:'ES256',kid:env.APP_STORE_CONNECT_KEY_ID,typ:'JWT'})+'.'+encode({iss:env.APP_STORE_CONNECT_ISSUER_ID,iat:now,exp:now+300,aud:'appstoreconnect-v1'});
      const token=unsigned+'.'+crypto.sign('sha256',Buffer.from(unsigned),{key:env.APP_STORE_CONNECT_PRIVATE_KEY,dsaEncoding:'ieee-p1363'}).toString('base64url');
      const response=await fetcher(url,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error('Apple version audit failed: '+response.status);
      const result=await response.json();if(!Array.isArray(result.data))throw Error('Incomplete Apple audit');
      data.push(...result.data);included.push(...(result.included??[]));next=result.links?.next;
    }
    if(next)throw Error('Incomplete paginated Apple audit');
    return {data,included};
  }
  const [store,uploaded]=await Promise.all([list(`/v1/apps/${app}/appStoreVersions?filter[platform]=IOS&limit=200`),list(`/v1/builds?filter[app]=${app}&include=preReleaseVersion&limit=200`)]);
  const releases=new Map(uploaded.included.filter(v=>v.type==='preReleaseVersions').map(v=>[v.id,v.attributes]));
  const builds=uploaded.data.filter(b=>releases.get(b.relationships?.preReleaseVersion?.data?.id)?.platform==='IOS').map(b=>({id:b.id,build:b.attributes.version,version:releases.get(b.relationships.preReleaseVersion.data.id).version,state:b.attributes.processingState,uploadedDate:b.attributes.uploadedDate}));
  const versions=store.data.map(v=>({id:v.id,version:v.attributes.versionString,state:v.attributes.appStoreState??v.attributes.appVersionState}));
  return {checkedAt:new Date().toISOString(),operation:'GET only; no metadata, tester, group or release changes',appId:app,...assessVersion(requested,versions,builds)};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const report=await preflight();await fs.mkdir('build',{recursive:true});await fs.writeFile('build/release-version-preflight.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({requestedVersion:report.requestedVersion,eligibleForUpload:report.eligibleForUpload,nextBuild:report.nextBuild,versions:report.versions}));
  if(!report.eligibleForUpload)process.exitCode=2;
}

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const plan=JSON.parse(await fs.readFile(new URL('./store-screenshot-plan.json',import.meta.url),'utf8'));
assert.equal(process.env.APP_STORE_CONNECT_APP_ID,plan.appId);
assert.equal(process.env.SCREENSHOTS_RUN_ID,plan.runId);
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const receipt={startedAt:new Date().toISOString(),runId:plan.runId,images:[],submitted:false};
async function request(endpoint,method='GET',body){
 assert.ok(/^\/v1\//.test(endpoint)&&!endpoint.toLowerCase().includes('submission'));
 const now=Math.floor(Date.now()/1000);
 const payload=encode({alg:'ES256',kid:process.env.APP_STORE_CONNECT_KEY_ID,typ:'JWT'})+'.'+encode({iss:process.env.APP_STORE_CONNECT_ISSUER_ID,iat:now,exp:now+300,aud:'appstoreconnect-v1'});
 const token=payload+'.'+crypto.sign('sha256',Buffer.from(payload),{key:process.env.APP_STORE_CONNECT_PRIVATE_KEY,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const response=await fetch('https://api.appstoreconnect.apple.com'+endpoint,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const result=await response.json();
 if(!response.ok)throw Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(result.errors?.map(e=>({code:e.code,detail:e.detail})))}`);
 return result;
}
async function findFile(directory,name){
 const matches=[];
 for(const entry of await fs.readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory())matches.push(...await findFile(file,name));
  else if(entry.name===name)matches.push(file);
 }
 return matches;
}
try{
 const version=await request(`/v1/appStoreVersions/${plan.versionId}`);
 assert.equal(version.data.attributes.appStoreState,'PREPARE_FOR_SUBMISSION');
 const sets=await request(`/v1/appStoreVersionLocalizations/${plan.localizationId}/appScreenshotSets?limit=50`);
 assert.ok(!sets.links?.next);
 for(const item of plan.images){
  const files=await findFile('build/reviewed-screenshots',item.sourceFile);
  assert.equal(files.length,1);
  const bytes=await fs.readFile(files[0]);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),item.sha256);
  // The pinned hash identifies the exact visually reviewed JPEG and dimensions.
  assert.equal(bytes.subarray(0,2).toString('hex'),'ffd8');
  assert.equal(bytes.subarray(-2).toString('hex'),'ffd9');
  const checksum=crypto.createHash('md5').update(bytes).digest('hex');
  let set=sets.data.find(row=>row.attributes.screenshotDisplayType===item.displayType);
  if(!set){set=(await request('/v1/appScreenshotSets','POST',{data:{type:'appScreenshotSets',attributes:{screenshotDisplayType:item.displayType},relationships:{appStoreVersionLocalization:{data:{type:'appStoreVersionLocalizations',id:plan.localizationId}}}}})).data;sets.data.push(set);}
  const images=await request(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`);assert.ok(!images.links?.next);
  const fileName=`reylumi-${item.sha256.slice(0,12)}-${item.sourceFile}`;
  let screenshot=images.data.find(row=>row.attributes.fileName===fileName);
  if(screenshot?.attributes.assetDeliveryState?.state==='COMPLETE'){
   assert.equal(screenshot.attributes.sourceFileChecksum,checksum);
  }else{
   if(!screenshot)screenshot=(await request('/v1/appScreenshots','POST',{data:{type:'appScreenshots',attributes:{fileSize:bytes.length,fileName},relationships:{appScreenshotSet:{data:{type:'appScreenshotSets',id:set.id}}}}})).data;
   assert.ok(screenshot.attributes.uploadOperations?.length,'Upload reservation has no upload operations; inspect asset before retrying');
   for(const operation of screenshot.attributes.uploadOperations){
    const destination=new URL(operation.url);
    assert.equal(destination.protocol,'https:');assert.ok(destination.hostname.endsWith('.apple.com'),`Unexpected screenshot upload host: ${destination.hostname}`);
    assert.equal(operation.method,'PUT');assert.ok(operation.offset>=0&&operation.offset+operation.length<=bytes.length);
    const response=await fetch(destination,{method:operation.method,headers:Object.fromEntries((operation.requestHeaders??[]).map(header=>[header.name,header.value])),body:bytes.subarray(operation.offset,operation.offset+operation.length),signal:AbortSignal.timeout(90000)});
    assert.ok(response.ok,`Screenshot upload failed: ${response.status}`);
   }
   await request(`/v1/appScreenshots/${screenshot.id}`,'PATCH',{data:{type:'appScreenshots',id:screenshot.id,attributes:{uploaded:true,sourceFileChecksum:checksum}}});
  }
  for(let attempt=0;attempt<30;attempt++){
   screenshot=(await request(`/v1/appScreenshots/${screenshot.id}`)).data;
   if(['COMPLETE','FAILED'].includes(screenshot.attributes.assetDeliveryState?.state))break;
   await new Promise(resolve=>setTimeout(resolve,3000));
  }
  const state=screenshot.attributes.assetDeliveryState?.state;
  receipt.images.push({id:screenshot.id,setId:set.id,fileName,sha256:item.sha256,state});
  assert.equal(state,'COMPLETE',JSON.stringify(screenshot.attributes.assetDeliveryState));
 }
 receipt.completed=true;
}catch(error){receipt.error=error.message;throw error;}finally{
 receipt.finishedAt=new Date().toISOString();await fs.mkdir('build',{recursive:true});await fs.writeFile('build/store-screenshot-upload.json',JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({completed:receipt.completed??false,images:receipt.images.length,submitted:false}));
}

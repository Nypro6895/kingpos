import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const plan=JSON.parse(await fs.readFile(new URL('./store-draft.json',import.meta.url),'utf8'));
assert.equal(process.env.APP_STORE_CONNECT_APP_ID,plan.appId);
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const receipt={appId:plan.appId,startedAt:new Date().toISOString(),operations:[],submitted:false};
async function request(endpoint,method='GET',body){
 assert.ok(/^\/v[12]\//.test(endpoint)&&!endpoint.toLowerCase().includes('submission'));
 const now=Math.floor(Date.now()/1000),payload=encode({alg:'ES256',kid:process.env.APP_STORE_CONNECT_KEY_ID,typ:'JWT'})+'.'+encode({iss:process.env.APP_STORE_CONNECT_ISSUER_ID,iat:now,exp:now+300,aud:'appstoreconnect-v1'});
 const token=payload+'.'+crypto.sign('sha256',Buffer.from(payload),{key:process.env.APP_STORE_CONNECT_PRIVATE_KEY,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const response=await fetch('https://api.appstoreconnect.apple.com'+endpoint,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const result=response.status===204?null:await response.json();
 if(response.status===404&&method==='GET')return null;
 if(!response.ok)throw Error(`${method} ${endpoint}: ${response.status} ${JSON.stringify(result.errors?.map(e=>({code:e.code,detail:e.detail})))}`);
 if(method!=='GET')receipt.operations.push({method,endpoint,completedAt:new Date().toISOString()});
 return result;
}
async function fill(type,id,desired){
 const current=await request(`/v1/${type}/${id}`);assert.ok(current?.data);
 const attributes={};for(const [key,value] of Object.entries(desired)){const old=current.data.attributes[key];if(old!==null&&old!==undefined&&old!==''&&old!==value)throw Error(`Preserving existing ${type}.${key}; review draft before changing it.`);if(old!==value)attributes[key]=value;}
 if(Object.keys(attributes).length)await request(`/v1/${type}/${id}`,'PATCH',{data:{type,id,attributes}});
}
try{
 const version=await request(`/v1/appStoreVersions/${plan.versionId}`);
 assert.equal(version?.data.attributes.appStoreState,'PREPARE_FOR_SUBMISSION');
 assert.ok(['1.0',plan.version].includes(version.data.attributes.versionString));
 const builds=await request(`/v1/builds?filter[app]=${plan.appId}&filter[version]=${plan.buildNumber}`);
 assert.ok(builds.data.some(b=>b.id===plan.buildId&&b.attributes.processingState==='VALID'));
 const prerelease=await request(`/v1/builds/${plan.buildId}/preReleaseVersion`);assert.equal(prerelease?.data.attributes.version,plan.version);
 await request(`/v1/appStoreVersions/${plan.versionId}`,'PATCH',{data:{type:'appStoreVersions',id:plan.versionId,attributes:{versionString:plan.version,releaseType:'MANUAL'},relationships:{build:{data:{type:'builds',id:plan.buildId}}}}});
 await fill('appInfoLocalizations',plan.appInfoLocalizationId,plan.appInfo);
 await fill('appStoreVersionLocalizations',plan.versionLocalizationId,plan.localization);
 const info=await request(`/v1/appInfos/${plan.appInfoId}?include=primaryCategory,secondaryCategory`),relationships={};
 for(const [key,id]of Object.entries(plan.categories)){assert.ok(await request(`/v1/appCategories/${id}`));const existing=info.data.relationships[key]?.data?.id;if(existing&&existing!==id)throw Error('Preserving an existing app category');if(!existing)relationships[key]={data:{type:'appCategories',id}};}
 if(Object.keys(relationships).length)await request(`/v1/appInfos/${plan.appInfoId}`,'PATCH',{data:{type:'appInfos',id:plan.appInfoId,relationships}});
 let availability=await request(`/v1/apps/${plan.appId}/appAvailabilityV2`);
 if(!availability){
  await request('/v2/appAvailabilities','POST',{data:{type:'appAvailabilities',attributes:{availableInNewTerritories:false},relationships:{app:{data:{type:'apps',id:plan.appId}},territoryAvailabilities:{data:[{type:'territoryAvailabilities',id:'${usa}'}]}}},included:[{type:'territoryAvailabilities',id:'${usa}',attributes:{available:true,preOrderEnabled:false},relationships:{territory:{data:{type:'territories',id:'USA'}}}}]});
  availability=await request(`/v1/apps/${plan.appId}/appAvailabilityV2`);
 }
 assert.equal(availability.data.attributes.availableInNewTerritories,false);
 const territories=await request(`/v2/appAvailabilities/${availability.data.id}/territoryAvailabilities?limit=200&include=territory`);
 assert.ok(!territories.links?.next,'Review additional territory pages before changing availability');
 for(const row of territories.data){const id=row.relationships.territory?.data?.id;assert.ok(id);const available=plan.territories.includes(id);if(row.attributes.available!==available)await request(`/v1/territoryAvailabilities/${row.id}`,'PATCH',{data:{type:'territoryAvailabilities',id:row.id,attributes:{available}}});}
 const verified=await request(`/v2/appAvailabilities/${availability.data.id}/territoryAvailabilities?limit=200&include=territory`);
 assert.deepEqual(verified.data.filter(row=>row.attributes.available).map(row=>row.relationships.territory.data.id).sort(),['USA']);
 receipt.availableTerritories=['USA'];receipt.completed=true;
}catch(error){receipt.error=error.message;throw error;}finally{
 receipt.finishedAt=new Date().toISOString();await fs.mkdir('build',{recursive:true});await fs.writeFile('build/store-draft-receipt.json',JSON.stringify(receipt,null,2));
 console.log(JSON.stringify({completed:receipt.completed??false,operations:receipt.operations.length,submitted:false}));
}

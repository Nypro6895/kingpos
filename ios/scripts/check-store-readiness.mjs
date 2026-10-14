import crypto from 'node:crypto';
import fs from 'node:fs/promises';
const app=process.env.APP_STORE_CONNECT_APP_ID;
if(!/^\d+$/.test(app??''))throw Error('The App Store app is not configured.');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const failures=[];
async function read(endpoint,optional=false){
 const url=new URL(endpoint,'https://api.appstoreconnect.apple.com');
 if(url.origin!=='https://api.appstoreconnect.apple.com'||!/^\/v[12]\//.test(url.pathname))throw Error('Unexpected API origin');
 const now=Math.floor(Date.now()/1000);
 const payload=encode({alg:'ES256',kid:process.env.APP_STORE_CONNECT_KEY_ID,typ:'JWT'})+'.'+encode({iss:process.env.APP_STORE_CONNECT_ISSUER_ID,iat:now,exp:now+300,aud:'appstoreconnect-v1'});
 const token=payload+'.'+crypto.sign('sha256',Buffer.from(payload),{key:process.env.APP_STORE_CONNECT_PRIVATE_KEY,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 if(!response.ok){failures.push({endpoint:url.pathname,status:response.status});if(optional)return null;throw Error('App Store metadata could not be read: '+response.status);}
 return response.json();
}
async function list(endpoint,optional=false){
 const rows=[];let next=endpoint;
 for(let page=0;next&&page<6;page++){const result=await read(next,optional);if(!result)return rows;rows.push(...result.data);next=result.links?.next;}
 return rows;
}
const [appInfo,versions,infos,availability,priceSchedule]=await Promise.all([
 read(`/v1/apps/${app}`),list(`/v1/apps/${app}/appStoreVersions?limit=10`),
 list(`/v1/apps/${app}/appInfos?limit=10&include=primaryCategory,secondaryCategory`),read(`/v1/apps/${app}/appAvailabilityV2`,true),
 read(`/v1/apps/${app}/appPriceSchedule?include=baseTerritory`,true),
]);
const report={app:{id:app,name:appInfo.data.attributes.name,bundleId:appInfo.data.attributes.bundleId,primaryLocale:appInfo.data.attributes.primaryLocale,contentRightsDeclaration:appInfo.data.attributes.contentRightsDeclaration},versions:[],appInfos:[],availability:null,privacyLabels:'Not exposed by this audit; verify in App Store Connect.',failures,checkedAt:new Date().toISOString(),operation:'GET requests only; no uploads, metadata changes, invitations or submission'};
for(const version of versions){
 const [localizations,review,build]=await Promise.all([
  list(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=50`,true),
  read(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`,true),
  read(`/v1/appStoreVersions/${version.id}/build`,true),
 ]);
 const row={id:version.id,version:version.attributes.versionString,platform:version.attributes.platform,state:version.attributes.appStoreState,copyright:version.attributes.copyright,build:build?.data?{id:build.data.id,version:build.data.attributes.version,processingState:build.data.attributes.processingState}:null,localizations:[],review:review?.data?{hasContactName:!!(review.data.attributes.contactFirstName&&review.data.attributes.contactLastName),hasContactPhone:!!review.data.attributes.contactPhone,hasContactEmail:!!review.data.attributes.contactEmail,demoAccountRequired:review.data.attributes.demoAccountRequired,hasDemoAccount:!!(review.data.attributes.demoAccountName&&review.data.attributes.demoAccountPassword),hasNotes:!!review.data.attributes.notes}:null};
 for(const loc of localizations){
  const sets=await list(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=50`,true);
  const screenshots=[];
  for(const set of sets){const images=await list(`/v1/appScreenshotSets/${set.id}/appScreenshots?limit=50`,true);screenshots.push({displayType:set.attributes.screenshotDisplayType,count:images.length,completed:images.filter(i=>i.attributes.assetDeliveryState?.state==='COMPLETE').length});}
  row.localizations.push({id:loc.id,locale:loc.attributes.locale,description:loc.attributes.description,keywords:loc.attributes.keywords,supportUrl:loc.attributes.supportUrl,marketingUrl:loc.attributes.marketingUrl,screenshots});
 }
 report.versions.push(row);
}
for(const info of infos){
 const [localizations,ageRating]=await Promise.all([list(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=50`,true),read(`/v1/appInfos/${info.id}/ageRatingDeclaration`,true)]);
 report.appInfos.push({id:info.id,state:info.attributes.appStoreState,primaryCategory:info.relationships?.primaryCategory?.data?.id??null,secondaryCategory:info.relationships?.secondaryCategory?.data?.id??null,localizations:localizations.map(loc=>({id:loc.id,locale:loc.attributes.locale,name:loc.attributes.name,subtitle:loc.attributes.subtitle,privacyPolicyUrl:loc.attributes.privacyPolicyUrl})),ageRating:ageRating?.data?.attributes??null});
}
report.pricing=null;
if(priceSchedule?.data){
 const prices=await read(`/v1/appPriceSchedules/${priceSchedule.data.id}/manualPrices?limit=200&include=appPricePoint,territory`,true);
 report.pricing={id:priceSchedule.data.id,baseTerritory:priceSchedule.data.relationships?.baseTerritory?.data?.id??null,prices:prices?.data?.map(row=>({startDate:row.attributes.startDate,endDate:row.attributes.endDate,territory:row.relationships?.territory?.data?.id??null,customerPrice:prices.included?.find(point=>point.type==='appPricePoints'&&point.id===row.relationships?.appPricePoint?.data?.id)?.attributes.customerPrice??null}))??[]};
 const automatic=await read(`/v1/appPriceSchedules/${priceSchedule.data.id}/automaticPrices?filter[territory]=USA&limit=200&include=appPricePoint,territory`,true);
 report.pricing.automaticUSPrices=automatic?.data?.map(row=>({startDate:row.attributes.startDate,endDate:row.attributes.endDate,customerPrice:automatic.included?.find(point=>point.type==='appPricePoints'&&point.id===row.relationships?.appPricePoint?.data?.id)?.attributes.customerPrice??null}))??[];
}
if(availability?.data){
 const endpoint=`/v2/appAvailabilities/${availability.data.id}/territoryAvailabilities?limit=200&include=territory`;
 const rows=await list(endpoint,true);
 report.availability={id:availability.data.id,availableInNewTerritories:availability.data.attributes.availableInNewTerritories,territories:rows.map(row=>({id:row.id,territory:row.relationships?.territory?.data?.id??null,available:row.attributes.available,releaseDate:row.attributes.releaseDate,preOrderEnabled:row.attributes.preOrderEnabled}))};
}
await fs.mkdir('build',{recursive:true});await fs.writeFile('build/store-readiness.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({app:report.app.name,versions:report.versions.map(v=>({version:v.version,state:v.state,build:v.build?.version??null,localizations:v.localizations.length})),territories:report.availability?.territories.length??null,readFailures:failures.length,readOnly:true}));

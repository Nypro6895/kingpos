import crypto from 'node:crypto';
import fs from 'node:fs/promises';

const version=process.argv[2];
if(!/^\d+(?:\.\d+){0,2}$/.test(version??''))throw Error('An exact TestFlight build number is required.');
const app=process.env.APP_STORE_CONNECT_APP_ID;
if(!/^\d+$/.test(app??''))throw Error('The App Store Connect app ID is not configured.');
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function read(endpoint){
 const now=Math.floor(Date.now()/1000);
 const payload=encode({alg:'ES256',kid:process.env.APP_STORE_CONNECT_KEY_ID,typ:'JWT'})+'.'+encode({iss:process.env.APP_STORE_CONNECT_ISSUER_ID,iat:now,exp:now+300,aud:'appstoreconnect-v1'});
 const token=payload+'.'+crypto.sign('sha256',Buffer.from(payload),{key:process.env.APP_STORE_CONNECT_PRIVATE_KEY,dsaEncoding:'ieee-p1363'}).toString('base64url');
 const response=await fetch('https://api.appstoreconnect.apple.com/v1/'+endpoint,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('Apple build status request failed: '+response.status);
 return response.json();
}
let build;
for(let attempt=0;attempt<30;attempt++){
 const result=await read(`builds?filter[app]=${app}&filter[version]=${version}&sort=-uploadedDate&limit=5`);
 build=result.data.find(item=>item.attributes.version===version);
 const state=build?.attributes.processingState??'NOT_VISIBLE';
 console.log(JSON.stringify({build:version,processingState:state}));
 if(['FAILED','INVALID'].includes(state))throw Error('Apple rejected this build during processing.');
 if(state==='VALID'){
  const detail=await read(`builds/${build.id}/buildBetaDetail`);
  const receipt={build:version,buildId:build.id,processingState:state,internalBuildState:detail.data.attributes.internalBuildState,checkedAt:new Date().toISOString(),operation:'Read-only; no tester invitations or group changes'};
  await fs.mkdir('build',{recursive:true});await fs.writeFile('build/testflight-processing.json',JSON.stringify(receipt,null,2));
  console.log(JSON.stringify(receipt));process.exit(0);
 }
 await new Promise(resolve=>setTimeout(resolve,30000));
}
throw Error('Upload accepted; Apple processing is still pending for build '+version+'.');

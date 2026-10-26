import crypto from 'node:crypto';
const env=process.env;
const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
async function api(path,method='GET',data) {
  const now=Math.floor(Date.now()/1000);
  const unsigned=encode({alg:'ES256',kid:env.APP_STORE_CONNECT_KEY_ID,typ:'JWT'})+'.'+encode({iss:env.APP_STORE_CONNECT_ISSUER_ID,iat:now,exp:now+300,aud:'appstoreconnect-v1'});
  const jwt=unsigned+'.'+crypto.sign('sha256',Buffer.from(unsigned),{key:env.APP_STORE_CONNECT_PRIVATE_KEY,dsaEncoding:'ieee-p1363'}).toString('base64url');
  const response=await fetch('https://api.appstoreconnect.apple.com/v1/'+path,{method,headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(60000)});
  const body=response.status===204?{}:await response.json();
  if (!response.ok) throw new Error(JSON.stringify({status:response.status,errors:body.errors}));
  return body;
}
const app=env.APP_STORE_CONNECT_APP_ID;
let build;
for(let attempt=0;attempt<30;attempt++) {
  const result=await api(`builds?filter[app]=${app}&sort=-uploadedDate&limit=5`);
  build=result.data.find(x=>x.attributes.version==='1.2');
  console.log(JSON.stringify({build:build?.attributes.version,state:build?.attributes.processingState??'NOT_VISIBLE'}));
  if(build?.attributes.processingState==='VALID') break;
  if(build&&['FAILED','INVALID'].includes(build.attributes.processingState)) throw new Error('Apple rejected processing');
  await new Promise(resolve=>setTimeout(resolve,30000));
}
if(build?.attributes.processingState!=='VALID') throw new Error('Apple processing is still pending; rerun status later.');
const groups=await api(`apps/${app}/betaGroups`);
let group=groups.data.find(x=>x.attributes.isInternalGroup&&x.attributes.name==='Reylumi Internal');
if(!group) group=(await api('betaGroups','POST',{data:{type:'betaGroups',attributes:{name:'Reylumi Internal',isInternalGroup:true,hasAccessToAllBuilds:true},relationships:{app:{data:{type:'apps',id:app}}}}})).data;
console.log(JSON.stringify({internalGroup:group.id,name:group.attributes.name}));
// Automatic internal distribution grants this group access to processed builds.
const testers=await api(`betaTesters?filter[email]=${encodeURIComponent(env.TESTFLIGHT_TESTER_EMAIL)}&limit=100`);
let tester=testers.data.find(x=>x.attributes.email.toLowerCase()===env.TESTFLIGHT_TESTER_EMAIL.toLowerCase());
if(!tester) tester=(await api('betaTesters','POST',{data:{type:'betaTesters',attributes:{email:env.TESTFLIGHT_TESTER_EMAIL},relationships:{betaGroups:{data:[{type:'betaGroups',id:group.id}]}}}})).data;
else await api(`betaGroups/${group.id}/relationships/betaTesters`,'POST',{data:[{type:'betaTesters',id:tester.id}]});
console.log(JSON.stringify({testerState:tester.attributes.state,invitation:'tester added to internal group'}));
const detail=await api(`builds/${build.id}/buildBetaDetail`);
console.log(JSON.stringify({buildId:build.id,betaState:detail.data.attributes.internalBuildState}));

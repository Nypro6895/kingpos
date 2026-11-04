import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {startIsolatedSupabase} from './isolated-supabase-fixture.mjs';

// Test transport only. Real Next auth/DAL, GoTrue and PostgREST are unchanged.
// The loopback bridge reaches the network-none DB namespace via docker exec.
export async function startMarketLocal({nextPort=4328,bridgePort=4329,seedReview=false,buildOutput=process.env.TEST_MARKET_BUILD_OUTPUT}={}){
 if(buildOutput!==undefined && !/^\.next-[a-zA-Z0-9-]+$/.test(buildOutput))throw Error('Use a named local Next build directory.');
 const fixture=await startIsolatedSupabase('market-local',{boundedResources:true,normalizeMigrationLineEndings:true,cachedImages:{db:'public.ecr.aws/supabase/postgres:17.11.0.006',auth:'public.ecr.aws/supabase/gotrue:v2.197.0',storage:'public.ecr.aws/supabase/storage-api:v1.84.19',rest:'public.ecr.aws/supabase/postgrest:v16.5'}});
 fixture.save("market-local-start.json", fixture.evidence);
 let bridge,next;
 const close=async()=>{if(next){next.kill();if(next.exitCode===null)await Promise.race([new Promise(resolve=>next.once('exit',resolve)),delay(5000)]);}if(bridge)await new Promise(resolve=>bridge.close(resolve));await fixture.close();};
 try{
  const developer=fixture.person('local-developer'),reviewer=fixture.person('local-reviewer'),buyer=fixture.person('local-salon-owner'),other=fixture.person('local-other-owner');
  const people={developer,reviewer,buyer,other};
  fixture.sql(`update market_platform.settings set enabled=true;insert into market_private.reviewers(user_id) values('${reviewer.profileId}');`);
  const salons={},accounts={};
  for(const [name,person] of Object.entries({buyer,other})){
   const account=randomUUID(),salon=randomUUID(),role=randomUUID();salons[name]=salon;accounts[name]=account;
   fixture.sql(`insert into accounts(id,name) values('${account}','Synthetic local account');insert into locations(id,account_id,name) values('${salon}','${account}','Synthetic ${name} salon');insert into roles(id,account_id,name,code) values('${role}','${account}','Owner','OWNER');insert into account_memberships(account_id,user_id,role_id,status) values('${account}','${person.profileId}','${role}','active');`);
  }
  if(seedReview){
   fixture.rpc(developer,'market_platform_register',{p_name:'Synthetic review developer'});
   const version=fixture.rpc(developer,'market_platform_submit',{p_app:null,p_request:randomUUID(),p_manifest:{schemaVersion:1,type:'hosted-app',version:'1.0.0',name:'Local review · Salon identity',description:'Synthetic review app for the existing Market activation flow. Hosted deployment remains pending.',launchUrl:'https://developer.reylumi.com/app',privacyUrl:'https://developer.reylumi.com/privacy',supportUrl:'https://developer.reylumi.com/support',scopes:['salon:identity:read'],price:{currency:'usd',amountCents:0,billing:'one-time-version'}}});
   fixture.rpc(reviewer,'market_platform_review',{p_version:version.id,p_sha256:version.sha256,p_decision:'approved',p_reason:'Disposable local fixture manifest approved for UI review only; no hosted production app.'});
  }
  bridge=createServer(async(req,res)=>{
   res.setHeader('Cache-Control','no-store');
   try{
    const url=new URL(req.url,`http://127.0.0.1:${bridgePort}`);
    if(url.pathname==='/'){
     res.setHeader('Content-Type','text/html');res.end(`<h1>Reylumi local integration review</h1><p>Disposable synthetic accounts authenticated by local GoTrue. No production data or payment credentials. These links select test accounts only; marketplace roles are enforced in the database.</p>${Object.keys(people).map(name=>`<p><a href="/session/${name}">${({developer:"Developer thử nghiệm",reviewer:"Reviewer độc lập thử nghiệm",buyer:"Owner thử nghiệm · Tiệm A",other:"Owner thử nghiệm · Tiệm B"})[name]}</a></p>`).join('')}`);return;
    }
    if(url.pathname.startsWith('/session/')){
     const name=url.pathname.split('/')[2],person=people[name];if(!person){res.writeHead(404).end();return;}
     // Cookies cross loopback ports but never leave this machine. No token URLs.
     res.setHeader('Set-Cookie',[`sb-access-token=${person.token}; HttpOnly; SameSite=Lax; Path=/`,...['kingpos-current-account-id','kingpos-current-salon-id','kingpos-current-manage-salon-id','kingpos-selected-workspace'].map(key=>`${key}=${encodeURIComponent(key==='kingpos-current-account-id'?(accounts[name]??''):key==='kingpos-selected-workspace'?(salons[name]?`manage:${salons[name]}`:'personal'):(salons[name]??''))}; HttpOnly; SameSite=Lax; Path=/`)]);
     res.writeHead(303,{Location:`http://127.0.0.1:${nextPort}${salons[name]?"/market":"/developer-platform"}`}).end();return;
    }
    const auth=url.pathname.startsWith('/auth/v1/'),rest=url.pathname.startsWith('/rest/v1/');
    if(!auth&&!rest){res.writeHead(404).end();return;}
    const raw=[];let length=0;for await(const part of req){length+=part.length;if(length>65536){res.writeHead(413).end();return;}raw.push(part);}
    const body=raw.length?JSON.parse(Buffer.concat(raw).toString()):undefined;
    const token=req.headers.authorization?.replace(/^Bearer /,'');
    const response=fixture.http(auth?9999:3000,url.pathname.replace(auth?'/auth/v1':'/rest/v1','')+url.search,req.method,body,token,req.headers.accept?[`Accept: ${req.headers.accept}`]:[]);
    res.writeHead(response.status,{'Content-Type':'application/json'}).end(JSON.stringify(response.data));
   }catch{res.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Local fixture bridge failed'}));}
  });
  await new Promise((resolve,reject)=>{bridge.once('error',reject);bridge.listen(bridgePort,'127.0.0.1',resolve);});
  const allowed=new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','COMSPEC','PATHEXT','USERPROFILE','APPDATA','LOCALAPPDATA','PROGRAMFILES','PROGRAMFILES(X86)','HOMEDRIVE','HOMEPATH','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS']);
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>allowed.has(key.toUpperCase())));
  Object.assign(env,{NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',MARKET_PLATFORM_ENABLED:'true',MARKET_PLATFORM_PUBLIC_ORIGIN:`http://127.0.0.1:${nextPort}`,NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${bridgePort}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:fixture.anonymousClientKey()});
  if(buildOutput)env.KINGPOS_BUILD_OUTPUT=buildOutput;
  next=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(nextPort)],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let log='';next.stdout.on('data',b=>{log=(log+b).slice(-10000);});next.stderr.on('data',b=>{log=(log+b).slice(-10000);});
  for(let n=0;!log.includes('Ready in');n++){if(next.exitCode!==null||n>120)throw new Error(fixture.redact(log));await delay(250);}
  return {fixture,people,salons,origin:`http://127.0.0.1:${nextPort}`,launcher:`http://127.0.0.1:${bridgePort}`,close,log:()=>fixture.redact(log)};
 }catch(error){await close();throw error;}
}

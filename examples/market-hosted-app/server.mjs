import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
// Reference only: ephemeral server-side sessions, bounded lifetime and loopback.
// Production hosting must provide HTTPS, a durable encrypted token store, a
// browser session bound to your own signed-in user, and distributed refresh locks.
export function createHostedApp({api,clientId,clientSecret,fetcher=fetch,secureCookie=true}){
 const origin=new URL(api);
 if(origin.origin!==api||!(origin.protocol==='https:'||['localhost','127.0.0.1'].includes(origin.hostname)))throw Error('Invalid configured Reylumi API origin');
 if(!/^[a-f0-9-]{36}$/i.test(clientId))throw Error('Configure your app client ID');
 if(!/^rmc_[A-Za-z0-9_-]{43}$/.test(clientSecret))throw Error('Configure a backend client secret');
 const sessions=new Map(),pending=new Map();
 const random=()=>randomBytes(32).toString('base64url');
 const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
 async function exchange(body){const r=await fetcher(api+'/api/market-platform/v1/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,client_id:clientId,client_secret:clientSecret}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Connection rejected');return r.json();}
 return createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  const url=new URL(req.url,'http://localhost');if(req.method!=='GET'||url.pathname!=='/'){res.writeHead(404).end();return;}
  for(const [id,s] of sessions)if(s.expires<Date.now())sessions.delete(id);
  const cookie=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('reylumi_app='))?.slice(12);
  try{
   if(url.searchParams.has('reylumi_installation')){
    if(url.searchParams.get('reylumi_client_id')!==clientId||url.searchParams.get('reylumi_authorize_url')!==api+'/api/market-platform/authorize')throw Error('Invalid app launch');
    const installation=url.searchParams.get('reylumi_installation');if(!/^[a-f0-9-]{36}$/.test(installation))throw Error('Invalid installation');
    if(sessions.size>=1000){res.writeHead(429).end('Too many sessions');return;}
    const id=random(),state=random(),verifier=random();sessions.set(id,{state,verifier,expires:Date.now()+60000});
    res.setHeader('Set-Cookie',`reylumi_app=${id}; HttpOnly; SameSite=Lax; Path=/${secureCookie?'; Secure':''}`);
    const auth=new URL(api+'/api/market-platform/authorize');for(const [k,v] of Object.entries({client_id:clientId,installation_id:installation,response_type:'code',state,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')}))auth.searchParams.set(k,v);
    if(url.searchParams.get('reylumi_sandbox')==='true')auth.searchParams.set('sandbox','true');
    res.writeHead(303,{Location:auth.href}).end();return;
   }
   const session=sessions.get(cookie);if(!session)throw Error('Start connection from the salon Market');
   if(url.searchParams.has('code')){
    if(!session.verifier||!equal(url.searchParams.get('state'),session.state)||!/^rma_[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code')??''))throw Error('Invalid callback state');
    // Consume session state before I/O: callback replay cannot race token exchange.
    const verifier=session.verifier;delete session.verifier;delete session.state;
    session.grant=await exchange({grant_type:'authorization_code',code:url.searchParams.get('code'),code_verifier:verifier});session.expires=Date.now()+30*86400000;
    res.writeHead(303,{Location:'/'}).end();return;
   }
   if(!session.grant)throw Error('Connection incomplete');
   const identity=()=>fetcher(api+'/api/market-platform/v1/salon',{headers:{Authorization:'Bearer '+session.grant.access_token},signal:AbortSignal.timeout(10000)});
   let r=await identity();if(r.status===403){if(!pending.has(cookie))pending.set(cookie,exchange({grant_type:'refresh_token',refresh_token:session.grant.refresh_token}).then(grant=>{session.grant=grant;}).finally(()=>pending.delete(cookie)));await pending.get(cookie);r=await identity();}
   if(!r.ok)throw Error('Connection unavailable; reconnect from Market');
   const salon=await r.json();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({salon,connection:'Automatic confidential connection; no Owner token copy'}));
  }catch{res.writeHead(403).end('Connection unavailable. Start or reconnect from your salon Market.');}
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 const server=createHostedApp({api:process.env.REYLUMI_MARKET_API_ORIGIN??'http://127.0.0.1:4328',clientId:process.env.REYLUMI_MARKET_CLIENT_ID,clientSecret:process.env.REYLUMI_MARKET_CLIENT_SECRET,secureCookie:false});
 server.listen(4340,'127.0.0.1',()=>console.log('Reference hosted app listening on loopback port 4340.'));
}

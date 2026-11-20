import {readHostedConfig} from './hosted-config.mjs';
import {createPostgresStore} from './postgres-store.mjs';
import {AuthError,createHostedAuth} from './hosted-auth.mjs';
import {createQrMenuHandler} from './server.mjs';
function unavailable(res){if(res.writableEnded)return;res.writeHead(503,{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}).end('QR QA runtime unavailable. Ask the developer to verify the reviewed configuration.');}

// Dependency injection is for synthetic contract tests, not request input.
// The deploy entrypoint reads only the frozen QA target and server environment.
export function createServerlessHandler({env,target,loadPool=async()=> (await import('pg')).Pool,fetcher=fetch}){
 return async function handler(req,res){res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');let pool;const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),45000);timer.unref?.();
  const abort=()=>deadline.abort();req.on?.('aborted',abort);
  try{
   if(typeof req.url!=='string'||!req.url.startsWith('/')||req.url.startsWith('//'))throw Error('Invalid request target');
   const config=readHostedConfig(env,target);const Pool=await loadPool();pool=new Pool(config.pool);
   // Never expose pg error objects, connection URLs, SQL parameters or secrets.
   pool.on('error',()=>{});
   const query=async(sql,parameters)=>{if(deadline.signal.aborted)throw Error('Request deadline exceeded');return pool.query(sql,parameters);};
   const boundedFetch=(url,options={})=>fetcher(url,{...options,signal:AbortSignal.any([deadline.signal,...(options.signal?[options.signal]:[])])});
   const auth=createHostedAuth({query,key:config.sessionKey,api:config.api,clientId:config.clientId,publicOrigin:config.publicOrigin,authOrigin:config.authOrigin,anonKey:config.anonKey,allowedUsers:config.allowedUsers,fetcher:boundedFetch});
   if(await auth.handle(req,res))return;
   const url=new URL(req.url,config.publicOrigin);
   let identity=null;
   if(['/connect','/manage'].includes(url.pathname)){
    identity=await auth.ownerIdentity(req);
    if(!identity){
     if(url.pathname==='/connect'&&url.searchParams.has('reylumi_installation')){res.writeHead(303,{'Location':auth.loginLocation(req),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}).end();return;}
     res.writeHead(403,{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}).end('Sign in to the QR app, then open it again from your salon Market.');return;
    }
   }
   const store=createPostgresStore({query,keys:config.grantKeys,activeKeyId:config.keyId,binding:{api:config.api,clientId:config.clientId,publicOrigin:config.publicOrigin}});
   const qr=createQrMenuHandler({api:config.api,clientId:config.clientId,clientSecret:config.clientSecret,publicOrigin:config.publicOrigin,store,ownerIdentity:async()=>identity,secureCookie:true,fetcher:boundedFetch});
   await qr(req,res);
  }catch(error){if(error instanceof AuthError&&!res.writableEnded)res.writeHead(error.status,{'Cache-Control':'no-store','Content-Type':'text/plain; charset=utf-8'}).end('QR app authentication could not be verified. Sign in again from the QR app.');else unavailable(res);}
  finally{clearTimeout(timer);req.off?.('aborted',abort);if(pool)try{await pool.end();}catch{if(!res.writableEnded)unavailable(res);}}
 };
}

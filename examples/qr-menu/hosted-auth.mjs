import {createCipheriv,createDecipheriv,createHash,createHmac,hkdfSync,randomBytes,timingSafeEqual} from 'node:crypto';
import {createMfaFlow} from './hosted-mfa.mjs';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const escape=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hash=x=>createHash('sha256').update(x).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookie=(req,name)=>{const values=(req.headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));return values.length===1?values[0].slice(name.length+1):null;};
const sessionName='__Host-qr_app',csrfName='__Host-qr_csrf';
export class AuthError extends Error{constructor(status){super('QR app authentication unavailable');this.status=status;}}
async function json(response){let bytes=0,parts=[];for await(const chunk of response.body){bytes+=chunk.length;if(bytes>32768)throw new AuthError(503);parts.push(chunk);}return JSON.parse(Buffer.concat(parts).toString());}
function headers(res){res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");}
function page(res,status,title,body,language='en'){
 const nonce=randomBytes(16).toString('base64url');headers(res);res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'nonce-"+nonce+"'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.writeHead(status).end('<!doctype html><html lang="'+(language==='vi'?'vi':'en')+'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(title)+'</title><style nonce="'+nonce+'">*{box-sizing:border-box}body{margin:0;background:#f3f7f5;color:#183b31;font:16px system-ui,sans-serif;line-height:1.6}main{max-width:460px;margin:8vh auto;padding:28px;background:white;border:1px solid #d8e5dd;border-radius:16px}h1{font-size:28px;line-height:1.25;margin:0 0 18px}label{display:grid;gap:7px;font-size:14px;font-weight:600}input,select{width:100%;min-height:46px;padding:11px;border:1px solid #b8ccc0;border-radius:8px;font:inherit}button{min-height:46px;width:100%;padding:12px 16px;background:#145946;color:white;border:0;border-radius:8px;font:inherit;font-weight:600;cursor:pointer}.secondary{background:white;color:#145946;border:1px solid #b8ccc0;margin-top:14px}a{color:#145946}p{overflow-wrap:anywhere}@media(max-width:520px){main{margin:24px 12px;padding:22px}}</style><main><h1>'+escape(title)+'</h1>'+body+'</main></html>');
}

export function createHostedAuth({query,key,api,clientId,publicOrigin,authOrigin,anonKey,allowedUsers,fetcher=fetch}){
 if(typeof query!=='function'||!Buffer.isBuffer(key)||key.length!==32||!Array.isArray(allowedUsers)||!allowedUsers.length||!allowedUsers.every(x=>uuid.test(x)))throw Error('Verified QA Auth configuration required');
 const context=hash(JSON.stringify([api,clientId,publicOrigin,authOrigin])),secret=Buffer.from(key),allowed=new Set(allowedUsers),csrfSecret=Buffer.from(hkdfSync("sha256",secret,Buffer.from(context),Buffer.from("qr-csrf"),32));
 function seal(value,cookieHash){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',secret,iv);c.setAAD(Buffer.from(context+':'+cookieHash));const encrypted=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return {iv:iv.toString('base64url'),tag:c.getAuthTag().toString('base64url'),data:encrypted.toString('base64url')};}
 function open(envelope,cookieHash){try{const c=createDecipheriv('aes-256-gcm',secret,Buffer.from(envelope.iv,'base64url'));c.setAAD(Buffer.from(context+':'+cookieHash));c.setAuthTag(Buffer.from(envelope.tag,'base64url'));return JSON.parse(Buffer.concat([c.update(Buffer.from(envelope.data,'base64url')),c.final()]).toString());}catch{throw new AuthError(403);}}
 function claimsFor(token){let claims;try{if(typeof token!=='string'||token.length>8192||token.split('.').length!==3)throw new Error();claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());}catch{throw new AuthError(403);}
  if(claims.iss!==authOrigin+'/auth/v1'||claims.aud!=='authenticated'||claims.role!=='authenticated'||!uuid.test(claims.sub??'')||!['aal1','aal2'].includes(claims.aal)||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=Date.now()||claims.exp*1000>Date.now()+3605000)throw new AuthError(403);return claims;}
 async function verifiedUser(token,{pending=false,requireAal2=false}={}){const claims=claimsFor(token);if(requireAal2&&claims.aal!=='aal2')throw new AuthError(403);const r=await fetcher(authOrigin+'/auth/v1/user',{headers:{apikey:anonKey,Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)throw new AuthError(r.status===401||r.status===403?403:503);const user=await json(r);if(!uuid.test(user.id??'')||user.id!==claims.sub||!allowed.has(user.id)||user.aud!=='authenticated'||user.role!=='authenticated'||user.is_anonymous!==false||typeof user.email!=='string'||!user.email.endsWith('@qa.example.invalid'))throw new AuthError(403);
  if(user.deleted_at||
    (user.banned_until && (!Number.isFinite(Date.parse(user.banned_until))||Date.parse(user.banned_until)>Date.now()))||
    (user.factors!==undefined && (!Array.isArray(user.factors)||user.factors.some(f=>!f||!['verified','unverified'].includes(f.status)||(!pending&&f.status==='verified'&&claims.aal!=='aal2')))))throw new AuthError(403);
  return user;}
 async function ownerIdentity(req){if((req.headers.cookie??'').split(';').some(x=>x.trim().startsWith('__Host-qr_mfa=')))return null;const raw=cookie(req,sessionName);if(!raw)return null;if(!/^[A-Za-z0-9_-]{43}$/.test(raw))throw new AuthError(403);const digest=hash(raw);
  const result=await query('SELECT envelope,expires_at FROM qr_menu_private.qr_auth_sessions WHERE context_id=$1 AND cookie_hash=$2 AND revoked_at IS NULL AND expires_at>clock_timestamp()',[context,digest]);
  if(result.rows.length!==1)return null;const value=open(result.rows[0].envelope,digest),expires=result.rows[0].expires_at,at=expires instanceof Date?expires.getTime():Date.parse(expires);
  if(!uuid.test(value.subject??'')||typeof value.accessToken!=='string'||value.expiresAt!==at)throw new AuthError(403);
  const user=await verifiedUser(value.accessToken);if(user.id!==value.subject)throw new AuthError(403);return user.id;
 }
 function returnTo(value){if(value===undefined||value===null||value===''||value==='/manage')return '/manage';const u=new URL(value,publicOrigin);if(u.origin!==publicOrigin||u.pathname!=='/connect'||u.hash)throw new AuthError(400);const fields=['reylumi_client_id','reylumi_installation','reylumi_authorize_url'];if((u.searchParams.has('reylumi_sandbox')&&(u.searchParams.getAll('reylumi_sandbox').length!==1||u.searchParams.get('reylumi_sandbox')!=='true'))||[...u.searchParams.keys()].some(k=>![...fields,'reylumi_sandbox'].includes(k))||fields.some(k=>u.searchParams.getAll(k).length!==1)||u.searchParams.get('reylumi_client_id')!==clientId||!uuid.test(u.searchParams.get('reylumi_installation')??'')||u.searchParams.get('reylumi_authorize_url')!==api+'/api/market-platform/authorize')throw new AuthError(400);return u.pathname+u.search;}
 function csrf(next){const payload=Buffer.from(JSON.stringify({nonce:randomBytes(24).toString('base64url'),expires:Date.now()+300000,next})).toString('base64url');return payload+'.'+createHmac('sha256',csrfSecret).update(context+':csrf:'+payload).digest('base64url');}
 function verifyCsrf(value,req){if(!equal(value,cookie(req,csrfName))||typeof value!=='string'||value.length>2048)throw new AuthError(403);const parts=value.split('.');if(parts.length!==2||!equal(parts[1],createHmac('sha256',csrfSecret).update(context+':csrf:'+parts[0]).digest('base64url')))throw new AuthError(403);let out;try{out=JSON.parse(Buffer.from(parts[0],'base64url').toString());}catch{throw new AuthError(403);}if(!Number.isSafeInteger(out.expires)||out.expires<=Date.now()||out.expires>Date.now()+300000)throw new AuthError(403);return returnTo(out.next);}
 async function form(req,allowedFields){if(req.headers.origin!==publicOrigin||!/^application\/x-www-form-urlencoded(?:;|$)/i.test(req.headers['content-type']??''))throw new AuthError(403);let size=0,parts=[];const timer=setTimeout(()=>req.destroy?.(),5000);timer.unref?.();try{for await(const part of req){size+=part.length;if(size>4096)throw new AuthError(413);parts.push(part);}}finally{clearTimeout(timer);}const fields=new URLSearchParams(Buffer.concat(parts).toString());if([...fields.keys()].some(k=>!allowedFields.includes(k)||fields.getAll(k).length!==1))throw new AuthError(400);return fields;}
 const csrfCookie=value=>csrfName+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+(value?'300':'0');
 const sessionCookie=(value,age)=>sessionName+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+age;
 function newSession(token,user){const claims=claimsFor(token);if(claims.sub!==user.id)throw new AuthError(403);const raw=randomBytes(32).toString('base64url'),digest=hash(raw),expiresAt=Math.min(claims.exp*1000,Date.now()+3600000);return {raw,digest,expiresAt,envelope:seal({subject:user.id,accessToken:token,expiresAt},digest)};}
 async function retireClientSessions(req){
  if([sessionName,'__Host-qr_mfa'].some(name=>(req.headers.cookie??'').split(';').filter(x=>x.trim().startsWith(name+'=')).length>1))throw new AuthError(400);
  const old=cookie(req,sessionName);if(old&&/^[A-Za-z0-9_-]{43}$/.test(old)){const digest=hash(old),result=await query('UPDATE qr_menu_private.qr_auth_sessions SET revoked_at=clock_timestamp() WHERE context_id=$1 AND cookie_hash=$2 RETURNING cookie_hash',[context,digest]);if(!Array.isArray(result.rows)||result.rows.length>1||(result.rows.length===1&&result.rows[0].cookie_hash!==digest))throw new AuthError(503);}
  const pending=cookie(req,'__Host-qr_mfa');if(pending&&/^[A-Za-z0-9_-]{43}$/.test(pending)){const digest=hash(pending),result=await query("UPDATE qr_menu_private.qr_mfa_pending SET phase='canceled',envelope=NULL,revision=revision+1 WHERE context_id=$1 AND cookie_hash=$2 AND phase IN('ready','busy') RETURNING cookie_hash",[context,digest]);if(!Array.isArray(result.rows)||result.rows.length>1||(result.rows.length===1&&result.rows[0].cookie_hash!==digest))throw new AuthError(503);}
 }
 const mfa=createMfaFlow({query,context,seal,open,verifiedUser,newSession,retireClientSessions,returnTo,csrf,verifyCsrf,form,cookie,hash,escape,page,headers,csrfCookie,sessionCookie,AuthError,authOrigin,anonKey,fetcher});
 async function handle(req,res){if(await mfa.handle(req,res))return true;const u=new URL(req.url,publicOrigin);if(!['/login','/logout'].includes(u.pathname))return false;try{
  if(req.method==='GET'){
   if([...u.searchParams.keys()].some(k=>k!=='next')||u.searchParams.getAll('next').length>1)throw new AuthError(400);
   const next=returnTo(u.searchParams.get('next')),token=csrf(next);res.setHeader('Set-Cookie',csrfCookie(token));
   const body=u.pathname==='/login'?'<p>Use your approved QA app account. After signing in, continue to your salon’s Market to connect the plugin.</p><form method="post" action="/login"><input type="hidden" name="csrf" value="'+escape(token)+'"><p><label>QA email <input type="email" name="email" autocomplete="username" required></label></p><p><label>Password <input type="password" name="password" autocomplete="current-password" required></label></p><button>Sign in to QR app</button></form>':'<p>Sign out of this QR app session. Your salon plugin and published public QR remain installed until you revoke them in Market.</p><form method="post" action="/logout"><input type="hidden" name="csrf" value="'+escape(token)+'"><button>Sign out of QR app</button></form>';
   page(res,200,u.pathname==='/login'?'QR app sign in':'QR app sign out',body);return true;
  }
  if(req.method!=='POST'){headers(res);res.writeHead(405).end();return true;}
  const fields=await form(req,u.pathname==='/login'?['email','password','csrf']:['csrf']),next=verifyCsrf(fields.get('csrf'),req);
  if(u.pathname==='/logout'){
   const raw=cookie(req,sessionName);if(!raw||!/^[A-Za-z0-9_-]{43}$/.test(raw))throw new AuthError(403);
   const result=await query('UPDATE qr_menu_private.qr_auth_sessions SET revoked_at=clock_timestamp() WHERE context_id=$1 AND cookie_hash=$2 RETURNING cookie_hash',[context,hash(raw)]);
   if(result.rows.length!==1||result.rows[0].cookie_hash!==hash(raw))throw new AuthError(503);
   headers(res);res.setHeader('Set-Cookie',[sessionCookie('',0),csrfCookie('')]);res.writeHead(303,{Location:'/login'}).end();return true;
  }
  const email=fields.get('email')??'',password=fields.get('password')??'';if(!/^[a-z0-9._+-]{1,64}@qa\.example\.invalid$/.test(email)||password.length<8||password.length>256)throw new AuthError(400);
  const permit=await query(`INSERT INTO qr_menu_private.qr_auth_limits(context_id,window_start,attempts) VALUES($1,clock_timestamp(),1)
   ON CONFLICT(context_id) DO UPDATE SET window_start=CASE WHEN qr_auth_limits.window_start+interval '60 seconds'<=clock_timestamp() THEN clock_timestamp() ELSE qr_auth_limits.window_start END,
   attempts=CASE WHEN qr_auth_limits.window_start+interval '60 seconds'<=clock_timestamp() THEN 1 ELSE qr_auth_limits.attempts+1 END
   WHERE qr_auth_limits.window_start+interval '60 seconds'<=clock_timestamp() OR qr_auth_limits.attempts<20 RETURNING attempts`,[context]);
  if(permit.rows.length!==1)throw new AuthError(429);
  const response=await fetcher(authOrigin+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anonKey,'Content-Type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new AuthError(response.status===400||response.status===401?403:503);const login=await json(response);
  if(typeof login.access_token!=='string'||login.access_token.length>8192||login.token_type!=='bearer')throw new AuthError(503);
  const claims=claimsFor(login.access_token),user=await verifiedUser(login.access_token,{pending:true});if(user.email!==email)throw new AuthError(403);
  if(claims.aal!=='aal2'&&(user.factors??[]).some(f=>f.status==='verified')){await mfa.begin(req,res,login.access_token,user,next);return true;}
  await retireClientSessions(req);const session=newSession(login.access_token,user);
  const result=await query('INSERT INTO qr_menu_private.qr_auth_sessions(context_id,cookie_hash,envelope,expires_at) VALUES($1,$2,$3::jsonb,$4) RETURNING cookie_hash',[context,session.digest,JSON.stringify(session.envelope),new Date(session.expiresAt).toISOString()]);
  if(result.rows.length!==1||result.rows[0].cookie_hash!==session.digest)throw new AuthError(503);
  headers(res);res.setHeader('Set-Cookie',[sessionCookie(session.raw,Math.max(1,Math.floor((session.expiresAt-Date.now())/1000))),mfa.pendingCookie(''),csrfCookie('')]);res.writeHead(303,{Location:next}).end();return true;
 }catch(error){page(res,error instanceof AuthError?error.status:503,'QR app access unavailable','<p>Your app session or sign-in could not be verified. Sign in again or contact the app developer.</p><p><a href="/login">Sign in again</a> · <a href="'+escape(api+'/market')+'">Back to salon Market</a></p>');return true;}}
 return {ownerIdentity,handle,loginLocation(req){return '/login?'+new URLSearchParams({next:returnTo(req.url)});}};
}

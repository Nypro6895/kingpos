import {createServer} from 'node:http';
import {randomBytes,randomInt,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createServerlessHandler} from '../../examples/qr-menu/serverless.mjs';
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const cookieValue=(response,name)=>response.headers.getSetCookie().find(s=>s.startsWith(name+'=')&&!s.startsWith(name+'=;'))?.split(';')[0];

export async function mfaFixture(t) {
 const ref='q'.repeat(20),key=randomBytes(32),grantKey=randomBytes(32);
 const target={approved:true,marketOrigin:'https://synthetic-market-qa.vercel.app',qrOrigin:'https://synthetic-qr-qa.vercel.app',supabaseOrigin:'https://'+ref+'.supabase.co',postgresHost:'db.'+ref+'.supabase.co',postgresPort:5432,postgresUser:'qr_menu_qa_runtime',appClientId:id(1),allowedAuthUsers:[id(10),id(11)]};
 const env={QR_MENU_QA_ONLY:'true',REYLUMI_MARKET_API_ORIGIN:target.marketOrigin,QR_MENU_PUBLIC_ORIGIN:target.qrOrigin,QR_MENU_AUTH_ORIGIN:target.supabaseOrigin,REYLUMI_MARKET_CLIENT_ID:id(1),REYLUMI_MARKET_CLIENT_SECRET:'rmc_'+'c'.repeat(43),QR_MENU_DATABASE_URL:'postgres://qr_menu_qa_runtime:synthetic-password@'+target.postgresHost+':5432/postgres',QR_MENU_GRANT_KEY:grantKey.toString('base64url'),QR_MENU_SESSION_KEY:key.toString('base64url'),QR_MENU_GRANT_KEY_ID:'test',QR_MENU_AUTH_ANON_KEY:'sb_publishable_'+'p'.repeat(32)};
 const db=new PGlite();await db.exec(readFileSync('examples/qr-menu/storage.sql','utf8'));const servers=[];
 t.after(async()=>{for(const server of servers)if(server.listening)await new Promise(r=>server.close(r));await db.close();});
 const state={mfa:true,removed:false,phoneOnly:false,subject:id(10),challengeCalls:0,verifyCalls:0,marketCalls:0,userCalls:0,pools:0,closed:0,otp:String(randomInt(100000,1000000)),otpPersisted:false,wrongCode:false,badAal:false,wrongSubject:false,badChallenge:false,lostChallenge:false,lostVerify:false,lostWrite:false,holdVerify:null};
 const issued=new Map(),challenges=new Map();let sequence=0;
 const issue=(subject,aal)=>{const token=Buffer.from('{"alg":"synthetic"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({iss:target.supabaseOrigin+'/auth/v1',sub:subject,aud:'authenticated',role:'authenticated',aal,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),jti:++sequence})).toString('base64url')+'.synthetic-signature';issued.set(token,{subject,aal});return token;};
 class Pool {
  constructor() {state.pools++;}on(){}
  async query(q,p=[]) {if(p.some(v=>typeof v==='string'&&v===state.otp))state.otpPersisted=true;const result=await db.query(q,p);if(state.lostWrite&&q.startsWith('WITH consumed AS'))throw Error('Synthetic lost committed MFA write');if(state.badRetireAck&&q.startsWith('UPDATE qr_menu_private.qr_auth_sessions SET revoked_at'))return {rows:null};return result;}
  async end(){state.closed++;}
 }
 const fetcher=async(url,options)=>{
  const u=new URL(url);if(u.origin===target.marketOrigin){state.marketCalls++;throw Error('No Market API request is expected before callback');}
  if(u.origin!==target.supabaseOrigin)throw Error('Unexpected synthetic origin');
  if(u.pathname==='/auth/v1/token'){return Response.json({token_type:'bearer',access_token:issue(state.subject,'aal1')});}
  const auth=issued.get(options.headers.Authorization?.slice(7));if(!auth)return Response.json({}, {status:401});
  if(u.pathname==='/auth/v1/user'){state.userCalls++;return Response.json({id:auth.subject,aud:'authenticated',role:'authenticated',email:auth.subject===id(10)?'owner@qa.example.invalid':'other@qa.example.invalid',is_anonymous:false,factors:state.mfa&&!state.removed?[{id:id(20),factor_type:state.phoneOnly?'phone':'totp',status:'verified',friendly_name:'Synthetic authenticator'},{id:id(21),factor_type:state.phoneOnly?'webauthn':'totp',status:'verified',friendly_name:'Backup authenticator'}]:[]});}
  const match=u.pathname.match(/^\/auth\/v1\/factors\/([^/]+)\/(challenge|verify)$/);if(!match)throw Error('No enrollment or other Auth operation is allowed');
  if(match[2]==='challenge'){state.challengeCalls++;const challenge=id(100+state.challengeCalls);challenges.set(challenge,{factor:match[1],used:false});if(state.lostChallenge)throw Error('Synthetic lost challenge response');return Response.json({id:state.badChallenge?'invalid':challenge,type:'totp',expires_at:Math.floor(Date.now()/1000)+300});}
  state.verifyCalls++;const body=JSON.parse(options.body),challenge=challenges.get(body.challenge_id);
  // Never persist or print OTP, including in assertion diagnostics.
  const valid=Boolean(challenge&&!challenge.used&&challenge.factor===match[1]&&body.code===state.otp&&!state.wrongCode);if(challenge)challenge.used=true;
  if(state.removeOnVerify)state.removed=true;
  if(state.holdVerify)await state.holdVerify;
  if(state.lostVerify)throw Error('Synthetic lost verify response');
  if(!valid)return Response.json({}, {status:400});
  return Response.json({token_type:'bearer',access_token:issue(state.wrongSubject?id(11):auth.subject,state.badAal?'aal1':'aal2')});
 };
 async function start(){const server=createServer(createServerlessHandler({env,target,loadPool:async()=>Pool,fetcher}));await new Promise(r=>server.listen(0,'127.0.0.1',r));servers.push(server);return 'http://127.0.0.1:'+server.address().port;}
 const base=await start();
 async function login(cookies='',next='/manage') {const first=await fetch(base+'/login?'+new URLSearchParams({next})),html=await first.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)[1];return fetch(base+'/login',{method:'POST',redirect:'manual',headers:{Origin:target.qrOrigin,'Content-Type':'application/x-www-form-urlencoded',cookie:[cookies,cookieValue(first,'__Host-qr_csrf')].filter(Boolean).join('; ')},body:new URLSearchParams({email:state.subject===id(10)?'owner@qa.example.invalid':'other@qa.example.invalid',password:'synthetic-password',csrf})});}
 async function view(pending,origin=base,lang='en'){const response=await fetch(origin+'/mfa?lang='+lang,{headers:{cookie:pending}}),html=await response.text();return {response,html,csrf:html.match(/name="csrf" value="([^"]+)"/)?.[1],csrfCookie:cookieValue(response,'__Host-qr_csrf')};}
 async function post(pending,page,operation,extra={},origin=base){return fetch(origin+'/mfa',{method:'POST',redirect:'manual',headers:{Origin:target.qrOrigin,'Content-Type':'application/x-www-form-urlencoded',cookie:[pending,page.csrfCookie].filter(Boolean).join('; ')},body:new URLSearchParams({operation,csrf:page.csrf,lang:'en',...extra})});}
 const digest=pending=>createHash('sha256').update(pending.split('=')[1]).digest('hex');
 async function row(pending){return (await db.query('select * from qr_menu_private.qr_mfa_pending where cookie_hash=$1',[digest(pending)])).rows[0];}
 async function payload(pending,change){const current=await row(pending),aad=Buffer.from(current.context_id+':mfa:'+current.cookie_hash+':'+current.revision),dec=createDecipheriv('aes-256-gcm',key,Buffer.from(current.envelope.iv,'base64url'));dec.setAAD(aad);dec.setAuthTag(Buffer.from(current.envelope.tag,'base64url'));const value=JSON.parse(Buffer.concat([dec.update(Buffer.from(current.envelope.data,'base64url')),dec.final()]).toString());if(change){change(value);const iv=randomBytes(12),enc=createCipheriv('aes-256-gcm',key,iv);enc.setAAD(aad);const bytes=Buffer.concat([enc.update(JSON.stringify(value)),enc.final()]);await db.query('update qr_menu_private.qr_mfa_pending set envelope=$1::jsonb where cookie_hash=$2',[JSON.stringify({iv:iv.toString('base64url'),tag:enc.getAuthTag().toString('base64url'),data:bytes.toString('base64url')}),current.cookie_hash]);}return value;}
 return {db,state,target,env,base,start,login,view,post,row,payload};
}

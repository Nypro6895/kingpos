import {randomBytes} from 'node:crypto';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const pendingName='__Host-qr_mfa';

// Server-only helpers; no request field supplies a token, user ID or AAL.
export function createMfaFlow(h) {
  const {query,context,seal,open,verifiedUser,newSession,retireClientSessions,returnTo,csrf,verifyCsrf,form,cookie,hash,escape,page,headers,csrfCookie,sessionCookie,AuthError,authOrigin,anonKey,fetcher}=h;
  const pendingCookie=(raw,age=600)=>pendingName+'='+raw+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+(raw?age:0);
  const aad=(digest,revision)=>'mfa:'+digest+':'+revision;
  const factors=user=>{
    const selected=(user.factors??[]).filter(f=>f.status==='verified'&&f.factor_type==='totp');
    if(!selected.length||selected.length>10||selected.some(f=>!uuid.test(f.id??'')||(f.friendly_name!=null&&typeof f.friendly_name!=='string'))||new Set(selected.map(f=>f.id)).size!==selected.length)throw new AuthError(403);
    return selected.map((f,i)=>({id:f.id,label:(f.friendly_name||'Authenticator app '+(i+1)).slice(0,80)}));
  };
  async function begin(req,res,token,user,next) {
    const choices=factors(user);await retireClientSessions(req);
    const raw=randomBytes(32).toString('base64url'),digest=hash(raw),expiresAt=Math.min(Date.now()+600000,JSON.parse(Buffer.from(token.split('.')[1],'base64url')).exp*1000);
    const value={subject:user.id,accessToken:token,expiresAt,next:returnTo(next),factors:choices,challenge:null};
    const result=await query('INSERT INTO qr_menu_private.qr_mfa_pending(context_id,cookie_hash,envelope,expires_at) VALUES($1,$2,$3::jsonb,$4) RETURNING cookie_hash',[context,digest,JSON.stringify(seal(value,aad(digest,0))),new Date(expiresAt).toISOString()]);
    if(result.rows.length!==1||result.rows[0].cookie_hash!==digest)throw new AuthError(503);
    headers(res);res.setHeader('Set-Cookie',[sessionCookie('',0),pendingCookie(raw),csrfCookie('')]);res.writeHead(303,{Location:'/mfa'}).end();
  }
  const language=v=>v==='vi'?'vi':'en';
  const words={en:{title:'Verify your sign-in',intro:'Use an authenticator already enrolled on your account. No new factor is created.',factor:'Authenticator',start:'Start verification',code:'Verification code',verify:'Verify and sign in',cancel:'Cancel sign-in',expired:'This verification expired or was interrupted. Sign in again; no app access has been issued.',retry:'The code was not verified. Start a new challenge before trying again.',pending:'A request is being resolved. Do not submit it again. Cancel and sign in again if the result stays unclear.',limits:'Verification expires within 10 minutes. Up to 5 code attempts are allowed.',restart:'Sign in again'},vi:{title:'Xác minh đăng nhập',intro:'Dùng ứng dụng xác thực đã đăng ký trên tài khoản. Không tạo thêm phương thức xác thực.',factor:'Ứng dụng xác thực',start:'Bắt đầu xác minh',code:'Mã xác minh',verify:'Xác minh và đăng nhập',cancel:'Hủy đăng nhập',expired:'Phiên xác minh đã hết hạn hoặc bị gián đoạn. Hãy đăng nhập lại; chưa cấp quyền truy cập app.',retry:'Mã chưa được xác minh. Bắt đầu lượt xác minh mới trước khi thử lại.',pending:'Yêu cầu đang được xử lý. Không gửi lại. Hủy và đăng nhập lại nếu kết quả vẫn chưa rõ.',limits:'Phiên xác minh tối đa 10 phút, cho phép tối đa 5 lần thử mã.',restart:'Đăng nhập lại'}};
  async function read(req) {
    const raw=cookie(req,pendingName);if(!raw||!/^[A-Za-z0-9_-]{43}$/.test(raw))throw new AuthError(403);const digest=hash(raw);
    const result=await query('SELECT envelope,expires_at,revision,phase,attempts,challenges FROM qr_menu_private.qr_mfa_pending WHERE context_id=$1 AND cookie_hash=$2 AND expires_at>clock_timestamp()',[context,digest]);
    if(result.rows.length!==1)throw new AuthError(403);const row=result.rows[0];
    if(!['ready','busy'].includes(row.phase))throw new AuthError(403);
    if(row.phase==='busy')return {digest,row,value:null};
    const value=open(row.envelope,aad(digest,String(row.revision))),date=row.expires_at,expires=date instanceof Date?date.getTime():Date.parse(date);
    if(!uuid.test(value.subject??'')||typeof value.accessToken!=='string'||value.expiresAt!==expires||returnTo(value.next)!==value.next||!Array.isArray(value.factors))throw new AuthError(403);
    return {digest,row,value};
  }
  function view(res,loaded,lang,error) {
    const w=words[lang],nonce=csrf('/manage'),hidden='<input type="hidden" name="csrf" value="'+escape(nonce)+'"><input type="hidden" name="lang" value="'+lang+'">';
    res.setHeader('Set-Cookie',csrfCookie(nonce));
    let body='<p>'+escape(w.intro)+'</p><p><a href="/mfa?lang=en">English</a> · <a href="/mfa?lang=vi">Tiếng Việt</a></p>';
    if(error)body+='<p role="alert">'+escape(error)+'</p>';
    if(loaded?.row.phase==='busy')body+='<p role="alert">'+escape(w.pending)+'</p>';
    else if(loaded?.value){
      const challenge=loaded.value.challenge;
      if(challenge&&challenge.expiresAt>Date.now())body+='<form method="post" action="/mfa">'+hidden+'<input type="hidden" name="operation" value="verify"><p><label>'+escape(w.code)+'<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label></p><button>'+escape(w.verify)+'</button></form>';
      else body+='<form method="post" action="/mfa">'+hidden+'<input type="hidden" name="operation" value="challenge"><p><label>'+escape(w.factor)+'<select name="factor" required>'+loaded.value.factors.map(f=>'<option value="'+escape(f.id)+'">'+escape(f.label)+'</option>').join('')+'</select></label></p><button>'+escape(w.start)+'</button></form>';
      body+='<p>'+escape(w.limits)+'</p>';
    }else body+='<p role="alert">'+escape(w.expired)+'</p><p><a href="/login">'+escape(w.restart)+'</a></p>';
    if(loaded)body+='<form method="post" action="/mfa">'+hidden+'<input type="hidden" name="operation" value="cancel"><button class="secondary">'+escape(w.cancel)+'</button></form>';
    page(res,error?403:200,w.title,body,lang);
  }
  async function provider(path,token,body) {
    return fetcher(authOrigin+'/auth/v1/'+path,{method:'POST',headers:{apikey:anonKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  }
  async function boundedJson(response){let size=0,parts=[];for await(const part of response.body){size+=part.length;if(size>32768)throw new AuthError(503);parts.push(part);}return JSON.parse(Buffer.concat(parts).toString());}
  async function release(loaded,value) {
    const result=await query("UPDATE qr_menu_private.qr_mfa_pending SET phase='ready',envelope=$4::jsonb WHERE context_id=$1 AND cookie_hash=$2 AND revision=$3::bigint AND phase='busy' AND expires_at>clock_timestamp() RETURNING revision",[context,loaded.digest,String(loaded.row.revision),JSON.stringify(seal(value,aad(loaded.digest,String(loaded.row.revision))))]);
    if(result.rows.length!==1)throw new AuthError(409);
  }
  async function exhaust(loaded,res,lang){
    const result=await query("UPDATE qr_menu_private.qr_mfa_pending SET phase='canceled',envelope=NULL,revision=revision+1 WHERE context_id=$1 AND cookie_hash=$2 AND revision=$3::bigint AND phase='busy' RETURNING cookie_hash",[context,loaded.digest,String(loaded.row.revision)]);
    if(result.rows.length!==1||result.rows[0].cookie_hash!==loaded.digest)throw new AuthError(409);
    res.setHeader('Set-Cookie',[pendingCookie(''),csrfCookie('')]);page(res,403,words[lang].title,'<p role="alert">'+(lang==='vi'?'Đã hết số lần thử. Hãy đăng nhập lại.':'The attempt limit was reached. Sign in again.')+'</p><p><a href="/login">'+escape(words[lang].restart)+'</a></p>',lang);
  }
  async function handle(req,res) {
    const url=new URL(req.url,'https://local.invalid');if(url.pathname!=='/mfa')return false;
    let lang=language(url.searchParams.get('lang')),loaded;
    try {
      if([...url.searchParams.keys()].some(k=>k!=='lang')||url.searchParams.getAll('lang').length>1)throw new AuthError(400);
      if(req.method==='GET'){loaded=await read(req);if(loaded.value){const user=await verifiedUser(loaded.value.accessToken,{pending:true});if(user.id!==loaded.value.subject)throw new AuthError(403);const current=factors(user);if(loaded.value.factors.some(f=>!current.some(c=>c.id===f.id)))throw new AuthError(403);}view(res,loaded,lang);return true;}
      if(req.method!=='POST'){headers(res);res.writeHead(405).end();return true;}
      const fields=await form(req,['csrf','lang','operation','factor','code']);verifyCsrf(fields.get('csrf'),req);lang=language(fields.get('lang'));const operation=fields.get('operation');
      if(!['challenge','verify','cancel'].includes(operation)||[...fields.keys()].some(k=>!['csrf','lang','operation',...(operation==='challenge'?['factor']:operation==='verify'?['code']:[])].includes(k)))throw new AuthError(400);
      const raw=cookie(req,pendingName);if(!raw||!/^[A-Za-z0-9_-]{43}$/.test(raw))throw new AuthError(403);const digest=hash(raw);
      if(operation==='cancel'){
        const result=await query("UPDATE qr_menu_private.qr_mfa_pending SET phase='canceled',envelope=NULL,revision=revision+1 WHERE context_id=$1 AND cookie_hash=$2 AND phase IN('ready','busy') RETURNING cookie_hash",[context,digest]);
        if(result.rows.length!==1||result.rows[0].cookie_hash!==digest)throw new AuthError(409);headers(res);res.setHeader('Set-Cookie',[pendingCookie(''),sessionCookie('',0),csrfCookie('')]);res.writeHead(303,{Location:'/login'}).end();return true;
      }
      loaded=await read(req);if(!loaded.value)throw new AuthError(409);
      const code=fields.get('code')?.replace(/\s+/g,'');if(operation==='verify'&&!/^[0-9]{6}$/.test(code??''))throw new AuthError(400);
      if(operation==='verify'&&loaded.value.challenge&&loaded.value.challenge.expiresAt<=Date.now()){view(res,loaded,lang,words[lang].expired);return true;}
      const selected=operation==='challenge'?fields.get('factor'):loaded.value.challenge?.factorId;
      if(!uuid.test(selected??'')||!loaded.value.factors.some(f=>f.id===selected))throw new AuthError(403);
      const claimed=await query(`UPDATE qr_menu_private.qr_mfa_pending SET phase='busy',revision=revision+1,attempts=attempts+$4,challenges=challenges+$5
        WHERE context_id=$1 AND cookie_hash=$2 AND revision=$3::bigint AND phase='ready' AND expires_at>clock_timestamp() AND attempts<5 AND challenges<=$6 RETURNING revision,attempts,challenges`,[context,digest,String(loaded.row.revision),operation==='verify'?1:0,operation==='challenge'?1:0,operation==='challenge'?4:5]);
      if(claimed.rows.length!==1)throw new AuthError(409);loaded.row={...loaded.row,...claimed.rows[0],phase:'busy'};
      const user=await verifiedUser(loaded.value.accessToken,{pending:true});if(user.id!==loaded.value.subject||!factors(user).some(f=>f.id===selected))throw new AuthError(403);
      if(operation==='challenge'){
        const response=await provider('factors/'+selected+'/challenge',loaded.value.accessToken,{factorId:selected});if(!response.ok)throw new AuthError(503);const challenge=await boundedJson(response);
        if(!uuid.test(challenge.id??'')||challenge.type!=='totp'||!Number.isSafeInteger(challenge.expires_at)||challenge.expires_at*1000<=Date.now()||challenge.expires_at*1000>Date.now()+600000)throw new AuthError(503);
        loaded.value.challenge={id:challenge.id,factorId:selected,expiresAt:Math.min(challenge.expires_at*1000,loaded.value.expiresAt)};await release(loaded,loaded.value);headers(res);res.writeHead(303,{Location:'/mfa?lang='+lang}).end();return true;
      }
      const challenge=loaded.value.challenge;loaded.value.challenge=null;
      if(!challenge||challenge.expiresAt<=Date.now()){if(loaded.row.attempts>=5){await exhaust(loaded,res,lang);return true;}await release(loaded,loaded.value);view(res,await read(req),lang,words[lang].expired);return true;}
      const response=await provider('factors/'+selected+'/verify',loaded.value.accessToken,{challenge_id:challenge.id,code});
      if(!response.ok){if([400,401,403].includes(response.status)){if(loaded.row.attempts>=5){await exhaust(loaded,res,lang);return true;}await release(loaded,loaded.value);view(res,await read(req),lang,words[lang].retry);return true;}throw new AuthError(503);}
      const verification=await boundedJson(response);if(verification.token_type!=='bearer'||typeof verification.access_token!=='string')throw new AuthError(503);
      const verified=await verifiedUser(verification.access_token,{requireAal2:true});if(verified.id!==loaded.value.subject||!factors(verified).some(f=>f.id===selected))throw new AuthError(403);
      const session=newSession(verification.access_token,verified);
      const committed=await query(`WITH consumed AS (UPDATE qr_menu_private.qr_mfa_pending SET phase='consumed',envelope=NULL,revision=revision+1
        WHERE context_id=$1 AND cookie_hash=$2 AND revision=$3::bigint AND phase='busy' AND expires_at>clock_timestamp() RETURNING context_id)
        INSERT INTO qr_menu_private.qr_auth_sessions(context_id,cookie_hash,envelope,expires_at) SELECT context_id,$4,$5::jsonb,$6 FROM consumed RETURNING cookie_hash`,[context,digest,String(loaded.row.revision),session.digest,JSON.stringify(session.envelope),new Date(session.expiresAt).toISOString()]);
      if(committed.rows.length!==1||committed.rows[0].cookie_hash!==session.digest)throw new AuthError(409);
      headers(res);res.setHeader('Set-Cookie',[sessionCookie(session.raw,Math.max(1,Math.floor((session.expiresAt-Date.now())/1000))),pendingCookie(''),csrfCookie('')]);res.writeHead(303,{Location:loaded.value.next}).end();return true;
    }catch(error){headers(res);const status=error instanceof AuthError?error.status:503;page(res,status,words[lang].title,'<p role="alert">'+escape(words[lang].expired)+'</p><p><a href="/mfa?lang='+lang+'">'+escape(words[lang].title)+'</a> · <a href="/login">'+escape(words[lang].restart)+'</a></p>',lang);return true;}
  }
  return {begin,handle,pendingName,pendingCookie};
}

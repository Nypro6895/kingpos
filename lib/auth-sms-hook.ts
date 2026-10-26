import {createHmac,timingSafeEqual} from 'node:crypto';

// Supabase Auth HTTP hooks use the Standard Webhooks signature specification.
export function verifyAuthSmsHook(body:string, headers:Headers, secret:string, now=Date.now()) {
 const id=headers.get('webhook-id'), timestamp=headers.get('webhook-timestamp'), signature=headers.get('webhook-signature');
 if(!id || !timestamp || !signature || !/^\d+$/.test(timestamp) || Math.abs(now/1000-Number(timestamp))>300) return false;
 const raw=secret.replace(/^v1,whsec_|^whsec_/,'');
 const key=Buffer.from(raw,'base64');
 if(key.length<32) return false;
 const expected=createHmac('sha256',key).update(`${id}.${timestamp}.${body}`).digest();
 return signature.split(' ').some(part=>{
  if(!part.startsWith('v1,')) return false;
  const actual=Buffer.from(part.slice(3),'base64');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
 });
}

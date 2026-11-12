import fs from 'node:fs';
import path from 'node:path';
import {runtime} from './common.mjs';
if(process.env.REYLUMI_QA_MODE!=='local'||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:55421'||process.env.NEXT_PUBLIC_APP_URL!=='http://localhost:3117')throw Error('QA guard requires exact local endpoints');
const token=fs.readFileSync(path.join(runtime,'provider-token'),'utf8');
const original=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(['http:','https:'].includes(url.protocol)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname))return original(input,options);
 const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
 let target;
 if(url.origin==='https://api.stripe.com'&&headers.get('Authorization')==='Bearer sk_test_qa_local_only')target='/stripe'+url.pathname.replace(/^\/v1/,'')+url.search;
 if(url.origin==='https://api.resend.com'&&headers.get('Authorization')==='Bearer qa_local_capture_only')target='/resend'+url.pathname+url.search;
 if(!target)throw new TypeError('QA blocked outbound host: '+url.hostname);
 const method=options.method||(input instanceof Request?input.method:'GET');
 const body=options.body||(input instanceof Request&&method!=='GET'?await input.text():undefined);
 return original('http://127.0.0.1:3118'+target,{method,body,headers:{'x-qa-token':token,'Content-Type':headers.get('Content-Type')||'application/json'},signal:options.signal});
};

// Temporary HTTPS tunnel entry. Only synthetic isolated fixture sessions.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const file='artifacts/review-experience-flow-20261029/https-origin.txt';
http.createServer(async(req,res)=>{
 const started=Date.now();
 const login=req.url.startsWith('/__review-qa-login');
 if(login&&new URL(req.url,'http://qa.local').searchParams.get('key')!==fs.readFileSync('artifacts/review-experience-flow-20261029/qa-entry-key.txt','utf8').trim()){res.writeHead(403);res.end();return;}
 if(!login&&req.headers.cookie?.includes('review-native=1')){
  const pathname=new URL(req.url,'http://qa.local').pathname,bundle=path.resolve('ios/Reylumi/LocalAppBundle');
  const candidate=path.resolve(bundle,'.'+pathname);
  const asset=candidate.startsWith(bundle+path.sep)&&fs.existsSync(candidate)&&fs.statSync(candidate).isFile()?candidate:null;
  const html=!pathname.startsWith('/api/')&&!pathname.startsWith('/_next/')&&!asset;
  if(asset||html){const target=asset||path.join(bundle,'index.html');const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2'};res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(fs.readFileSync(target));return;}
 }
 const url=login?`http://127.0.0.1:54339${req.url.replace('/__review-qa-login','/qa-login')}`:`http://127.0.0.1:3117${req.url}`;
 try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const headers={...req.headers};delete headers.host;delete headers['content-length'];
  if(!login){headers.host=req.headers.host;headers['x-forwarded-host']=req.headers.host;headers['x-forwarded-proto']='https';}
  if(new URL(req.url,'http://qa.local').pathname==='/api/app-local/command'){
    if(req.headers.origin!==`https://${req.headers.host}`){res.writeHead(403);res.end();return;}
    // Next start binds 0.0.0.0:3117 and constructs its internal Request URL
    // from that host. Preserve the same-origin gate at this test proxy boundary.
    headers.origin='https://0.0.0.0:3117';
  }
  const r=await fetch(url,{method:req.method,headers,body:!['GET','HEAD'].includes(req.method)?Buffer.concat(chunks):undefined,redirect:'manual'});
  const output={};for(const [key,value]of r.headers)if(!['content-encoding','content-length','transfer-encoding','set-cookie','connection'].includes(key))output[key]=value;
  if(login){output.location=fs.readFileSync(file,'utf8').trim()+new URL(r.headers.get('location')).pathname+new URL(r.headers.get('location')).search+new URL(r.headers.get('location')).hash;output['set-cookie']=[...r.headers.getSetCookie(),`review-native=${new URL(req.url,'http://qa.local').searchParams.get('native')==='1'?'1':'0'}; Path=/; SameSite=Lax`];}
  res.writeHead(r.status,output);for await(const chunk of r.body??[])res.write(chunk);res.end();console.log(req.method,new URL(req.url,'http://qa.local').pathname,r.status,Date.now()-started);
 }catch{if(!res.headersSent)res.writeHead(503);res.end();}
}).listen(3118,'127.0.0.1',()=>console.log('HTTPS review entry ready.'));

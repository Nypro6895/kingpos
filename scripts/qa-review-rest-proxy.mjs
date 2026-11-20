// Async bridge to the disposable network-isolated fixture; no linked DB access.
import http from 'node:http';
import {spawn} from 'node:child_process';
const container=process.argv[2];if(!/^review-flow-[a-z0-9]+-db$/.test(container||''))throw Error('Expected owned review fixture');
const docker='C:/Program Files/Docker/Docker/resources/bin/docker.exe';
const quote=value=>JSON.stringify(String(value));
http.createServer(async(req,res)=>{
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'http://192.168.1.209:3117','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS'});res.end();return;}
 const isRest=req.url.startsWith('/rest/v1'),isAuth=req.url.startsWith('/auth/v1');
 if(!isRest&&!isAuth){res.writeHead(404);res.end();return;}
 const body=[];for await(const b of req)body.push(b);const raw=Buffer.concat(body).toString();
 const token=req.headers.authorization?.replace(/^Bearer /i,'');
 const config=[`url = ${quote(`http://127.0.0.1:${isAuth?9999:3000}${req.url.slice((isAuth?'/auth/v1':'/rest/v1').length)}`)}`,`request = ${quote(req.method)}`,'silent','show-error','include','max-time = 20','header = "Content-Type: application/json"',
  ...['prefer','accept'].filter(k=>req.headers[k]).map(k=>`header = ${quote(`${k}: ${req.headers[k]}`)}`),
  token&&token!=='isolated-review-fixture'?`header = ${quote(`Authorization: Bearer ${token}`)}`:'',raw?`data = ${quote(raw)}`:''].filter(Boolean).join('\n');
 const child=spawn(docker,['--context','desktop-linux','exec','-i',container,'curl','--config','-'],{windowsHide:true});let output='',error='';
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);child.stdin.end(config);
 child.on('error',()=>{if(!res.headersSent){res.writeHead(503);res.end('{}');}});
 child.on('close',code=>{
  if(res.headersSent)return;
  if(code){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'Fixture transport unavailable'}));return;}
  const separator=output.includes('\r\n\r\n')?'\r\n\r\n':'\n\n',at=output.indexOf(separator),head=output.slice(0,at),data=output.slice(at+separator.length);
  const headers={'Access-Control-Allow-Origin':'http://192.168.1.209:3117'};
  for(const line of head.split(/\r?\n/).slice(1)){const split=line.indexOf(':');if(split>0&&['content-type','content-range','range-unit','preference-applied'].includes(line.slice(0,split).toLowerCase()))headers[line.slice(0,split)]=line.slice(split+1).trim();}
  res.writeHead(Number(head.match(/^HTTP\/\S+ (\d+)/)?.[1]||502),headers);res.end(data);
 });
}).listen(54340,'0.0.0.0',()=>console.log('Async isolated review bridge ready.'));

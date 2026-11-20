// Test-only async gateway to the already-owned, network-isolated fixture.
import http from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
const docker=process.env.REWARD_TEST_DOCKER||'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
const db=process.env.REWARD_TEST_DB;
if(!db||!/^reward-browser-[a-z0-9]+-db$/.test(db))throw Error('Set REWARD_TEST_DB to the owned browser fixture container');
const meta=JSON.parse(execFileSync(docker,['--context','desktop-linux','inspect',db],{encoding:'utf8'}))[0];
if(!meta.Config.Labels['com.codex.task']||meta.HostConfig.NetworkMode!=='none')throw Error('Expected owned isolated fixture');
http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://fixture');
  if(url.pathname==='/login-fixture'){
   const login=await fetch('http://127.0.0.1:4078'+req.url,{redirect:'manual'});res.setHeader('Set-Cookie',login.headers.getSetCookie());res.statusCode=302;res.setHeader('Location','http://'+req.headers.host.split(':')[0]+':4082'+(url.searchParams.get('role')==='owner'?'/reward-system':'/qr'));res.end();return;
  }
  const auth=url.pathname.startsWith('/auth/v1'),storage=url.pathname.startsWith('/storage/v1');const prefix=auth?'/auth/v1':storage?'/storage/v1':'/rest/v1';
  if(!url.pathname.startsWith(prefix)){res.statusCode=404;res.end();return;}
  const port=auth?9999:storage?5000:3000;let raw='';for await(const c of req)raw+=c;
  const headers=['prefer','accept','range','content-type'].filter(k=>req.headers[k]).map(k=>'header = '+JSON.stringify(k+': '+req.headers[k]));
  const bearer=req.headers.authorization;if(bearer?.split('.').length===3)headers.push('header = '+JSON.stringify('Authorization: '+bearer));
  const config=['url = '+JSON.stringify('http://127.0.0.1:'+port+url.pathname.slice(prefix.length)+url.search),'request = '+JSON.stringify(req.method),'silent','show-error','include','max-time = 20',...headers,raw?'data = '+JSON.stringify(raw):''].filter(Boolean).join('\n');
  const output=await new Promise((resolve,reject)=>{const child=spawn(docker,['--context','desktop-linux','exec','-i',db,'curl','--config','-'],{windowsHide:true});let out='';child.stdout.on('data',d=>out+=d);child.on('error',reject);child.on('close',c=>c===0?resolve(out):reject(Error('Fixture gateway failed')));child.stdin.end(config);});
  const separator=output.includes('\r\n\r\n')?'\r\n\r\n':'\n\n',i=output.indexOf(separator),head=output.slice(0,i);res.statusCode=Number(head.match(/^HTTP\/\S+ (\d+)/)?.[1]||500);res.setHeader('Content-Type','application/json');res.end(output.slice(i+separator.length));
 }catch{res.statusCode=500;res.end('{"error":"Isolated fixture gateway failed"}');}
}).listen(4079,'127.0.0.1',()=>console.log('ASYNC_FIXTURE_READY'));

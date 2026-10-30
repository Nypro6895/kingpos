import {spawn} from 'node:child_process';
// Real concurrent requests to the isolated PostgREST server. Credentials go
// through curl's stdin config, never shell commands, argv, logs or artifacts.
export function rewardParallelRpc(f, actor, name, args) {
 const docker=process.env.TEST_DOCKER_PATH||'C:/Program Files/Docker/Docker/resources/bin/docker.exe';
 const context=process.env.TEST_DOCKER_CONTEXT||'desktop-linux';
 if(!/^(?:reward-security|rewardlumi)-[a-z0-9]+-db$/.test(f.evidence.containers.db)||!/^(?:reward_[a-z_]+|gift_card_pos)$/.test(name))throw Error('Expected isolated Reward fixture RPC');
 const config=['url = '+JSON.stringify('http://127.0.0.1:3000/rpc/'+name),'request = "POST"','silent','show-error','include','max-time = 30','header = "Content-Type: application/json"','header = '+JSON.stringify('Authorization: Bearer '+actor.token),'data = '+JSON.stringify(JSON.stringify(args))].join('\n');
 return new Promise((resolve,reject)=>{
  const p=spawn(docker,['--context',context,'exec','-i',f.evidence.containers.db,'curl','--config','-'],{windowsHide:true});let out='',err='';
  p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',()=>reject(Error('Fixture concurrent process failed')));
  p.on('close',code=>{if(code!==0)return reject(Error(f.redact(err).slice(0,1000)));const separator=out.includes('\r\n\r\n')?'\r\n\r\n':'\n\n',i=out.indexOf(separator);try{resolve({status:Number(out.slice(0,i).match(/^HTTP\/\S+ (\d+)/)?.[1]),data:JSON.parse(out.slice(i+separator.length))});}catch{reject(Error('Invalid fixture RPC response'));}});p.stdin.end(config);
 });
}

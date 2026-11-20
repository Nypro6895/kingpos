import http from 'node:http';
import {execFileSync} from 'node:child_process';
const project='reylumi-qa-20261111';
const socketPath=process.platform==='win32'?'//./pipe/dockerDesktopLinuxEngine':'/var/run/docker.sock';
function api(method,url,data){return new Promise((resolve,reject)=>{
 const body=data===undefined?undefined:JSON.stringify(data);
 const request=http.request({socketPath,path:'/v1.47'+url,method,headers:body?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}:{}},response=>{let text='';response.on('data',v=>text+=v);response.on('end',()=>{if(response.statusCode>=400)return reject(Error('Docker API '+response.statusCode+' '+url));resolve(text?JSON.parse(text):null);});});request.on('error',reject);request.end(body);
});}
// Only containers created for this QA project. Old containers remain stopped as
// rollback points; named volumes are reused, never deleted or copied from live.
export async function bindLoopback(){
 const names=execFileSync('docker',['ps','-a','--filter','label=com.supabase.cli.project='+project,'--format','{{.Names}}'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(n=>n.endsWith('_'+project));
 if(!names.length)throw Error('QA containers not found');
 let databaseRebound=false;
 for(const name of names){
  const info=await api('GET','/containers/'+name+'/json');
  const ports=info.HostConfig.PortBindings||{};
  if(!Object.values(ports).flat().some(p=>p.HostIp!=='127.0.0.1'))continue;
  const host={...info.HostConfig,PortBindings:Object.fromEntries(Object.entries(ports).map(([port,values])=>[port,values.map(v=>({...v,HostIp:'127.0.0.1'}))]))};
  const backup=name+'-before-loopback-'+Date.now();
  await api('POST','/containers/'+name+'/stop?t=15');
  await api('POST','/containers/'+name+'/rename?name='+backup);
  await api('POST','/containers/'+backup+'/update',{RestartPolicy:{Name:'no'}});
  const endpoints=Object.fromEntries(Object.keys(info.NetworkSettings.Networks).map(network=>[network,{Aliases:[name]}]));
  try{
   await api('POST','/containers/create?name='+name,{...info.Config,HostConfig:host,NetworkingConfig:{EndpointsConfig:endpoints}});
   if(name.startsWith('supabase_kong_')){
    const archive=execFileSync('docker',['cp',backup+':/home/kong','-'],{stdio:['ignore','pipe','pipe']});
    execFileSync('docker',['cp','-a','-',name+':/home/'],{input:archive,stdio:['pipe','pipe','pipe']});
   }
   let started=false;
   for(let attempt=0;attempt<4;attempt++){
    try{await api('POST','/containers/'+name+'/start');started=true;break;}catch{await new Promise(r=>setTimeout(r,1500));}
   }
   if(!started)throw Error('Container start did not succeed');
   if(name.startsWith('supabase_db_'))databaseRebound=true;
  }catch(error){throw Error('Loopback rebind failed for '+name+'; stopped backup retained: '+backup+'; '+error.message);}
 }
 if(databaseRebound){
  for(const name of names.filter(n=>/^supabase_(auth|rest|storage|realtime|pg_meta)_/.test(n)))await api('POST','/containers/'+name+'/restart?t=10');
 }
 let healthy=false;
 for(let attempt=0;attempt<40;attempt++){
  const states=await Promise.all(names.map(n=>api('GET','/containers/'+n+'/json')));
  healthy=states.every(i=>i.State.Running&&(!i.State.Health||i.State.Health.Status==='healthy'));
  if(healthy)break;await new Promise(r=>setTimeout(r,1000));
 }
 if(!healthy)throw Error('QA containers did not become healthy after loopback binding');
 const verified=await api('GET','/containers/json?all=1');
 for(const container of verified.filter(c=>c.Names.some(n=>n.endsWith('_'+project))))
  if(container.Ports?.some(p=>p.PublicPort&&p.IP!=='127.0.0.1'))throw Error('QA port is not loopback-only');
 console.log('QA published ports bound to 127.0.0.1; original stopped containers retained.');
}
if(process.argv[1]?.endsWith('docker-loopback.mjs'))await bindLoopback();

import cp from 'node:child_process';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

// Binary-only companion to the actual isolated Supabase fixture. All commands
// use its labelled, disposable container, loopback and stdin-only credentials.
export function createIsolatedTaxStorageBytes(f){
 const docker=process.env.TEST_DOCKER_PATH||(process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker');
 const context=process.env.TEST_DOCKER_CONTEXT||(process.platform==='win32'?'desktop-linux':'default');
 const db=f.evidence.containers.db;
 assert.match(db,/^tax-recipient-storage-[a-z0-9]+-db$/);
 const command=(args,input)=>{
  const result=cp.spawnSync(docker,['--context',context,...args],{input,windowsHide:true,timeout:35000,maxBuffer:4*1024*1024});
  if(result.status!==0)throw Error(f.redact(result.stderr?.toString()||result.error?.message||'Isolated Storage transport failed').slice(0,1000));
  return result.stdout;
 };
 const metadata=JSON.parse(command(['inspect',db,'--format','{"label":{{json (index .Config.Labels "com.codex.task")}},"network":{{json .HostConfig.NetworkMode}},"ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}}}']).toString());
 assert.equal(metadata.label,f.evidence.label);assert.equal(metadata.network,'none');
 assert.equal(Object.keys(metadata.ports||{}).length,0);assert.ok(metadata.mounts.every(m=>m.Type==='tmpfs'));
 const exec=(args,input)=>command(['exec','-i',db,...args],input);
 const objectPath=(bucket,path)=>{
  assert.match(bucket,/^[a-z][a-z0-9-]{0,100}$/);assert.equal(typeof path,'string');
  assert.ok(path.length>0&&path.length<=2048&&!/[\\\u0000-\u001f\u007f]/.test(path));
  assert.ok(path.split('/').every(part=>part&&part!=='.'&&part!=='..'));
  return bucket+'/'+path.split('/').map(encodeURIComponent).join('/');
 };
 function request(path,{method='GET',token,file,mime,upsert}={}){
  assert.ok(path.startsWith('/object/')&&!/[\r\n]/.test(path));
  if(token!==undefined)assert.ok(typeof token==='string'&&!/[\r\n]/.test(token));
  const config=['url = '+JSON.stringify('http://127.0.0.1:5000'+path),'request = '+JSON.stringify(method),
   'silent','show-error','include','max-time = 25',token?'header = '+JSON.stringify('Authorization: Bearer '+token):'',
   mime?'header = '+JSON.stringify('Content-Type: '+mime):'',file?'header = "Expect:"':'',
   upsert!==undefined?'header = '+JSON.stringify('x-upsert: '+String(upsert)):'',file?'data-binary = '+JSON.stringify('@'+file):''].filter(Boolean).join('\n');
  const raw=exec(['curl','--config','-'],config);
  let at=raw.indexOf(Buffer.from('\r\n\r\n')),width=4;
  if(at<0){at=raw.indexOf(Buffer.from('\n\n'));width=2;}
  assert.ok(at>=0,'Storage response lacks HTTP headers');
  const header=raw.subarray(0,at).toString(),bytes=raw.subarray(at+width),status=Number(header.match(/^HTTP\/\S+ (\d+)/)?.[1]);
  assert.ok(Number.isInteger(status));
  return{status,bytes,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 }
 function writeObject(bucket,path,bytes,token,{mime='application/pdf',upsert=false,method='POST'}={}){
  assert.ok(method==='POST'||method==='PUT');
  assert.ok(['application/pdf','application/json'].includes(mime));
  const body=Buffer.from(bytes);assert.ok(body.length>0&&body.length<=65536);
  const temporary='/tmp/tax-storage-'+crypto.randomUUID();assert.match(temporary,/^\/tmp\/tax-storage-[a-f0-9-]{36}$/);
  exec(['sh','-c','umask 077; cat > "$1"','tax-storage',temporary],body);
  try{return request('/object/'+objectPath(bucket,path),{method,token,file:temporary,mime,upsert});}
  finally{exec(['rm','--',temporary]);}
 }
 return{
  upload:writeObject,
  update:(bucket,path,bytes,token,options={})=>writeObject(bucket,path,bytes,token,{...options,method:'PUT'}),
  get:(bucket,path,token,{public:publicRead=false}={})=>request('/object/'+(publicRead?'public/':'authenticated/')+objectPath(bucket,path),{token}),
  remove:(bucket,path,token)=>f.http(5000,'/object/'+bucket,'DELETE',{prefixes:[path]},token),
 };
}

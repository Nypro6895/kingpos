import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const runtime=path.join(root,'qa/runtime');
export const project='reylumi-qa-20261111';
export const origin='http://localhost:3117';
export function status(){
 if(fs.existsSync(path.join(runtime,'supabase/.temp/project-ref')))throw Error('Linked backend forbidden in QA runtime');
 const raw=execFileSync('supabase',['status','--workdir',runtime,'--output','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const result=JSON.parse(raw);
 if(result.API_URL!=='http://127.0.0.1:55421'||!result.DB_URL?.includes('@127.0.0.1:55422/'))throw Error('Expected isolated local backend');
 return result;
}
export function sql(text){
 const name='supabase_db_'+project;
 const label=execFileSync('docker',['inspect',name,'--format','{{index .Config.Labels "com.supabase.cli.project"}}'],{encoding:'utf8'}).trim();
 if(label!==project)throw Error('Wrong database container');
 return execFileSync('docker',['exec','-i',name,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-At'],{input:text,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
}
export function assertMarker(){
 status();
 if(sql("select id from qa_private.environment where id='reylumi-local-qa-v1'")!=='reylumi-local-qa-v1')throw Error('QA database marker missing');
}
export const writeJson=(name,data)=>fs.writeFileSync(path.join(runtime,name),JSON.stringify(data,null,2)+'\n');

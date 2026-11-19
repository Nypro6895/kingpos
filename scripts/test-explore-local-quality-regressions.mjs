// Local isolated/mocked regression gate. Do not run during native latency samples.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const options=Object.fromEntries(process.argv.slice(2).map(value=>{const [key,...rest]=value.replace(/^--/,'').split('=');return [key,rest.join('=')];}));
const manifestPath='tests/fixtures/explore-local-quality-regression-manifest.json';
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const expected=options['expected-sql-sha'];
if(!/^[a-f0-9]{64}$/.test(expected??'')) throw new Error('Provide the exact final --expected-sql-sha=<SHA256>.');
const expectedPreparation=options['expected-preparation-sha'];
if(!/^[a-f0-9]{64}$/.test(expectedPreparation??'')) throw new Error('Provide the exact final --expected-preparation-sha=<SHA256>.');
const hash=()=>Object.fromEntries(manifest.hashInputs.map(file=>{if(!existsSync(file))throw new Error('Missing regression source: '+file);return [file,createHash('sha256').update(readFileSync(file)).digest('hex')];}));
const before=hash(),migration=manifest.productMigration;
if(before[migration]!==expected)throw new Error('Migration differs from the expected frozen source.');
if(before[manifest.preparationMigration]!==expectedPreparation)throw new Error('Preparation migration differs from the expected frozen source.');
if(process.env.RUN_ISOLATED_SUPABASE==='1')throw new Error('This local gate leaves the optional container integration test skipped. Run it separately with explicit fixture preparation.');
const startedAt=new Date().toISOString();
const args=['--test','--test-concurrency=2','--test-reporter=tap',...manifest.tests];
const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,windowsHide:true});
const after=hash(),output=options.output??'artifacts/local-search-quality-20261118/coherent-regressions-final';
mkdirSync(output.slice(0,output.lastIndexOf('/')),{recursive:true});
writeFileSync(output+'.tap',(result.stdout??'')+(result.stderr?'\n'+result.stderr:''));
const count=name=>Number([...(result.stdout??'').matchAll(new RegExp('^# '+name+' (\\d+)$','gm'))].at(-1)?.[1]??0);
const summary={startedAt,completedAt:new Date().toISOString(),command:['node',...args],manifest:manifestPath,sourceHashesBefore:before,sourceHashesAfter:after,
 unchangedSources:JSON.stringify(before)===JSON.stringify(after),exitCode:result.status,error:result.error?.message??null,
 tests:count('tests'),passed:count('pass'),failed:count('fail'),cancelled:count('cancelled'),skipped:count('skipped'),tap:output+'.tap',
 limitations:manifest.limitations};
writeFileSync(output+'.json',JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({tests:summary.tests,passed:summary.passed,failed:summary.failed,skipped:summary.skipped,unchangedSources:summary.unchangedSources,exitCode:summary.exitCode,tap:summary.tap}));
if(result.status!==0||!summary.unchangedSources)process.exitCode=1;

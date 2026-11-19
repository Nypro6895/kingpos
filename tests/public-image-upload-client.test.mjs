import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle = await build({entryPoints:['lib/public-image-upload-client.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {runPublicImageUploadBatch,PublicImageUploadCancelledError} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('bounds complete conversion/upload work to two and retains selection order',async()=>{
 const tasks=Array.from({length:4},deferred),started=[];let active=0,maximum=0;
 const work=runPublicImageUploadBatch({items:['a','b','c','d'],concurrency:99,
  upload:async(item,index)=>{started.push(item);maximum=Math.max(maximum,++active);try{return await tasks[index].promise;}finally{active--; }},cleanup:()=>assert.fail('successful batch must not delete its outputs')});
 assert.deepEqual(started,['a','b']);
 tasks[1].resolve('B');await turn();assert.deepEqual(started,['a','b','c']);
 tasks[0].resolve('A');await turn();assert.deepEqual(started,['a','b','c','d']);
 tasks[3].resolve('D');tasks[2].resolve('C');
 assert.deepEqual(await work,['A','B','C','D']);assert.equal(maximum,2);
});

test('a failed upload waits for late successes and cleans every completed output',async()=>{
 const tasks=Array.from({length:4},deferred),started=[],removed=[];
 const work=runPublicImageUploadBatch({items:[0,1,2,3],upload:async index=>{started.push(index);return tasks[index].promise;},cleanup:async(value,index)=>{removed.push([value,index]);if(index===0)throw Error('cleanup unavailable');}});
 const rejected=assert.rejects(work,/original upload failure/);
 tasks[0].resolve('first');await turn();assert.deepEqual(started,[0,1,2]);
 tasks[1].reject(Error('original upload failure'));await turn();assert.deepEqual(removed,[]);
 tasks[2].resolve('late');await rejected;
 assert.deepEqual(started,[0,1,2]);assert.deepEqual(removed.sort((a,b)=>a[1]-b[1]),[['first',0],['late',2]]);
});

test('scope withdrawal admits no new work and cleans late successes',async()=>{
 const tasks=Array.from({length:3},deferred),started=[],removed=[];let current=true;
 const work=runPublicImageUploadBatch({items:[0,1,2],isCurrent:()=>current,upload:async index=>{started.push(index);return tasks[index].promise;},cleanup:value=>{removed.push(value);}});
 const rejected=assert.rejects(work,PublicImageUploadCancelledError);
 current=false;tasks[0].resolve('a');tasks[1].resolve('b');await rejected;
 assert.deepEqual(started,[0,1]);assert.deepEqual(removed.sort(),['a','b']);
 await assert.rejects(runPublicImageUploadBatch({items:[0],isCurrent:()=>false,upload:()=>assert.fail('withdrawn scope'),cleanup:()=>{}}),PublicImageUploadCancelledError);
});

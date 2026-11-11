import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['lib/gift-display-appearance.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {getGiftDisplayAppearance}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
test('gift preview resolves saved design only through validated display token; no mutation or service-role access',async()=>{
 const calls=[],design={background:'#f3e5e7',color:'#362032',image:'',logo:'',elements:[{id:'title',kind:'text',text:'Owner original',x:50,y:50,size:28,font:'serif'}]};
 const db={async rpc(name,args){calls.push({name,args});return {error:null,data:name==='get_pos_live_draft_by_token'?[{salon_id:'paired-salon'}]:{installed:false,design,salonName:'Owner Salon'}};}};
 const reply=await getGiftDisplayAppearance(db,' paired-token ');assert.equal(reply.design.elements[0].text,'Owner original');assert.equal(reply.installed,false);assert.deepEqual(calls,[{name:'get_pos_live_draft_by_token',args:{p_token:'paired-token'}},{name:'gift_card_catalog',args:{p_salon:'paired-salon'}}]);
 await assert.rejects(getGiftDisplayAppearance(db,''),/Display unavailable/);assert.equal(calls.length,2);
 let reads=0;await assert.rejects(getGiftDisplayAppearance({async rpc(){reads++;return {data:[],error:null}}},'invalid-token'),/Display unavailable/);assert.equal(reads,1,'Invalid pairing never reads a salon catalog');
 await assert.rejects(getGiftDisplayAppearance({async rpc(){return {data:null,error:new Error('offline')}}},'token'),/Display unavailable/);
});

test('saved background-only design remains configured rather than replaced by default art',async()=>{const db={async rpc(name){return {error:null,data:name==='get_pos_live_draft_by_token'?[{salon_id:'paired'}]:{installed:true,design:{background:'#112233',color:'#ffffff',image:'',logo:'',elements:[]}}};}};const reply=await getGiftDisplayAppearance(db,'paired');assert.equal(reply.design.background,'#112233');assert.deepEqual(reply.design.elements,[]);});

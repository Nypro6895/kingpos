import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const compiled=await build({entryPoints:['lib/portable-workstation-customer-actions.ts'],bundle:true,write:false,format:'cjs',platform:'node',plugins:[{name:'extension-authority-boundary',setup(b){
 b.onResolve({filter:/^(?:server-only|@\/lib\/supabase\/server|@\/lib\/gift-display-appearance|@\/app\/service-relay\/actions)$/},({path})=>({path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='server-only'?'':path.endsWith('supabase/server')?'export function createSupabaseServerClient(){return globalThis.fixture.client}':path.endsWith('gift-display-appearance')?'export async function getGiftDisplayAppearance(client,token){return {salonName:"Sample Salon",token}}':'export async function issueServiceRelayPass(token,visitId){return {data:{token,visitId}}}'}));
}}]});
function fixture(){const state={calls:[],client:{async rpc(name,args){state.calls.push({name,args});return {data:{ok:true},error:null}}}},module={exports:{}};const context=vm.createContext({module,exports:module.exports,require,Request,URL,fixture:state});vm.runInContext(compiled.outputFiles[0].text,context);return {...module.exports,state};}

test('paired gift and reward requests retain only customer operations and the server-resolved display bearer',async()=>{
 const f=fixture();
 for(const [command,op,rpc]of [['gift','code','gift_card_display'],['gift','buy','gift_card_display'],['gift','amount','gift_card_display'],['rewards','request','reward_display'],['rewards','confirm','reward_display']]){
  const reply=await f.runPairedCustomerExtension(command,{op,args:{token:'gift-credential',scope:'owner'},token:'forged-display'},'server-display');assert.equal(reply.handled,true);
  assert.equal(f.state.calls.at(-1).name,rpc);assert.equal(f.state.calls.at(-1).args.p_token,'server-display');
 }
 const before=f.state.calls.length;
 for(const [command,op]of [['gift','submit'],['gift','collect'],['gift','wallet_request'],['rewards','quote'],['rewards','owner-submit']])await assert.rejects(f.runPairedCustomerExtension(command,{op},'server-display'),/not available/);
 assert.equal(f.state.calls.length,before,'no settlement or employee operation reaches the RPC boundary');
});
test('paired relay and extension origin checks cannot select another POS or Owner authority',async()=>{
 const f=fixture();
 await f.runPairedCustomerExtension('relay.entry',{},'server-display');assert.equal(f.state.calls.at(-1).name,'personal_checkin_entry');assert.equal(f.state.calls.at(-1).args.p_token,'server-display');
 await assert.rejects(f.runPairedCustomerExtension('gift',{op:'read'},'server-display',new Request('https://pos.invalid/api/pos/workstation',{headers:{Origin:'https://outside.invalid'}})),/origin/);
 const unknown=await f.runPairedCustomerExtension('owner.delete',{},'server-display');assert.equal(unknown.handled,false);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {build} from 'esbuild';
import vm from 'node:vm';
import {runtime,root,project,status,assertMarker,writeJson,sql} from './common.mjs';
assertMarker();const config=status();
const route=await build({entryPoints:[path.join(root,'app/api/qa/environment/route.ts')],bundle:true,platform:'node',format:'cjs',write:false});
for(const [environment,expected]of [[{NODE_ENV:'production',REYLUMI_QA_MODE:'local'},404],[{NODE_ENV:'development'},404],[{NODE_ENV:'development',REYLUMI_QA_MODE:'local',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_APP_URL:'http://localhost:3117'},200]]){
 const compiledModule={exports:{}};vm.runInNewContext(route.outputFiles[0].text,{module:compiledModule,exports:compiledModule.exports,process:{env:environment},Response});
 assert.equal(compiledModule.exports.GET().status,expected);
}
const containers=JSON.parse(execFileSync('docker',['inspect',...execFileSync('docker',['ps','--filter','label=com.supabase.cli.project='+project,'--format','{{.Names}}'],{encoding:'utf8'}).trim().split(/\r?\n/)],{encoding:'utf8'}));
for(const container of containers)for(const bindings of Object.values(container.HostConfig.PortBindings||{}))for(const binding of bindings)assert.equal(binding.HostIp,'127.0.0.1');
assert.equal((await fetch('http://127.0.0.1:3118/resend/emails',{method:'POST',body:'{}'})).status,403);
const code=`
 import assert from 'node:assert/strict';
 await assert.rejects(fetch('https://example.invalid/blocked'),/QA blocked outbound host/);
 await assert.rejects(fetch('https://api.stripe.com/v1/checkout/sessions',{headers:{Authorization:'Bearer wrong-key'}}),/QA blocked outbound host/);
 const captured=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer qa_local_capture_only','Content-Type':'application/json'},body:JSON.stringify({from:'QA <qa@example.invalid>',to:'customer@qa.reylumi.invalid',subject:'LOCAL QA capture test',text:'This message remains on this computer.'})});
 assert.equal(captured.status,200);assert.ok((await captured.json()).id);
 console.log('QA egress guard and local email capture passed');`;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/SUPABASE|STRIPE|TWILIO|RESEND|SMTP|OPENAI|VERCEL|AWS_|S3_|REYLUMI|KINGPOS|ADVERTISING|NEXT_PUBLIC|NODE_OPTIONS/i.test(key)));
Object.assign(env,{REYLUMI_QA_MODE:'local',NEXT_PUBLIC_SUPABASE_URL:config.API_URL,NEXT_PUBLIC_APP_URL:'http://localhost:3117'});
const check=execFileSync(process.execPath,['--import',pathToFileURL(path.join(root,'qa/local/guard.mjs')).href,'--input-type=module','-e',code],{env,encoding:'utf8'}).trim();
const access=JSON.parse(fs.readFileSync(path.join(runtime,'access.json')));
const admin=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const imagePath=access.salon+'/qa/test.png';
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=','base64');
const uploaded=await admin.storage.from('salon-profile-media').upload(imagePath,image,{contentType:'image/png',upsert:true});
if(uploaded.error)throw uploaded.error;
const business=JSON.parse(fs.readFileSync(path.join(runtime,'smoke-results.json')));
assert.ok(business.results.every(r=>r.passed),'Business smoke has unresolved failures');
for(const result of business.results){
 const evidence=result.evidence||{};
 for(const key of ['bookingId','postId','giftSaleId','ticketId','campaignId'])if(evidence[key]){
  const id=evidence[key];assert.match(id,/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i);
  const table={bookingId:'bookings',postId:'forum_topics',giftSaleId:'gift_card_counter_sales',ticketId:'pos_tickets',campaignId:'owner_campaigns'}[key];
  assert.equal(sql(`select count(*) from ${table} where id='${id}'`),'1','Persisted business evidence missing: '+key);
  if(key==='bookingId')assert.equal(sql(`select status from bookings where id='${id}'`),'cancelled');
  if(key==='ticketId')assert.equal(Number(sql(`select sum(amount) from pos_payments where ticket_id='${id}'`)),45);
  if(key==='campaignId'&&evidence.localViewAdmitted)assert.ok(Number(sql(`select views from owner_campaigns where id='${id}'`))>=1);
 }
}
assert.ok(Number(sql("select count(*) from gift_card_online_orders where status='paid' and card_id is not null"))>=1);
const report={at:new Date().toISOString(),project,localBackend:true,allPublishedPortsLoopback:true,markerVerified:true,productionQaRouteDisabled:true,realProviderKeysLoaded:false,providerControlRequiresToken:true,blockedOutboundFetch:true,emailCapturedLocally:true,storageUpload:true,persistedBusinessRecordsVerified:true,onlineGiftFulfilled:true,businessCases:business.results.map(({name,passed})=>({name,passed})),note:'Local simulation only; not external Stripe or native-device acceptance.'};
writeJson('verification.json',report);console.log(check);console.log('QA isolation, synthetic workflow receipts and local Storage upload verified.');

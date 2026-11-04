import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const root=process.env.MARKET_SYSTEM_SOURCE??'.';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const ids={admin:id(1),owner:id(2),other:id(3),operator:id(4),suspended:id(5),salon:id(10),otherSalon:id(11)};
const bootstrap=readFileSync('tests/market-bank-billing.integration.test.mjs','utf8').match(/const bootstrap=`([\s\S]*?)`;/)[1].replace(/\$\{(\w+)\}/g,(_,name)=>ids[name]);

test('automatic tax: verified invoices, actual credit notes, frozen quotes, restricted administration and complete reporting',{timeout:120000},async t=>{
 const db=new PGlite();
 const value=async(sql,args=[]) =>(await db.query(sql,args)).rows[0]?.value;
 const actor=async user=>db.query("select set_config('app.actor',$1,false)",[user??'']);
 const rpc=async(name,args=[])=>value(`select ${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) as value`,args.map(a=>a&&typeof a==='object'?JSON.stringify(a):a));
 const now=new Date(Date.now()-60000).toISOString(),refundTime=new Date(Date.now()-30000).toISOString();
 const provider={connected:true,account_id:'acct_demo',mode:'live',status:'active',head_office:{country:'US',state:'WI'},registrations:[],checked_at:now,error:null};
 let settings,flat,exclusive,inclusive,invoice;
 const record=changes=>rpc('market_tax_record_invoice',[{...invoice,...changes}]);
 const apply=async(purchase,{amount=purchase.amount_cents,refund=0,at='2030-01-01T00:00:00Z',invoiceId='in_auto',sub='sub_auto',until='2030-02-01T00:00:00Z'}={})=>db.query('select market_card_apply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[purchase.id,sub,'cus_demo','active',invoiceId,amount,refund,'pi_demo',until,at]);
 try{
  await db.exec(bootstrap);await db.exec('alter table users add column email text');
  for(const file of ['20261009160001_market_commerce_configuration.sql','20261009180001_market_bank_billing.sql','20261010210001_market_card_system.sql','20261011010001_market_automatic_tax.sql']) await db.exec(readFileSync(`${root}/supabase/migrations/${file}`,'utf8'));
  await db.exec(`insert into platform_payment_settings(id,encrypted_config,public_config) values(true,'test','{"enabled":true,"mode":"live","accountId":"acct_demo"}')`);
  await actor(ids.admin);
  await t.test('starts disabled with no invented registration or product classification',async()=>{
   const state=await rpc('market_tax_admin_state');settings=state.settings;
   assert.equal(settings.enabled,false);assert.equal(settings.default_tax_code,null);assert.equal(settings.version,1);
   assert.deepEqual(state.product_codes,[]);assert.equal(state.readiness_local,false);
   assert.equal(state.provider.connected,false);assert.deepEqual(state.provider.registrations,[]);
   assert.equal(state.row_count,0);assert.equal(state.truncated,false);assert.equal(state.summary.net_tax_cents,0);
  });
  await t.test('admin rights are restricted to active platform owners with team permission',async()=>{
   for(const user of [ids.owner,ids.other,ids.operator,ids.suspended,null]){
    await actor(user);await assert.rejects(rpc('market_tax_admin_state'),/permission denied|platform owner access/);
    await assert.rejects(rpc('market_tax_save_settings',[1,{enabled:false}]),/permission denied|platform owner access/);
    await assert.rejects(rpc('market_tax_export_ledger'),/permission denied|platform owner access/);
   }await actor(ids.admin);
  });
  await t.test('settings and classifications use version checks and require product readiness',async()=>{
   await assert.rejects(rpc('market_tax_save_settings',[1,{enabled:true}]),/tax code/);
   await assert.rejects(rpc('market_tax_save_settings',[1,{default_tax_code:'invented'}]),/valid Stripe/);
   const code=await rpc('market_tax_save_product',['booking-policy','txcd_10000000',null]);assert.equal(code.version,1);
   await assert.rejects(rpc('market_tax_save_product',['booking-policy',null,null]),/changed/);
   const cleared=await rpc('market_tax_save_product',['booking-policy',null,1]);assert.equal(cleared.version,2);assert.equal(cleared.tax_code,null);
   await assert.rejects(rpc('market_tax_save_product',['booking-policy','txcd_10000000',1]),/changed/);
   settings=await rpc('market_tax_save_settings',[1,{default_tax_code:'txcd_10000000'}]);
   await assert.rejects(rpc('market_tax_save_settings',[1,{enabled:true}]),/changed/);
   await assert.rejects(rpc('market_tax_save_settings',[settings.version,{enabled:true}]),/live tax provider/);
  });
  await t.test('processor state is service-only, fresh, account-specific and does not create registrations',async()=>{
   await db.exec('set role authenticated');
   await assert.rejects(rpc('market_tax_sync_provider',[provider]),/permission denied/);
   await db.exec('reset role');
   const sanitized=await rpc('market_tax_sync_provider',[{...provider,secretKey:'must not cache'}]);assert.ok(!('secretKey' in sanitized));
   assert.deepEqual(sanitized.registrations,[]);
   const stale=await rpc('market_tax_sync_provider',[{...provider,status:'pending',checked_at:new Date(Date.now()-120000).toISOString()}]);assert.equal(stale.status,'active');
   await db.exec(`update platform_market_tax_provider set state=jsonb_set(state,'{account_id}','"acct_wrong"')`);
   await assert.rejects(rpc('market_tax_save_settings',[settings.version,{enabled:true}]),/live tax provider/);
   await db.exec(`update platform_market_tax_provider set state=jsonb_set(state,'{account_id}','"acct_demo"')`);
   await db.exec(`update platform_market_tax_provider set state=jsonb_set(state,'{checked_at}','"2000-01-01T00:00:00Z"')`);
   await assert.rejects(rpc('market_tax_save_settings',[settings.version,{enabled:true}]),/live tax provider/);
   await rpc('market_tax_sync_provider',[provider]);
   await assert.rejects(rpc('market_tax_save_settings',[settings.version,{enabled:true}]),/required active registrations/);
   await assert.rejects(rpc('market_tax_sync_provider',[{...provider,checked_at:new Date(Date.now()-40000).toISOString(),registrations:[{id:'taxreg_demo',country:'US',state:'WI',status:'active',active_from:0,expires_at:null}]}]),/effective date/);
   await rpc('market_tax_sync_provider',[{...provider,checked_at:new Date(Date.now()-30000).toISOString(),registrations:[{id:'taxreg_demo',country:'US',state:'WI',status:'active',active_from:Math.floor(Date.now()/1000)-3600,expires_at:null}]}]);
  });
  await t.test('disabled automatic tax preserves existing flat-tax card quotes',async()=>{
   await db.exec("update market_billing_settings set tax_bps=1000,fee_bps=1000,fixed_fee_cents=10 where id;update market_billing_catalog set price_cents=1000");
   await actor(ids.owner);flat=await rpc('market_card_reserve',[ids.salon,'booking-policy']);assert.equal(flat.amount_cents,1220);assert.equal(flat.snapshot.tax_bps,1000);assert.equal(flat.snapshot.automatic_tax.enabled,false);
   await actor(ids.admin);settings=await rpc('market_tax_save_settings',[settings.version,{enabled:true}]);
  });
  await t.test('new automatic-tax quotes exclude flat tax and compute fees on the base price',async()=>{
   await actor(ids.owner);exclusive=await rpc('market_card_reserve',[ids.salon,'booking-deposit']);
   assert.equal(exclusive.amount_cents,1110);assert.equal(exclusive.snapshot.tax_bps,0);assert.equal(exclusive.snapshot.automatic_tax.enabled,true);assert.equal(exclusive.snapshot.automatic_tax.price_behavior,'exclusive');
   await actor(ids.admin);await rpc('market_tax_save_product',['booking-deposit','txcd_10103001',null]);
   settings=await rpc('market_tax_save_settings',[settings.version,{price_behavior:'inclusive',default_tax_code:'txcd_10103001'}]);
   await actor(ids.owner);const repeated=await rpc('market_card_reserve',[ids.salon,'booking-deposit']);assert.equal(repeated.id,exclusive.id);assert.equal(repeated.snapshot.automatic_tax.tax_code,'txcd_10000000');
   inclusive=await rpc('market_card_reserve',[ids.salon,'checkin-receipt']);assert.equal(inclusive.amount_cents,1110);assert.equal(inclusive.snapshot.automatic_tax.price_behavior,'inclusive');
   assert.equal((await rpc('market_card_reserve',[ids.salon,'booking-policy'])).id,flat.id);
  });
  invoice={invoice_id:'in_auto',purchase_id:exclusive.id,account_id:'acct_demo',amount_cents:1221,subtotal_cents:1110,tax_cents:111,refunded_cents:0,currency:'usd',automatic_tax:true,country:'US',state:'WI',occurred_at:now,tax_breakdown:[
   {tax_rate_id:'txr_state',jurisdiction:'Wisconsin',country:'US',state:'WI',tax_cents:100,tax_type:'sales_tax',rate_bps:900},
   {tax_rate_id:'txr_county',jurisdiction:'County',country:'US',state:'WI',tax_cents:11,tax_type:'sales_tax',rate_bps:100}
  ]};
  await t.test('activation cannot trust a changed gross amount without a matching verified tax invoice',async()=>{
   await assert.rejects(apply(exclusive,{amount:1221}),/verified automatic tax invoice/);
   await assert.rejects(record({account_id:'acct_wrong'}),/frozen automatic tax purchase/);
   await assert.rejects(record({automatic_tax:false}),/Invalid verified/);
   await assert.rejects(record({currency:'eur'}),/Invalid verified/);
   await assert.rejects(record({subtotal_cents:1111,tax_cents:110}),/subtotal/);
   await assert.rejects(record({tax_cents:112}),/amounts or location/);
   await assert.rejects(record({amount_cents:1221.5}),/whole cents/);
   await assert.rejects(record({tax_breakdown:[{jurisdiction:'Wisconsin',tax_cents:111}]}),/tax rate ID/);
   await assert.rejects(record({tax_breakdown:invoice.tax_breakdown.map(x=>({...x,tax_cents:1}))}),/do not equal/);
   assert.equal(await value('select count(*)::int as value from market_tax_invoices'),0);
  });
  await t.test('verified invoice amounts and tax jurisdictions are immutable and replay-safe',async()=>{
   const recorded=await record();assert.equal(recorded.tax_cents,111);assert.equal(recorded.reconciliation_required,false);
   await record({tax_breakdown:[...invoice.tax_breakdown].reverse()});assert.equal(await value('select count(*)::int as value from market_tax_ledger'),2);
   await assert.rejects(record({country:'CA'}),/cannot be changed/);
   await assert.rejects(record({occurred_at:new Date(Date.now()-90000).toISOString()}),/cannot be changed/);
   await apply(exclusive,{amount:1221});assert.ok(await value('select paid_until as value from booking_deposit_subscriptions where salon_id=$1',[ids.salon]));
   await assert.rejects(apply(exclusive,{amount:1222,at:'2030-01-02T00:00:00Z'}),/amount mismatch/);
  });
  await t.test('gross card refunds without credit notes preserve tax and require reconciliation',async()=>{
   const row=await record({refunded_cents:600});assert.equal(row.refunded_tax_cents,0);assert.equal(row.reconciliation_required,true);
   assert.equal(await value("select coalesce(sum(tax_cents),0)::int as value from market_tax_ledger"),111);
   await actor(ids.admin);assert.equal((await rpc('market_tax_admin_state')).summary.reconciliation_required_count,1);
  });
  await t.test('only actual jurisdiction credit-note deltas reverse tax and duplicate delivery adds nothing',async()=>{
   const changes={refunded_cents:600,refunds_reconciled_cents:600,refund_occurred_at:refundTime,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:40},{tax_rate_id:'txr_county',tax_cents:3}]};
   const row=await record(changes);assert.equal(row.refunded_tax_cents,43);assert.equal(row.refunds_reconciled_cents,600);assert.equal(row.reconciliation_required,false);
   await record(changes);assert.equal(await value('select count(*)::int as value from market_tax_ledger'),4);
   assert.equal(await value("select coalesce(sum(tax_cents),0)::int as value from market_tax_ledger"),68);
   const older=await record({refunded_cents:100,refunds_reconciled_cents:100,refund_occurred_at:refundTime,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:1}]});assert.equal(older.refunded_tax_cents,43);assert.equal(older.refunded_cents,600);
   assert.equal(await value("select metadata->>'allocation_method' as value from market_tax_ledger where kind='refund' limit 1"),'processor_credit_note');
   const unmatched=await record({...changes,refunded_cents:800,refunds_reconciled_cents:600});assert.equal(unmatched.reconciliation_required,true);assert.equal(unmatched.refunds_reconciled_cents,600);
  });
  await t.test('invalid credit-note allocations fail atomically without invented tax refunds',async()=>{
   const count=await value('select count(*)::int as value from market_tax_ledger');
   await assert.rejects(record({refunded_cents:600,refund_occurred_at:refundTime,refund_tax_breakdown:[{tax_rate_id:'txr_other',tax_cents:1}]}),/match the original/);
   await assert.rejects(record({refunded_cents:600,refund_occurred_at:refundTime,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:101}]}),/exceed the original/);
   await assert.rejects(record({refunded_cents:600,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:50}]}),/timestamp/);
   await assert.rejects(record({refunded_cents:600,refund_occurred_at:refundTime,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:50},{tax_rate_id:'txr_state',tax_cents:50}]}),/must be unique/);
   assert.equal(await value('select count(*)::int as value from market_tax_ledger'),count);
  });
  await t.test('full gross refunds wait for full actual tax credits and do not restore refunded access',async()=>{
   assert.equal((await record({refunded_cents:1221})).reconciliation_required,true);
   await apply(exclusive,{amount:1221,refund:0,at:'2030-01-03T00:00:00Z'});assert.equal(await value('select paid_until as value from booking_deposit_subscriptions where salon_id=$1',[ids.salon]),null);
   const row=await record({refunded_cents:1221,refunds_reconciled_cents:1221,refund_occurred_at:refundTime,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:100},{tax_rate_id:'txr_county',tax_cents:11}]});
   assert.equal(row.refunded_tax_cents,111);assert.equal(row.reconciliation_required,false);assert.equal(await value('select sum(tax_cents)::int as value from market_tax_ledger'),0);
   await apply(exclusive,{amount:1221,at:'2030-01-04T00:00:00Z'});assert.equal(await value('select paid_until as value from booking_deposit_subscriptions where salon_id=$1',[ids.salon]),null);
   assert.equal(await value('select refunded_cents as value from market_card_invoices where id=$1',['in_auto']),1221);
  });
  await t.test('inclusive pricing guards the total while exclusive pricing guards the pretax subtotal',async()=>{
   const inc={...invoice,invoice_id:'in_inclusive',purchase_id:inclusive.id,amount_cents:1110,subtotal_cents:1010,tax_cents:100,tax_breakdown:[{tax_rate_id:'txr_state',jurisdiction:'Wisconsin',tax_cents:100}]};
   await rpc('market_tax_record_invoice',[inc]);await apply(inclusive,{amount:1110,invoiceId:'in_inclusive',sub:'sub_inclusive'});
   await assert.rejects(rpc('market_tax_record_invoice',[{...inc,invoice_id:'in_wrong',amount_cents:1120,subtotal_cents:1020}]),/inclusive invoice total/);
   await assert.rejects(rpc('market_tax_record_invoice',[{...inc,invoice_id:'in_excess_credit',refunded_cents:1,refund_occurred_at:refundTime,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:2}]}]),/confirmed gross refund/);
   assert.equal(await value("select count(*)::int as value from market_tax_invoices where invoice_id='in_excess_credit'"),0);
  });
  await t.test('legacy flat-tax purchases still activate at the original frozen amount',async()=>{
   await apply(flat,{amount:1220,invoiceId:'in_legacy',sub:'sub_legacy'});assert.ok(await value('select paid_until as value from booking_policy_subscriptions where salon_id=$1',[ids.salon]));
   assert.equal(await value("select count(*)::int as value from market_tax_invoices where invoice_id='in_legacy'"),0);
  });
  await t.test('valid zero-tax invoices require no invented jurisdiction or tax reversal',async()=>{
   const zero={...invoice,invoice_id:'in_zero',purchase_id:inclusive.id,amount_cents:1110,subtotal_cents:1110,tax_cents:0,tax_breakdown:[],refunded_cents:1110};
   const row=await rpc('market_tax_record_invoice',[zero]);assert.equal(row.tax_cents,0);assert.equal(row.refunded_tax_cents,0);assert.equal(row.reconciliation_required,false);
   assert.equal(await value("select count(*)::int as value from market_tax_ledger where invoice_id='in_zero'"),0);
  });
  await t.test('private invoices, provider cache and tax ledger are invisible to customers and anonymous users',async()=>{
   for(const role of ['authenticated','anon']){
    await db.exec('set role '+role);
    for(const table of ['market_tax_invoices','market_tax_ledger','market_tax_credit_notes','platform_market_tax_provider','platform_market_tax_settings','platform_market_tax_products']) await assert.rejects(db.query('select * from '+table),/permission denied/);
    await assert.rejects(record(),/permission denied/);await assert.rejects(rpc('market_tax_sync_provider',[provider]),/permission denied/);
    await db.exec('reset role');
   }
   await db.exec('set role service_role');assert.equal(await value('select count(*)::int as value from market_tax_invoices'),3);await db.exec('reset role');
   await assert.rejects(db.exec('update market_tax_ledger set tax_cents=0'),/append-only/);await assert.rejects(db.exec('delete from market_tax_ledger'),/append-only/);
  });
  await t.test('date reporting is end-exclusive, complete CSV export never silently truncates',async()=>{
   await actor(ids.admin);const state=await rpc('market_tax_admin_state',[new Date(Date.now()-120000).toISOString(),refundTime]);
   assert.equal(state.summary.sale_tax_cents,211);assert.equal(state.summary.refunded_tax_cents,0);assert.equal(state.summary.invoice_count,3);assert.equal(state.row_count,3);
   const exported=await rpc('market_tax_export_ledger');assert.equal(exported.row_count,7);assert.equal(exported.ledger.length,7);
   await assert.rejects(rpc('market_tax_admin_state',[refundTime,now]),/end date/);
   await db.exec(`insert into market_tax_ledger(invoice_id,purchase_id,entry_key,kind,country,state,jurisdiction,tax_cents,occurred_at) select 'in_auto','${exclusive.id}','fixture:'||n,'sale','US','WI','Test',0,now() from generate_series(1,201) n`);
   const bounded=await rpc('market_tax_admin_state');assert.equal(bounded.ledger.length,200);assert.equal(bounded.row_count,208);assert.equal(bounded.truncated,true);
   await db.exec(`insert into market_tax_ledger(invoice_id,purchase_id,entry_key,kind,country,state,jurisdiction,tax_cents,occurred_at) select 'in_auto','${exclusive.id}','large:'||n,'sale','US','WI','Test',0,now() from generate_series(1,25000) n`);
   await assert.rejects(rpc('market_tax_export_ledger'),/narrower date range/);assert.equal((await rpc('market_tax_export_ledger',[null,refundTime])).ledger.length,3);
  });
  await t.test('delayed reconciliation preserves each credit-note month and duplicate deliveries never add tax credits',async()=>{
   const dated={...invoice,invoice_id:'in_notes',purchase_id:inclusive.id,amount_cents:1110,subtotal_cents:1010,tax_cents:100,tax_breakdown:[{tax_rate_id:'txr_state',jurisdiction:'Wisconsin',tax_cents:100}],occurred_at:'2024-01-15T00:00:00Z',refunded_cents:0,refunds_reconciled_cents:0,credit_notes:[]};
   await rpc('market_tax_record_invoice',[dated]);
   const march={id:'cn_march',occurred_at:'2024-03-01T00:00:00Z',amount_cents:400,tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:40}]};
   const april={id:'cn_april',occurred_at:'2024-04-01T00:00:00Z',amount_cents:400,tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:30}]};
   const credited={...dated,refunded_cents:800,refunds_reconciled_cents:800,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:70}],credit_notes:[april,march]};
   const row=await rpc('market_tax_record_invoice',[credited]);assert.equal(row.refunded_tax_cents,70);assert.equal(row.reconciliation_required,false);
   await rpc('market_tax_record_invoice',[{...credited,credit_notes:[march,april]}]);
   assert.equal(await value("select count(*)::int as value from market_tax_credit_notes where invoice_id='in_notes'"),2);
   assert.equal(await value("select count(*)::int as value from market_tax_ledger where invoice_id='in_notes' and kind='refund'"),2);
   assert.equal(await value("select tax_cents as value from market_tax_ledger where entry_key='credit:cn_march:txr_state'"),-40);
   assert.equal((await rpc('market_tax_admin_state',['2024-03-01T00:00:00Z','2024-04-01T00:00:00Z'])).summary.refunded_tax_cents,40);
   assert.equal((await rpc('market_tax_admin_state',['2024-04-01T00:00:00Z','2024-05-01T00:00:00Z'])).summary.refunded_tax_cents,30);
   const older=await rpc('market_tax_record_invoice',[{...credited,refunded_cents:400,refunds_reconciled_cents:400,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:40}],credit_notes:[march]}]);assert.equal(older.refunded_tax_cents,70);assert.equal(older.refunded_cents,800);
   await assert.rejects(rpc('market_tax_record_invoice',[{...credited,credit_notes:[march,march]}]),/IDs must be unique/);
   await assert.rejects(rpc('market_tax_record_invoice',[{...credited,credit_notes:[{...march,occurred_at:'2024-03-02T00:00:00Z'},april]}]),/Original credit-note facts/);
   await assert.rejects(rpc('market_tax_record_invoice',[{...credited,refunded_cents:801,refunds_reconciled_cents:801,credit_notes:[{...march,amount_cents:401},april]}]),/Original credit-note facts/);
   await assert.rejects(rpc('market_tax_record_invoice',[{...credited,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:71}]}]),/do not equal the cumulative/);
   await assert.rejects(rpc('market_tax_record_invoice',[{...credited,refunds_reconciled_cents:799}]),/covered gross refunds/);
   await assert.rejects(rpc('market_tax_record_invoice',[{...credited,refunded_cents:900,refunds_reconciled_cents:900,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:120}],credit_notes:[march,april,{id:'cn_excess',occurred_at:'2024-05-01T00:00:00Z',amount_cents:100,tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:50}]}]}]),/exceed the original/);
   await assert.rejects(rpc('market_tax_record_invoice',[{...credited,invoice_id:'in_wrong_proof'}]),/Original credit-note facts/);
   assert.equal(await value("select count(*)::int as value from market_tax_credit_notes where invoice_id='in_notes'"),2);
   await assert.rejects(db.exec("update market_tax_credit_notes set amount_cents=1 where id='cn_march'"),/append-only/);
   await assert.rejects(db.exec("delete from market_tax_credit_notes where id='cn_march'"),/append-only/);
   await assert.rejects(rpc('market_tax_record_invoice',[{...dated,refunded_cents:900,refunds_reconciled_cents:900,credit_notes:undefined,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:80}],refund_occurred_at:refundTime}]),/Provide the original credit notes/);
  });
  await t.test('verified backdated note effective dates remain exact and legacy cumulative credits cannot be duplicated as notes',async()=>{
   const backdated={...invoice,invoice_id:'in_backdated',purchase_id:inclusive.id,amount_cents:1110,subtotal_cents:1010,tax_cents:100,tax_breakdown:[{tax_rate_id:'txr_state',jurisdiction:'Wisconsin',tax_cents:100}],occurred_at:'2024-02-01T00:00:00Z',refunded_cents:100,refunds_reconciled_cents:100,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:10}],credit_notes:[{id:'cn_backdated',occurred_at:'2024-01-31T00:00:00Z',amount_cents:100,tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:10}]}]};
   await rpc('market_tax_record_invoice',[backdated]);
   assert.equal(new Date(await value("select occurred_at as value from market_tax_ledger where entry_key='credit:cn_backdated:txr_state'")).toISOString(),'2024-01-31T00:00:00.000Z');
   await assert.rejects(record({refunded_cents:1221,refunds_reconciled_cents:1221,refund_tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:100},{tax_rate_id:'txr_county',tax_cents:11}],credit_notes:[{id:'cn_legacy',occurred_at:refundTime,amount_cents:1221,tax_breakdown:[{tax_rate_id:'txr_state',tax_cents:100},{tax_rate_id:'txr_county',tax_cents:11}]}]}),/Legacy cumulative tax credits/);
  });
 }finally{await db.close();}
});

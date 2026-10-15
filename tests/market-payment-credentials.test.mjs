import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({
  entryPoints: ['app/(app)/admin/market/system-actions.ts'], bundle: true, write: false, format: 'esm', platform: 'node', alias: { '@': process.cwd() },
  plugins: [{ name: 'payment-credential-fixtures', setup(builder) {
    builder.onResolve({ filter: /^(server-only|next\/navigation|next\/cache|@\/lib\/platform-admin\/auth|@\/lib\/market-payments|@\/lib\/platform-payment|@\/lib\/market-card)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents:
      args.path === 'server-only' ? '' :
      args.path === 'next/navigation' ? `export function notFound(){throw Error('Not found')}` :
      args.path === 'next/cache' ? `export function revalidatePath(path){globalThis.paymentTest.revalidated.push(path)}` :
      args.path.includes('/auth') ? `export async function requirePlatformAdmin(permission){globalThis.paymentTest.permission=permission;return{roleSlug:globalThis.paymentTest.role,userId:'fixture-owner'}}` :
      args.path.endsWith('/market-card') ? `export async function processCardEvent(){}export async function syncCardSubscription(){}export async function syncCardInvoice(){}` :
      args.path.endsWith('/platform-payment') ? `export const PAYMENT_WEBHOOK='https://reylumi.com/api/payments/webhook';export async function paymentConfig(){return{...globalThis.paymentTest.old}}export function encryptPayment(config){globalThis.paymentTest.encrypted={...config};return'encrypted-fixture'}export function publicPayment(config){const{secretKey,webhookSecret,...rest}=config;return{...rest,keyConfigured:!!secretKey,webhookConfigured:!!webhookSecret}}export async function paymentStripe(path,form,key,config){const s=globalThis.paymentTest;s.calls.push({path,values:form?Object.fromEntries(form):null,key,config:{...config}});if(s.providerError&&(!s.providerErrorPath||s.providerErrorPath===path))throw Error(s.providerError);if(path==='account')return s.account;if(path==='webhook_endpoints')return{id:'we_fixture',secret:'whsec_fixture_only'};if(path.startsWith('webhook_endpoints/'))return{status:'enabled',url:PAYMENT_WEBHOOK,enabled_events:['*']};if(path==='billing_portal/configurations')return{id:'bpc_fixture'};throw Error('Unexpected fixture API call')}` :
      `export function marketServiceClient(){return{from(table){return{select(columns,options){if(table==='market_card_purchases')return Promise.resolve({count:globalThis.paymentTest.purchases,error:null});return this},insert(payload){globalThis.paymentTest.writes.push({table,operation:'insert',payload});return this},update(payload){globalThis.paymentTest.writes.push({table,operation:'update',payload});return this},eq(){return this},single(){return Promise.resolve({data:{version:1},error:null})},then(resolve){return Promise.resolve({data:null,error:null}).then(resolve)}}}}}`,
    }));
  } }],
});
const { savePaymentConnection } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const suffix = 'FixtureValue1234567890';
function reset(overrides = {}) {
  globalThis.paymentTest = {
    role: 'platform_owner', purchases: 0, account: {id:'acct_fixture',charges_enabled:true}, calls: [], writes: [], revalidated: [],
    old: {secretKey:'',publishableKey:'',webhookSecret:'',webhookId:'',accountId:'',portalConfigurationId:'',enabled:false,mode:'test',version:0}, ...overrides,
  };
  return globalThis.paymentTest;
}
function form(apiKey = `rk_live_${suffix}`, publishableKey = `pk_live_${suffix}`, extra = {}) {
  const input = new FormData();
  for (const [key,value] of Object.entries({secret_key:apiKey,publishable_key:publishableKey,version:'0',intent:'test',...extra})) input.set(key,String(value));
  return input;
}

test('standard and restricted keys each derive their validated test/live mode', async () => {
  for (const prefix of ['sk','rk']) for (const mode of ['test','live']) {
    const state = reset();
    const outcome = await savePaymentConnection(form(`${prefix}_${mode}_${suffix}`, `pk_${mode}_${suffix}`));
    assert.equal(outcome.ok,true); assert.equal(state.calls[0].config.mode,mode);
    assert.match(outcome.message,new RegExp(`^${mode==='live'?'Live':'Test'} account connection verified`));
    assert.equal(state.writes.length,0); assert.equal(state.calls.length,1);
  }
});

test('unsupported prefixes, modes, lengths and mismatched publishable keys never reach Stripe', async () => {
  for (const [apiKey,publishableKey] of [
    [`pk_live_${suffix}`,`pk_live_${suffix}`], [`rk_production_${suffix}`,`pk_live_${suffix}`],
    [`sk_org_${suffix}`,`pk_live_${suffix}`], ['rk_live_short',`pk_live_${suffix}`],
    [`rk_live_${suffix}!`,`pk_live_${suffix}`], [`rk_live_${suffix}`,`pk_test_${suffix}`],
    [`rk_test_${suffix}`,`pk_live_${suffix}`], [`sk_test_${suffix}`,`pk_live_${suffix}`],
    [`rk_live_${suffix}`,`sk_live_${suffix}`],
  ]) {
    const state = reset(); const outcome = await savePaymentConnection(form(apiKey,publishableKey));
    assert.equal(outcome.ok,false); assert.equal(state.calls.length,0); assert.equal(state.writes.length,0);
    assert.doesNotMatch(outcome.message,new RegExp(suffix));
  }
});

test('restricted test keys cannot enable live purchases and existing purchases cannot change account or mode', async () => {
  let state = reset();
  assert.equal((await savePaymentConnection(form(`rk_test_${suffix}`,`pk_test_${suffix}`,{enabled:'on'}))).ok,false);
  assert.equal(state.writes.length,0);
  for (const old of [
    {accountId:'acct_different',mode:'live',version:1},
    {accountId:'acct_fixture',mode:'test',version:1},
  ]) {
    state = reset({purchases:1}); state.old = {...state.old,...old};
    const outcome = await savePaymentConnection(form(undefined,undefined,{version:'1',intent:'save'}));
    assert.equal(outcome.ok,false); assert.match(outcome.message,/existing purchases belong/i);
    assert.equal(state.writes.length,0); assert.equal(state.calls.length,1);
  }
});

test('an existing restricted credential is preserved on blank input without duplicating webhook or portal', async () => {
  const state = reset(); state.old = {...state.old,secretKey:`rk_live_${suffix}`,publishableKey:`pk_live_${suffix}`,webhookSecret:'whsec_existing_fixture',webhookId:'we_existing_fixture',accountId:'acct_fixture',portalConfigurationId:'bpc_existing_fixture',mode:'live',version:4};
  const outcome = await savePaymentConnection(form('','',{version:'4',intent:'save',enabled:'on'}));
  assert.equal(outcome.ok,true); assert.equal(state.encrypted.secretKey,state.old.secretKey);
  assert.equal(state.encrypted.publishableKey,state.old.publishableKey); assert.equal(state.encrypted.webhookSecret,state.old.webhookSecret);
  assert.equal(state.encrypted.mode,'live'); assert.equal(state.encrypted.enabled,true);
  assert.deepEqual(state.calls.map(call=>call.path),['account','webhook_endpoints/we_existing_fixture']);
  const saved = state.writes.find(write=>write.table==='platform_payment_settings').payload;
  assert.equal(saved.version,5); assert.equal(saved.public_config.secretKey,undefined); assert.equal(saved.public_config.webhookSecret,undefined);
});

test('first restricted-key save configures webhook and portal through the existing workflow', async () => {
  const state = reset(); const outcome = await savePaymentConnection(form(undefined,undefined,{intent:'save',enabled:'on'}));
  assert.equal(outcome.ok,true); assert.deepEqual(state.calls.map(call=>call.path),['account','webhook_endpoints','billing_portal/configurations']);
  const webhook = state.calls[1].values; assert.equal(webhook.url,'https://reylumi.com/api/payments/webhook');
  assert.equal(webhook.api_version,'2024-06-20'); assert.equal(state.encrypted.mode,'live');
  assert.equal(state.writes.filter(write=>write.table==='platform_payment_settings').length,1);
});

test('owner and version protections still precede provider access', async () => {
  let state = reset({role:'platform_admin'});
  await assert.rejects(savePaymentConnection(form()),/Not found/);
  assert.equal(state.permission,'admin.team.manage'); assert.equal(state.calls.length,0);
  state = reset(); const outcome = await savePaymentConnection(form(undefined,undefined,{version:'9'}));
  assert.equal(outcome.ok,false); assert.match(outcome.message,/settings changed/i); assert.equal(state.calls.length,0);
});

test('restricted permission failures at account, webhook and portal never save settings; retry keys stay stable', async () => {
  const paths = ['account','webhook_endpoints','billing_portal/configurations'];
  for (const [index,providerErrorPath] of paths.entries()) {
    const state = reset({providerErrorPath,providerError:'Payment provider request failed (403). Check the connection or retry.'});
    const input = form(undefined,undefined,{intent:'save',enabled:'on'});
    const outcome = await savePaymentConnection(input);
    assert.equal(outcome.ok,false); assert.match(outcome.message,/403/);
    assert.equal(state.writes.length,0); assert.equal(state.encrypted,undefined); assert.equal(state.old.enabled,false);
    assert.deepEqual(state.calls.map(call=>call.path),paths.slice(0,index+1));
    assert.doesNotMatch(outcome.message,new RegExp(suffix));
    const failedCalls = [...state.calls]; state.calls = []; state.providerError = undefined;
    const retry = await savePaymentConnection(input);
    assert.equal(retry.ok,true); assert.equal(state.encrypted.enabled,true);
    assert.deepEqual(state.calls.map(call=>call.path),paths);
    assert.equal(state.calls[1].key,'market-webhook:acct_fixture:live:0');
    assert.equal(state.calls[2].key,'market-portal:acct_fixture:live:0');
    for (const call of failedCalls.filter(call=>call.key)) assert.equal(state.calls.find(retried=>retried.path===call.path).key,call.key);
    assert.equal(state.writes.filter(write=>write.table==='platform_payment_settings').length,1);
  }
});

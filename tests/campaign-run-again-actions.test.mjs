import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const id = '30000000-0000-0000-0000-000000000002';
const previousId = '30000000-0000-0000-0000-000000000001';
const input = { id, previousId, settingsVersion: 4, days: 7, creditLimit: 500 };

async function actionFixture() {
  const state = { calls: [], queries: [], revalidated: [], campaign: { status: 'running', auto_fund: false } };
  globalThis.__campaignRunAgain = state;
  const result = await build({
    entryPoints: ['app/campaigns/actions.ts'], bundle: true, write: false, platform: 'node', format: 'esm', alias: { '@': process.cwd() },
    plugins: [{ name: 'campaign-actions-fixture', setup(b) {
      b.onResolve({ filter: /^(next\/cache|@\/lib\/owner-campaigns)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'js', contents: a.path === 'next/cache'
        ? `export function revalidatePath(path){globalThis.__campaignRunAgain.revalidated.push(path)}`
        : `export async function ownerCampaignSettings(){if(globalThis.__campaignRunAgain.settings)return globalThis.__campaignRunAgain.settings;throw Error('Run again must validate settings inside its transaction')}
           export async function requireCampaignOwner(){
             const s=globalThis.__campaignRunAgain;if(s.denied)throw Error('Owner access required.');
             return{salonId:'trusted-salon',userId:'trusted-owner',client:{
               async rpc(name,args){s.calls.push({name,args});return{data:args.p_id,error:s.rpcError??null}},
               from(table){const filters={};s.queries.push({table,filters});return{
                 select(fields){s.fields=fields;return this},eq(key,value){filters[key]=value;return this},
                 async single(){return{data:table==='campaign_wallets'?(s.wallet??{auto_topup_enabled:false,payment_blocked:false}):s.campaign,error:s.loadError??null}}
               }}
             }}
           }` }));
    } }],
  });
  const actions = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
  return { state, ...actions };
}

test('run again uses trusted owner scope and sends only duration, credits, version and campaign IDs', async () => {
  const { state, runAgainOwnerCampaignAction } = await actionFixture();
  const result = await runAgainOwnerCampaignAction({ ...input, salonId: 'forged-salon', userId: 'forged-owner', sourceId: 'forged-post', area: 'country', keepRunning: true, approved: true });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'running');
  assert.match(result.message, /running again/);
  assert.deepEqual(state.calls, [{ name: 'campaign_run_again', args: { p_expected: 4, p_id: id, p_salon: 'trusted-salon', p_user: 'trusted-owner', p_previous: previousId, p_days: 7, p_limit: 500 } }]);
  assert.deepEqual(state.queries, [{ table: 'owner_campaigns', filters: { id, salon_id: 'trusted-salon' } }]);
  assert.deepEqual(state.revalidated, ['/campaigns']);
});

test('owner denial and invalid run-again inputs cannot call the transaction', async () => {
  const { state, runAgainOwnerCampaignAction } = await actionFixture();
  state.denied = true;
  assert.equal((await runAgainOwnerCampaignAction(input)).ok, false);
  state.denied = false;
  for (const invalid of [{ id: previousId }, { previousId: 'not-a-uuid' }, { days: 0 }, { days: 1.5 }, { days: 91 }, { creditLimit: 0 }, { creditLimit: 1.2 }, { creditLimit: Infinity }, { settingsVersion: undefined }, { settingsVersion: -1 }]) {
    assert.equal((await runAgainOwnerCampaignAction({ ...input, ...invalid })).ok, false);
  }
  assert.deepEqual(state.calls, []);
});

test('run-again awaiting credits explains funding without sending the owner to review', async () => {
  const { state, runAgainOwnerCampaignAction } = await actionFixture();
  for (const auto_fund of [false, true]) {
    state.campaign = { status: 'awaiting_payment', auto_fund };
    const result = await runAgainOwnerCampaignAction(input);
    assert.equal(result.status, 'awaiting_payment');
    assert.match(result.message, auto_fund ? /automatic credits within your existing limit/ : /Add credits to start/);
    assert.match(result.message, /no new review is needed/i);
  }
});

test('transaction rejection is surfaced and committed runs survive a status read failure', async () => {
  const { state, runAgainOwnerCampaignAction } = await actionFixture();
  state.rpcError = { message: 'This campaign has not expired.' };
  assert.deepEqual(await runAgainOwnerCampaignAction(input), { ok: false, message: state.rpcError.message });
  assert.deepEqual(state.queries, []);
  assert.deepEqual(state.revalidated, []);
  state.rpcError = null;
  state.loadError = { message: 'Temporary status read failure' };
  const saved = await runAgainOwnerCampaignAction(input);
  assert.equal(saved.ok, true);
  assert.equal(saved.id, id);
  assert.match(saved.message, /saved in History/);
});

test('new campaign preserves installed-client explicit credit ceiling and current version fallback',async()=>{
 const {state,createOwnerCampaignAction}=await actionFixture();state.settings={version:9,enabled:true,dailyPriceCents:100,viewsPerDollar:500,maxDays:30,maxDailyViews:10000,cityPricePercent:100};
 const result=await createOwnerCampaignAction({id,target:{sourceType:'custom',sourceId:previousId},area:'city',location:'Chicago',country:'United States',state:'Illinois',city:'Chicago',dailyViews:500,days:3,creditLimit:275});
 assert.equal(result.ok,true);assert.equal(state.calls[0].name,'campaign_create_versioned');assert.equal(state.calls[0].args.p_expected,9);assert.equal(state.calls[0].args.p_limit,275);
});
test('campaign actions preserve displayed pause episode and explicit non-owner resume',async()=>{
 const {state,changeOwnerCampaignAction}=await actionFixture();assert.equal((await changeOwnerCampaignAction(id,'resume')).ok,false);assert.equal(state.calls.length,0);
 assert.equal((await changeOwnerCampaignAction(id,'resume',previousId)).ok,true);assert.deepEqual(state.calls[0],{name:'owner_campaign_resume',args:{p_id:id,p_salon:'trusted-salon',p_user:'trusted-owner',p_episode:previousId}});
 assert.equal((await changeOwnerCampaignAction(id,'resume',null,'non_owner')).ok,true);assert.deepEqual(state.calls[1],{name:'owner_campaign_change',args:{p_id:id,p_salon:'trusted-salon',p_user:'trusted-owner',p_action:'resume'}});
});

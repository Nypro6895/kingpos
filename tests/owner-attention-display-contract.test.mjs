import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';

// Actual cumulative Attention DDL, including the later closing replacement and
// Gift/reward wrapper. The rest of the Gift migration concerns unrelated writes;
// its exact Attention section runs against minimal disposable table contracts.
const read = path => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/202611170002_owner_attention_display_contract.sql');
const gift = read('supabase/migrations/20261113120000_gift_ticket_unified.sql');
const giftAttention = gift.slice(gift.indexOf('-- Keep the original attention/Ignore keys.'));
assert.ok(giftAttention.startsWith('-- Keep the original attention/Ignore keys.'));
const salon = '10000000-0000-4000-8000-000000000001';
const otherSalon = '10000000-0000-4000-8000-000000000002';
const owner = '20000000-0000-4000-8000-000000000001';
const owner2 = '20000000-0000-4000-8000-000000000002';
const outsider = '20000000-0000-4000-8000-000000000003';
const customer = '30000000-0000-4000-8000-000000000001';
const ticket = '40000000-0000-4000-8000-000000000001';
const createdId = '50000000-0000-4000-8000-000000000001';
const editedId = '50000000-0000-4000-8000-000000000002';
const request = '60000000-0000-4000-8000-000000000001';
const createdKey = 'discount:' + createdId;
const editedKey = 'discount:' + editedId;
const initial = {
  ticket_number: 'T00001', status: 'closed', service_total: 60,
  discount_amount: 6, discount_type: 'percent', discount_value: 10,
  tax_rate: 0, tip_amount: 5, recorded_payment_total: 59,
  lines: [{id: 'line-1', service_name: 'QA Manicure', staff_name: 'QA Staff', service_total: 60}],
  payments: [{id: 'cash-1', method: 'cash', amount: 59}],
};
const corrected = {...initial, service_total: 65, discount_amount: 6.5,
  lines: [{...initial.lines[0], service_total: 65}]};

const presentationBundle = await build({entryPoints: ['lib/owner-attention-presentation.ts'], bundle: true, write: false, platform: 'node', format: 'esm'});
const {attentionPresentation, attentionChangeDetails, attentionTicketAmounts} = await import('data:text/javascript;base64,' + Buffer.from(presentationBundle.outputFiles[0].text).toString('base64'));
const mocks = {
  'next/link': 'export default function Link({href,children,...props}) {return <a href={href} {...props}>{children}</a>}',
  'next/navigation': 'export const useRouter=()=>({refresh(){throw Error("SSR must not write")}});',
  '@/components/workspace-language': 'export const WorkspaceText=({text})=><>{text}</>;',
};
const uiBundle = await build({
  stdin: {contents: `import React from 'react';import{renderToStaticMarkup}from'react-dom/server';import{AttentionNotification}from'./app/staff/today/owner-attention-panel';import{AttentionDetail}from'./app/staff/today/attention-detail';export const renderRow=(data,item)=>renderToStaticMarkup(<AttentionNotification data={data} item={item}/>);export const renderDetail=(data,item)=>renderToStaticMarkup(<AttentionDetail data={data} item={item}/>);`, resolveDir: process.cwd(), loader: 'tsx'},
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', loader: {'.css': 'empty'},
  plugins: [{name: 'read-only-render', setup(b) {
    b.onResolve({filter: /\.module\.css$/}, a => ({path: a.path, namespace: 'styles'}));
    b.onLoad({filter: /.*/, namespace: 'styles'}, () => ({contents: 'export default {};', loader: 'js'}));
    b.onResolve({filter: /.*/}, a => mocks[a.path] ? {path: a.path, namespace: 'fixture'} : undefined);
    b.onLoad({filter: /.*/, namespace: 'fixture'}, a => ({contents: mocks[a.path], loader: 'tsx', resolveDir: process.cwd()}));
  }}],
});
const renderedModule = {exports: {}};
new Function('require', 'module', 'exports', uiBundle.outputFiles[0].text)(createRequire(import.meta.url), renderedModule, renderedModule.exports);
const {renderRow, renderDetail} = renderedModule.exports;

async function setup() {
  const db = new PGlite();
  await db.exec('create role anon;create role authenticated;create role service_role;');
  await db.exec(read('tests/fixtures/owner-attention-schema.sql'));
  await db.exec(`
    alter table public.users add column display_name text;
    alter table public.financial_input_events add column request_id uuid;
    create table public.pos_ticket_input_requests(salon_id uuid,request_id uuid,actor_scope text,ticket_id uuid);
    create table public.reward_requests(id uuid,ticket_id uuid,salon_id uuid,status text,offer jsonb);
    create table public.gift_cards(id uuid,last4 text);
    create table public.gift_card_counter_sales(id uuid,salon_id uuid,service_ticket_id uuid,card_id uuid,actor_id uuid,amount_cents integer,status text,created_at timestamptz);
    create table public.gift_card_ledger(id uuid,salon_id uuid,ticket_id uuid,card_id uuid,actor_id uuid,kind text,delta numeric,created_at timestamptz);
    create table public.reward_ledger(ticket_id uuid,reason text,delta integer);
    create function public.ticket_reward_value(uuid) returns numeric language sql stable as $$
      select coalesce(sum(delta),0)::numeric from public.reward_ledger where ticket_id=$1
    $$;
    create function public.daily_input_reconciliation_values(uuid,date) returns jsonb language sql stable as $$
      select jsonb_build_object('expectedService',100,'actualService',cash_amount+credit_card_amount+other_amount,
        'serviceDifference',cash_amount+credit_card_amount+other_amount-100)
      from public.pos_daily_closings where salon_id=$1 and report_date=$2
    $$;
  `);
  for (const path of [
    'supabase/migrations/20261101070000_owner_financial_attention.sql',
    'supabase/migrations/20261101223000_attention_display_context.sql',
    'supabase/migrations/20261103221000_closing_attention_short_over.sql',
  ]) await db.exec(read(path));
  await db.exec('begin;\n' + giftAttention);
  await db.query('insert into locations values($1),($2)', [salon, otherSalon]);
  await db.query("insert into users values($1,'QA Owner'),($2,'QA Owner 2'),($3,'QA Staff')", [owner, owner2, outsider]);
  await db.query("select set_config('test.user_id',$1,false)", [owner]);
  await db.query("insert into customers values($1,$2,'Captured Customer')", [customer, salon]);
  await db.query("insert into pos_tickets(id,salon_id,customer_id,ticket_number,opened_at,status,facts) values($1,$2,$3,'T00001','2026-11-01T18:00:00Z','closed',$4)", [ticket, salon, customer, corrected]);
  await db.query("insert into pos_ticket_input_requests values($1,$2,$3,$4)", [salon, request, 'portable:qa-test-key', ticket]);
  await insertEvent(db, {id: createdId, before: {}, after: initial, action: 'created', at: '2026-11-01T18:00:00Z'});
  await insertEvent(db, {id: editedId, before: initial, after: corrected, action: 'updated', at: '2026-11-01T19:00:00Z'});
  // A later profile rename must not replace captured historical identity.
  await db.query("update customers set name='Renamed Later' where id=$1", [customer]);
  return db;
}

async function insertEvent(db, {id, before, after, action, at, sourceId = ticket, scope = salon, requestId = request}) {
  await db.query(`insert into financial_input_events(id,salon_id,kind,business_date,source_id,before_values,after_values,note,actor_name,created_at,event_action,request_id)
    values($1,$2,'ticket','2026-11-01',$3,$4,$5,'QA recorded reason','QA Cashier',$6,$7,$8)`,
  [id, scope, sourceId, before, after, at, action, requestId]);
}
async function data(db, item = null, page = 0, scope = salon) {
  return (await db.query('select owner_financial_attention($1,$2,$3) data', [scope, item, page])).rows[0].data;
}
async function canonical(db) {
  return (await db.query(`select jsonb_build_object(
    'events',(select jsonb_agg(to_jsonb(e) order by id) from financial_input_events e),
    'tickets',(select jsonb_agg(to_jsonb(t) order by id) from pos_tickets t),
    'ignored',(select coalesce(jsonb_agg(to_jsonb(i) order by item_key),'[]') from owner_attention_ignored i)
  ) snapshot`)).rows[0].snapshot;
}
async function candidateDefinitions(db) {
  return (await db.query(`select proname,pg_get_functiondef(oid) definition from pg_proc
    where oid in ('public.owner_attention_candidates(uuid)'::regprocedure,'public.owner_attention_candidates_before_gift(uuid)'::regprocedure)
    order by proname`)).rows;
}
async function candidates(db) {
  return (await db.query('select * from owner_attention_candidates($1) order by item_key', [salon])).rows;
}

test('cumulative regression: captured event facts reach the real list and detail without rewriting financial history', async t => {
  const db = await setup();
  try {
    const before = await data(db);
    assert.equal(before.total, 2);
    assert.ok(before.items.every(item => !Object.hasOwn(item, 'facts')), 'later closing RPC reproduced the missing-facts regression');
    const oldDetail = (await data(db, createdKey)).items[0];
    assert.equal(oldDetail.facts.eventAction, undefined);
    assert.deepEqual(oldDetail.facts.before, {discount_amount: 0}, 'Gift wrapper inserts a zero before amount even on creation');
    const snapshot = await canonical(db), definitions = await candidateDefinitions(db), raw = await candidates(db);
    await db.exec(migration);
    const list = await data(db);
    const created = list.items.find(item => item.item_key === createdKey);
    const edited = list.items.find(item => item.item_key === editedKey);
    await t.test('event IDs/actions, captured customer, cashier/source, service/staff and actual amounts', async () => {
      assert.deepEqual(list.items.map(item => item.item_key), [editedKey, createdKey]);
      assert.equal(list.total, 2);
      for (const [item, action] of [[created, 'created'], [edited, 'updated']]) {
        assert.equal(item.facts.eventAction, action);
        assert.equal(item.facts.eventId, action === 'created' ? createdId : editedId);
        assert.equal(item.facts.customerName, 'Captured Customer');
        assert.equal(item.facts.actor, 'QA Cashier');
        assert.equal(item.facts.source, 'POS');
        assert.equal(item.facts.createdBy, 'QA Cashier');
        assert.equal(item.facts.after.lines[0].staff_name, 'QA Staff');
        assert.deepEqual((await data(db, item.item_key)).items[0], item);
      }
      const first = attentionPresentation(created), second = attentionPresentation(edited);
      assert.equal(first.title, 'Discount · Ticket T1');
      assert.equal(first.created, true);
      assert.equal(first.edited, false);
      assert.equal(first.primary, 'Discount: −$6.00');
      assert.ok(attentionChangeDetails(created).every(row => row.comparison === 'recorded'));
      assert.match(first.service, /QA Manicure.*\$60\.00.*QA Staff/);
      assert.equal(second.title, 'Discount edited · Ticket T1');
      assert.match(second.primary, /\$6\.00 → \$6\.50/);
      assert.ok(second.changes.some(row => row.label === 'Ticket total' && row.before === '$59.00' && row.after === '$63.50'));
      assert.deepEqual(attentionTicketAmounts(edited.facts.after), {service: 65, discount: 6.5, tip: 5, total: 63.5, paid: 59, remaining: 4.5});
    });
    await t.test('real React row/detail projection contains the restored facts and correct creation label', () => {
      const row = renderRow(list, created), detail = renderDetail(list, edited), createdDetail = renderDetail(list, created);
      for (const text of ['Discount · Ticket T1', '−$6.00', '@Captured Customer', 'QA Manicure', 'QA Staff', 'Created by', 'QA Cashier', 'POS']) assert.ok(row.includes(text), text);
      for (const text of ['Unknown operator', 'Services not recorded', '@Not recorded', 'Discount edited']) assert.ok(!row.includes(text), text);
      for (const text of ['$6.00', '$6.50', '$63.50', 'Edited by', 'POS']) assert.ok(detail.includes(text), text);
      assert.ok(!createdDetail.includes('<h2>Changes</h2>'));
      assert.ok(createdDetail.includes('Created by'));
    });
    await t.test('read is idempotent and canonical money/events, candidate pipeline, keys and Ignore state stay identical', async () => {
      await data(db); await data(db, createdKey);
      assert.deepEqual(await canonical(db), snapshot);
      assert.deepEqual(await candidateDefinitions(db), definitions);
      assert.deepEqual(await candidates(db), raw);
    });
    await t.test('ordinary ticket edit retains context; an older event never borrows a later customer identity', async () => {
      const ordinaryId = '50000000-0000-4000-8000-000000000003';
      await insertEvent(db, {id: ordinaryId, before: corrected, after: {...corrected, notes: 'Updated note'}, action: 'updated', at: '2026-11-01T20:00:00Z'});
      const ordinary = (await data(db)).items.find(item => item.item_key === 'event:' + ordinaryId);
      assert.equal(ordinary.kind, 'ticket_change');
      assert.equal(ordinary.facts.eventAction, 'updated');
      assert.equal(ordinary.facts.source, 'POS');
      assert.equal(ordinary.facts.customerName, 'Renamed Later', 'context captured at this later event');
      assert.equal(attentionPresentation(ordinary).title, 'Ticket edited · Ticket T1');
      assert.match(attentionPresentation(ordinary).primary, /Updated note/);
      assert.deepEqual((await data(db, ordinary.item_key)).items[0], ordinary);
      const legacyId = '50000000-0000-4000-8000-000000000004';
      await insertEvent(db, {id: legacyId, before: {}, after: initial, action: null, at: '2026-11-01T17:00:00Z', requestId: null});
      // Simulate an immutable pre-context historical event, never backfill it.
      await db.query('update financial_input_events set attention_context=null where id=$1', [legacyId]);
      const historical = (await data(db, 'discount:' + legacyId)).items[0];
      assert.equal(historical.facts.eventAction, 'created', 'existing canonical classifier fallback');
      assert.equal(historical.facts.customerName, undefined);
      assert.equal(attentionPresentation(historical).customer, 'Not recorded');
      assert.equal(attentionPresentation(historical).source, 'Unknown');
      assert.equal((await db.query('select attention_context from financial_input_events where id=$1', [legacyId])).rows[0].attention_context, null);
    });
  } finally { await db.close(); }
});

test('latest Gift/reward and compact closing contracts survive the display enrichment', async t => {
  const db = await setup();
  try {
    const card = '70000000-0000-4000-8000-000000000001';
    await db.query("insert into gift_cards values($1,'0000')", [card]);
    await db.query("insert into gift_card_counter_sales values('71000000-0000-4000-8000-000000000001',$1,$2,$3,$4,2500,'active','2026-11-01T18:05:00Z')", [salon, ticket, card, owner]);
    await db.query("insert into gift_card_ledger values('72000000-0000-4000-8000-000000000001',$1,$2,$3,$4,'redeem',-1000,'2026-11-01T18:06:00Z')", [salon, ticket, card, owner]);
    await db.query("insert into reward_requests values('73000000-0000-4000-8000-000000000001',$1,$2,'redeemed',$3)", [ticket, salon, {valueCents: 500, points: 50}]);
    await db.query("insert into reward_ledger values($1,'Reward used',5)", [ticket]);
    await db.query(`insert into pos_daily_closings(salon_id,report_date,cash_amount,live_report_entered_at) values
      ($1,'2026-10-31',90,now()),($1,'2026-10-30',100,now()),($1,'2026-10-29',80,null),($1,'2026-11-01',80,now())`, [salon]);
    const prior = await data(db), raw = await candidates(db), definitions = await candidateDefinitions(db), snapshot = await canonical(db);
    await db.exec(migration);
    const list = await data(db), changed = list.items.find(item => item.item_key === editedKey), created = list.items.find(item => item.item_key === createdKey);
    await t.test('use already-adjusted discounts; preserve Gift/reward rows, direct Ticket links and compact DTOs', async () => {
      assert.equal(changed.facts.before.discount_amount, 1);
      assert.equal(changed.facts.after.discount_amount, 1.5);
      assert.equal(created.facts.after.discount_amount, 1);
      assert.equal(created.facts.eventAction, 'created');
      assert.equal(attentionPresentation(created).primary, 'Discount: −$1.00');
      assert.match(attentionPresentation(changed).primary, /\$1\.00 → \$1\.50/);
      for (const kind of ['gift_sale', 'gift_use', 'reward']) {
        const previous = prior.items.find(item => item.kind === kind), current = list.items.find(item => item.kind === kind);
        assert.ok(current, kind);
        assert.deepEqual(current, previous);
        assert.equal(current.target_href, '/pos-tickets/' + ticket);
        assert.equal(Object.hasOwn(current, 'facts'), false);
        assert.ok((await data(db, current.item_key)).items[0].facts);
      }
      assert.deepEqual(await candidates(db), raw);
      assert.deepEqual(await candidateDefinitions(db), definitions);
      assert.deepEqual(await canonical(db), snapshot);
    });
    await t.test('entered prior imbalanced closing only; compact values, per-owner Ignore, revision redisplay', async () => {
      const closings = list.items.filter(item => item.kind === 'closing');
      assert.equal(closings.length, 1);
      const closing = closings[0];
      assert.deepEqual(closing, prior.items.find(item => item.kind === 'closing'));
      assert.equal(closing.business_date, '2026-10-31');
      assert.equal(closing.difference, -10);
      assert.equal(closing.collected, 90);
      assert.equal(closing.expected, 100);
      assert.equal(Object.hasOwn(closing, 'facts'), false);
      await db.query("select owner_financial_attention_action($1,$2,'ignore')", [salon, closing.item_key]);
      assert.equal((await data(db)).items.some(item => item.item_key === closing.item_key), false);
      assert.equal((await data(db, closing.item_key)).items[0].ignored, true);
      await db.query("select set_config('test.user_id',$1,false)", [owner2]);
      assert.equal((await data(db)).items.some(item => item.item_key === closing.item_key), true);
      await db.query("select set_config('test.user_id',$1,false)", [owner]);
      await db.query("update pos_daily_closings set cash_amount=95 where salon_id=$1 and report_date='2026-10-31'", [salon]);
      const revised = (await data(db)).items.find(item => item.kind === 'closing');
      assert.notEqual(revised.item_key, closing.item_key);
      assert.equal(revised.difference, -5);
      assert.equal((await db.query('select count(*)::int n from owner_attention_ignored')).rows[0].n, 1);
    });
    await t.test('pure reward discount remains filtered rather than reintroduced by event enrichment', async () => {
      await db.query("update reward_requests set offer=jsonb_set(offer,'{valueCents}','650') where ticket_id=$1", [ticket]);
      const filtered = await data(db);
      assert.equal(filtered.items.some(item => item.kind === 'discount'), false);
      assert.ok(filtered.items.some(item => item.kind === 'reward'));
      assert.equal((await db.query('select after_values from financial_input_events where id=$1', [editedId])).rows[0].after_values.discount_amount, 6.5);
    });
  } finally { await db.close(); }
});

test('Owner SQL authorization, private helper/table grants, ordering and page boundaries remain enforced', async t => {
  const db = await setup();
  try {
    await db.exec(migration);
    await t.test('unauthenticated, non-Owner and cross-salon reads fail; canonical helpers and Ignore storage stay private', async () => {
      for (const user of ['', outsider]) {
        await db.query("select set_config('test.user_id',$1,false)", [user]);
        await assert.rejects(data(db), /Owner access required/);
        await assert.rejects(data(db, createdKey), /Owner access required/);
      }
      await db.query("select set_config('test.user_id',$1,false)", [owner]);
      await assert.rejects(data(db, null, 0, otherSalon), /Owner access required/);
      const grants = (await db.query(`select
        has_function_privilege('anon','public.owner_financial_attention(uuid,text,integer)','execute') anon_read,
        has_function_privilege('authenticated','public.owner_financial_attention(uuid,text,integer)','execute') auth_read,
        has_function_privilege('authenticated','public.owner_attention_candidates(uuid)','execute') candidates,
        has_function_privilege('authenticated','public.owner_attention_candidates_before_gift(uuid)','execute') original,
        has_function_privilege('authenticated','public.owner_attention_event_context(uuid)','execute') context,
        has_table_privilege('authenticated','public.owner_attention_ignored','select') ignored_read,
        has_table_privilege('authenticated','public.owner_attention_ignored','insert') ignored_write
      `)).rows[0];
      assert.deepEqual(grants, {anon_read: false, auth_read: true, candidates: false, original: false, context: false, ignored_read: false, ignored_write: false});
      const rls = (await db.query("select relrowsecurity enabled from pg_class where oid='public.owner_attention_ignored'::regclass")).rows[0];
      assert.equal(rls.enabled, true);
      await assert.rejects(data(db, null, -1), /Invalid page/);
      await assert.rejects(data(db, null, 100001), /Invalid page/);
    });
    await t.test('stable selected page contains at most 50; exact-detail selection ignores page offset', async () => {
      for (let n = 3; n <= 53; n++) {
        await insertEvent(db, {id: `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`, before: initial,
          after: {...corrected, discount_amount: 6.5 + n}, action: 'updated', at: '2026-11-01T20:00:00Z'});
      }
      const first = await data(db), second = await data(db, null, 1), third = await data(db, null, 2);
      assert.equal(first.total, 53);
      assert.equal(first.items.length, 50);
      assert.equal(second.items.length, 3);
      assert.equal(third.items.length, 0);
      const keys = [...first.items, ...second.items].map(item => item.item_key);
      assert.equal(new Set(keys).size, 53);
      assert.deepEqual((await data(db)).items.map(item => item.item_key), first.items.map(item => item.item_key));
      assert.equal((await data(db, createdKey, 999)).items[0].item_key, createdKey);
      // Instrument only the disposable context helper: page 0 must never enrich
      // the oldest event outside its materialized 50 rows, while its own page does.
      await db.exec(`create or replace function public.owner_attention_event_context(p_event uuid) returns jsonb
        language plpgsql stable security definer set search_path=pg_catalog,public as $$begin
        if p_event='${createdId}' then raise exception 'outside selected page';end if;
        return '{}'::jsonb;end;$$;`);
      assert.equal((await data(db)).items.length, 50);
      await assert.rejects(data(db, null, 1), /outside selected page/);
    });
  } finally { await db.close(); }
});

test('legacy, missing metadata and explicit creation do not invent zero amounts or edit history', () => {
  const base = {item_key: 'discount:legacy', kind: 'discount', label: 'Ticket T00001 discount', detail: 'Customer discount: $6.00',
    business_date: '2026-11-01', occurred_at: '2026-11-01T18:00:00Z', target_href: '/pos-tickets/1', ignored: false};
  assert.equal(attentionPresentation(base).primary, base.detail);
  assert.equal(attentionPresentation({...base, detail: ''}).primary, 'Earlier values not recorded');
  for (const missing of [undefined, null, '', ' ', 'unknown', false, [], {}]) assert.notEqual(attentionPresentation({...base, facts: {after: {discount_amount: missing}}}).primary, 'Discount: −$0.00');
  assert.equal(attentionPresentation({...base, facts: {after: {discount_amount: 0}}}).primary, 'Discount: −$0.00');
  const legacy = {...base, item_key: 'discount-current:legacy:revision', facts: {before: {discount_amount: 0}, after: corrected, actor: 'Earlier operator not recorded'}};
  const view = attentionPresentation(legacy);
  assert.equal(view.edited, false);
  assert.equal(view.created, false);
  assert.equal(view.actor, 'Earlier operator not recorded');
  assert.equal(view.source, 'Unknown');
  assert.equal(view.customer, 'Not recorded');
  assert.ok(attentionChangeDetails(legacy).every(row => row.comparison === 'recorded'));
  const explicit = {...base, facts: {eventAction: 'created', before: {status: 'open', discount_amount: 0}, after: initial}};
  assert.equal(attentionPresentation(explicit).edited, false);
  assert.ok(attentionChangeDetails(explicit).every(row => row.comparison === 'recorded'));
});

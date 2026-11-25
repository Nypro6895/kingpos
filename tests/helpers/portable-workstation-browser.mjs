import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { fixtureId } from './portable-workstation-fixture.mjs';

const require = createRequire(import.meta.url);

/** Actual API route and SQL with only existing Auth/catalog and delivery boundary adapters. */
export async function workstationBrowserServer(f, { actualUI = false } = {}) {
  const scope = new AsyncLocalStorage(), streams = new Map(), trace = [], frames = [], allStreams = new Set();
  function deliver(topic, envelope) { for (const response of streams.get(topic) ?? []) response.write('data: ' + JSON.stringify(envelope) + '\n\n'); }
  const fixture = {
    cookies: () => scope.getStore().cookies,
    client() {
      return {
        rpc(name, args) {
          const promise = (async () => {
            try {
              if (name === 'portable_workstation_command') return { data: await f.command(args.p_action, args.p_actor, args.p_input), error: null };
              if (name === 'get_pos_portable_access_context') {
                if (args.p_session_signature !== 'fixture-portable-signature') return { data: null, error: null };
                const { rows } = await f.db.query('select id as key_id,salon_id from pos_portable_access_keys where id=$1 and is_active', [args.p_key_id]);
                return { data: rows[0] ? { ...rows[0], capabilities: ['portable.pos.use'] } : null, error: null };
              }
              if (name === 'get_pos_workspace_draft') {
                if (args.p_signature !== 'fixture-portable-signature') return { data: null, error: null };
                const { rows } = await f.db.query('select d.token from pos_workspace_drafts w join pos_live_drafts d on d.id=w.draft_id where w.key_id=$1 and w.device_id=$2', [args.p_key, args.p_device]);
                return { data: rows[0] ?? { token: 'fixture-private-draft' }, error: null };
              }
              throw Error('Unapproved fixture RPC: ' + name);
            } catch (error) { return { data: null, error }; }
          })();
          promise.abortSignal = () => promise;
          return promise;
        },
        from(table) {
          assert.ok(['pos_live_drafts', 'portable_workstations'].includes(table));
          const fields = new Map();
          let projection = '*';
          async function read(required) {
            const names = [...fields.keys()];
            const { rows } = await f.db.query(`select ${projection} from ${table} where ${names.map((name, i) => `${name}=$${i + 1}`).join(' and ')}`, [...fields.values()]);
            return { data: rows[0] ?? null, error: required && !rows[0] ? Error('Missing fixture row') : null };
          }
          return { select(value) { assert.ok(['*', 'id', 'token'].includes(value)); projection = value; return this; }, eq(name, value) { assert.ok(['id', 'salon_id', 'key_id', 'draft_id', 'token'].includes(name)); fields.set(name, value); return this; }, async single() {
            return read(true);
          }, async maybeSingle() { return read(false);
          } };
        },
        channel(topic) { return { async httpSend(event, envelope) {
          assert.equal(event, 'portable-workstation');
          trace.push({ type: 'broadcast', kind: envelope.kind, id: envelope.messageId, topic, at: performance.now() });
          frames.push({ topic, envelope: structuredClone(envelope) });
          deliver(topic, envelope);
          return { success: true };
        } }; },
        async removeChannel() {},
      };
    },
    async snapshot(token) {
      const { rows } = await f.db.query('select d.id,d.salon_id,d.token,w.latest_envelope from pos_live_drafts d left join portable_workstations w on w.draft_id=d.id where d.token=$1', [token]);
      const row = rows[0];
      if (!row) return { ok: false, data: null };
      return { ok: true, data: { ...row, customer: null, staff_lines: [], status: 'draft', total: 0, version: 0 } };
    },
  };
  globalThis.__portableWorkstationFixture = fixture;
  const serverBundle = await build({ entryPoints: ['app/api/pos/workstation/route.ts'], bundle: true, write: false, format: 'cjs', platform: 'node', plugins: [{ name: 'isolated-api-boundaries', setup(builder) {
    builder.onResolve({ filter: /^(server-only|next\/headers|next\/server|@supabase\/supabase-js|@\/lib\/supabase\/server|@\/lib\/pos-settings|@\/app\/pos\/actions|@\/lib\/portable-workstation-customer-actions)$/ }, args => ({ path: args.path, namespace: 'workstation-server-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'workstation-server-fixture' }, args => ({ contents: {
      'server-only': '',
      'next/headers': 'export const cookies=async()=>globalThis.__portableWorkstationFixture.cookies();',
      'next/server': 'export const NextResponse={json:(body,init)=>Response.json(body,init)};',
      '@supabase/supabase-js': 'export const createClient=()=>globalThis.__portableWorkstationFixture.client();',
      '@/lib/supabase/server': 'export const createSupabaseServerClient=()=>globalThis.__portableWorkstationFixture.client();',
      '@/lib/pos-settings': 'export const getPublicPosDisplaySettingsByToken=async()=>({appDownloadUrl:"",customerBackgroundImageUrl:null,customerLeftAdImageUrl:null,customerLeftAdText:"",customerPromoBody:"",customerPromoTitle:"Welcome",customerRightAdImageUrl:null,customerRightAdText:"",customerShowBarcode:false,customerShowCustomerName:true,customerShowReceiptStatus:true,customerShowSalonName:true,customerShowServiceName:true,customerShowStaffName:true,salonLogoUrl:null,salonName:"Isolated fixture salon",tipSuggestions:[10,15,20]});',
      '@/app/pos/actions': 'export const getPosLiveDraft=(token)=>globalThis.__portableWorkstationFixture.snapshot(token);export const getCustomerDisplayServiceCatalog=async()=>[];export const submitCustomerDisplayPhone=async()=>{throw Error("Unapproved legacy phone action")};export const saveCustomerDisplayRequestedServices=async()=>{throw Error("Unapproved service action")};export const confirmCustomerDisplayLiveDraftTip=async()=>{throw Error("Unapproved legacy tip action")};export const getCustomerDisplayLiveDraftTipOptions=async()=>[];export const touchCustomerDisplayLiveDraftActivity=async()=>({ok:true});export const resetCustomerDisplayCompletedDraft=async()=>{throw Error("Unapproved legacy reset")};',
      '@/lib/portable-workstation-customer-actions': 'export const runPairedCustomerExtension=async()=>{throw Error("Unapproved customer extension")};',
    }[args.path] }));
  } }] });
  const api = { exports: {} };
  new Function('module', 'exports', 'require', serverBundle.outputFiles[0].text)(api, api.exports, require);
  const browserBundle = await build({ ...(actualUI ? { entryPoints: ['tests/helpers/portable-workstation-ui-entry.tsx'], outdir: 'fixture-ui', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' } } : { stdin: { resolveDir: process.cwd(), loader: 'ts', contents: browserEntry } }), bundle: true, write: false, format: 'iife', platform: 'browser', plugins: [{ name: 'loopback-realtime-adapter', setup(builder) {
    builder.onResolve({ filter: /^(?:@\/lib\/supabase\/browser|@\/lib\/app-local-host)$/ }, args => ({ path: args.path, namespace: 'workstation-browser-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'workstation-browser-fixture' }, args => ({ contents: args.path.endsWith('app-local-host') ? 'export const getAppLocalHost=()=>({isNative:false});export const appLocalRequestId=()=>crypto.randomUUID();' : browserRealtime }));
  } }, ...(actualUI ? [{ name: 'actual-ui-unrelated-server-boundaries', setup(builder) {
    builder.onResolve({ filter: /^next\/(navigation|link|image)$/ }, args => ({ path: args.path, namespace: 'workstation-ui-fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'workstation-ui-fixture' }, args => ({ loader: 'tsx', contents: args.path === 'next/navigation' ? 'const router={refresh(){},push(){},replace(){},prefetch(){}};export const useRouter=()=>router;export const usePathname=()=>"/pos/portable";export const useSearchParams=()=>new URLSearchParams(location.search);' : args.path === 'next/link' ? 'export default function Link({children,...props}){return <a {...props}>{children}</a>}' : 'export default function Image({priority,unoptimized,fill,...props}){return <img {...props}/>}' }));
    builder.onLoad({ filter: /\.tsx?$/ }, ({ path: filename }) => {
      const source = fs.readFileSync(filename, 'utf8');
      if (!/^\s*['"]use server['"]/.test(source)) return;
      const names = [...source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map(match => match[1]);
      return { contents: names.map(name => name === 'getPosLiveDraft' ? 'export async function getPosLiveDraft(){return {ok:true,data:await fetch("/__fixture/draft").then(response=>response.json())}}' : name === 'getCustomerDisplayLiveDraftTipOptions' ? 'export async function getCustomerDisplayLiveDraftTipOptions(){return {ok:true,data:[]}}' : `export async function ${name}(){return {ok:false,error:"This unrelated service is unavailable in isolated workstation acceptance."}}`).join('\n'), loader: 'js' };
    });
  } }] : [])] });
  const js = browserBundle.outputFiles.find(file => file.path.endsWith('.js'))?.text ?? browserBundle.outputFiles[0].text;
  let css = browserBundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  if (actualUI) {
    const globals = fs.readFileSync('app/globals.css', 'utf8').replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "' + path.resolve('app').replaceAll('\\', '/') + '";');
    css = (await postcss([tailwindcss()]).process(globals, { from: path.resolve('app/globals.css') })).css + '\n' + css;
  }
  let draftVersion = 0, draftPayload = null;
  const draftReplies = new Map();
  const draftSnapshot = async () => {
    const { rows } = await f.db.query('select token from pos_live_drafts where id=$1', [fixtureId(30)]);
    return { ...(await fixture.snapshot(rows[0].token)).data, version: draftVersion, customer_version: 0, receipt_version: draftVersion, last_customer_action_id: null, last_tip_action_id: null, server_now: new Date().toISOString(), updated_at: new Date().toISOString(), staff_lines: draftPayload?.staffLines ?? [], customer: draftPayload?.customer ?? null, selected_staff_id: draftPayload?.selectedStaffId ?? null, subtotal: draftPayload?.subtotal ?? 0, total_before_tip: draftPayload?.totalBeforeTip ?? 0, tax: draftPayload?.tax ?? 0, discount: draftPayload?.discount ?? 0, tip: draftPayload?.tip ?? 0, total: draftPayload?.total ?? 0, completed_at: null, reset_at: null };
  };
  const envKeys = ['SUPABASE_SERVICE_ROLE_KEY', 'PORTABLE_WORKSTATION_SIGNING_KEY', 'NEXT_PUBLIC_SUPABASE_URL'];
  const priorEnv = Object.fromEntries(envKeys.map(name => [name, process.env[name]]));
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-workstation-service-key';
  process.env.PORTABLE_WORKSTATION_SIGNING_KEY = 'synthetic-workstation-signing-key-never-used-outside-this-test';
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/__fixture/draft') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(await draftSnapshot())); return; }
      if (url.pathname === '/api/pos/portable/draft') {
        let raw = ''; for await (const chunk of request) raw += chunk;
        const operation = JSON.parse(raw); trace.push({ type: 'legacy-draft-adapter', id: operation.id });
        if (!draftReplies.has(operation.id)) { draftPayload = operation.payload; draftVersion = operation.expectedVersion + 1; draftReplies.set(operation.id, { kind: 'ok', version: draftVersion }); }
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(draftReplies.get(operation.id))); return;
      }
      if (url.pathname.startsWith('/api/pos/portable/')) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ today: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()), staff: [], waitingVisits: [], settings: null })); return; }
      if (url.pathname === '/__fixture/stream') {
        const topic = url.searchParams.get('topic');
        if (!streams.has(topic)) streams.set(topic, new Set());
        streams.get(topic).add(response); allStreams.add(response);
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        response.write(': loopback delivery adapter\n\n');
        request.on('close', () => { streams.get(topic)?.delete(response); allStreams.delete(response); });
        return;
      }
      if (url.pathname === '/api/pos/workstation') {
        let raw = ''; for await (const chunk of request) raw += chunk;
        let action; try { action = raw ? JSON.parse(raw).action : 'GET'; } catch { action = 'invalid-json'; }
        trace.push({ type: 'request', action, at: performance.now() });
        const values = new Map((request.headers.cookie ?? '').split(';').filter(Boolean).map(pair => { const i = pair.indexOf('='); return [pair.slice(0, i).trim(), decodeURIComponent(pair.slice(i + 1))]; }));
        const writes = [];
        const cookies = { get(name) { return values.has(name) ? { name, value: values.get(name) } : undefined; }, set(name, value, options) { values.set(name, value); writes.push(`${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax${options?.httpOnly ? '; HttpOnly' : ''}; Max-Age=${options?.maxAge ?? 31536000}`); }, delete(name) { values.delete(name); writes.push(`${name}=; Path=/; SameSite=Lax; Max-Age=0`); } };
        const headers = new Headers(); for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(',') : value);
        const webRequest = new Request(origin + request.url, { method: request.method, headers, ...(raw ? { body: raw } : {}) });
        const result = await scope.run({ cookies }, () => api.exports[request.method](webRequest));
        response.statusCode = result.status; result.headers.forEach((value, name) => response.setHeader(name, value));
        if (writes.length) response.setHeader('Set-Cookie', writes);
        response.end(await result.text()); return;
      }
      if (url.pathname.startsWith('/api/')) { response.statusCode = 503; response.setHeader('Content-Type', 'application/json'); response.end('{"ok":false,"error":"Unrelated provider unavailable in isolated acceptance."}'); return; }
      if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return; }
      if (url.pathname === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return; }
      if (/\.(png|jpg|jpeg|webp|svg|woff2)$/.test(url.pathname)) { const filename = path.resolve('public', '.' + url.pathname); if (filename.startsWith(path.resolve('public') + path.sep) && fs.existsSync(filename)) { response.setHeader('Content-Type', url.pathname.endsWith('.svg') ? 'image/svg+xml' : url.pathname.endsWith('.webp') ? 'image/webp' : 'image/png'); response.end(fs.readFileSync(filename)); return; } response.statusCode = 404; response.end(); return; }
      response.setHeader('Content-Type', 'text/html');
      if (actualUI) { response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>html,body,#root{height:100%;margin:0}body{font:14px Arial}#root{height:100dvh}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); return; }
      response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated workstation transport acceptance</title><style>body{font:16px system-ui;margin:24px}input,button{font:inherit;padding:12px}output{display:block;margin:10px 0;white-space:pre-wrap}</style><h1>Isolated workstation acceptance</h1><label>Staff amount<input id="amount" type="number" step="0.01" value="30"></label><output id="staff"></output><output id="customer"></output><output id="status"></output><script src="/fixture.js"></script>');
    } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.NEXT_PUBLIC_SUPABASE_URL = origin;
  return { origin, trace, frames, streams, deliver, async close() {
    for (const response of allStreams) response.end();
    await new Promise(resolve => server.close(resolve));
    for (const name of envKeys) if (priorEnv[name] === undefined) delete process.env[name]; else process.env[name] = priorEnv[name];
    delete globalThis.__portableWorkstationFixture;
  }, staffCookies: (deviceId = fixtureId(100)) => [
    { name: 'kingpos-portable-pos-key-id', value: fixtureId(10), url: origin },
    { name: 'kingpos-portable-pos-session', value: 'fixture-portable-signature', url: origin },
    { name: 'kingpos-workspace-device', value: deviceId, url: origin },
  ] };
}

const browserRealtime = `
const channels=new Set();
export function createSupabaseBrowserClient(){return {
 channel(topic){let receive,status,source;const channel={on(event,filter,callback){receive=callback;return channel},subscribe(callback){status=callback;source=new EventSource('/__fixture/stream?topic='+encodeURIComponent(topic));source.onopen=()=>status('SUBSCRIBED');source.onmessage=event=>receive({payload:JSON.parse(event.data)});source.onerror=()=>status('CHANNEL_ERROR');channels.add(channel);return channel},close(){source?.close();channels.delete(channel)},disconnect(){source?.close();status?.('CLOSED')}};return channel},
 async removeChannel(channel){channel.close()}
}}
window.fixtureDisconnectStreams=()=>{for(const channel of channels)channel.disconnect()};
`;

const browserEntry = `
import {workstationRequest,workstationChanged,connectPairedStaffReceipt,createPairedDisplayTransport} from './lib/portable-workstation-client';
let staff,display,unsubscribe,latest,received,version=0;const events=[];
const write=(id,value)=>document.getElementById(id).textContent=JSON.stringify(value);
function stored(){const value=localStorage.getItem('fixture-durable-cart');return value?JSON.parse(value):{cartId:'fixture-cart',revision:'initial',payload:{token:'fixture-private-draft',customer:null,selectedStaffId:null,staffLines:[{staffId:'fixture-staff',staffName:'Fixture staff',serviceName:'Manicure',amount:30}],subtotal:30,totalBeforeTip:30,tax:0,discount:0,tip:0,total:30}}}
function commit(value){latest=value;localStorage.setItem('fixture-durable-cart',JSON.stringify(value));write('staff',value);staff?.publish(value)}
window.fixture={events,request:workstationRequest,changed:workstationChanged,preview:()=>received,rejectPersistence:false,
 async startStaff(){await workstationRequest({action:'heartbeat',dirty:true,pending:false,cartId:'fixture-cart',revision:'initial'});staff?.close();staff=connectPairedStaffReceipt({tip(request){events.push({kind:'tip',at:performance.now(),request});if(window.fixture.rejectPersistence||!latest||request.cartId!==latest.cartId||request.revision!==latest.revision)return false;commit({...latest,revision:'tip-'+(++version),payload:{...latest.payload,tip:request.amount,total:latest.payload.totalBeforeTip+request.amount}});return true},customer(request){if(!latest||request.revision!==latest.revision)return false;commit({...latest,revision:'customer-'+(++version),payload:{...latest.payload,customer:request.customer}});return true},dismissCompleted(){}});commit(stored())},
 startCustomer(id){unsubscribe?.();display=createPairedDisplayTransport(id);unsubscribe=display.subscribe(value=>{received=value;events.push({kind:'preview',at:performance.now(),value});write('customer',value)},status=>write('status',status))},
 publish(amount){const value=latest??stored();const next={...value,revision:'amount-'+(++version)+'-'+crypto.randomUUID(),payload:{...value.payload,staffLines:[{staffId:'fixture-staff',staffName:'Fixture staff',serviceName:'Manicure',amount}],subtotal:amount,totalBeforeTip:amount,total:amount+value.payload.tip}};commit(next);return next},
 empty(){const value=latest??stored();commit({...value,cartId:'empty-'+crypto.randomUUID(),revision:'empty-'+(++version),payload:{...value.payload,staffLines:[],subtotal:0,totalBeforeTip:0,total:0,tip:0,tax:0,discount:0}})},
 async tip(amount,stale){return display.tip(stale??received,amount)},
 close(){staff?.close();unsubscribe?.()},
};document.getElementById('amount').addEventListener('input',event=>window.fixture.publish(Number(event.target.value)));
`;

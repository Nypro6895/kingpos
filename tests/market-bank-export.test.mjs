import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({entryPoints:['app/(app)/admin/market/ledger/export/route.ts'],bundle:true,write:false,format:'esm',platform:'node',alias:{'@':process.cwd()},plugins:[{name:'export-fixtures',setup(b){
 b.onResolve({filter:/^(server-only|next\/server|@\/lib\/platform-admin\/auth|@\/lib\/supabase\/server)$/},args=>({path:args.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='server-only'?'':args.path==='next/server'?`export class NextResponse extends Response{static json(body,options){return new NextResponse(JSON.stringify(body),options)}}` : args.path.includes('/auth')?`export async function getCurrentPlatformAdminContext(){return globalThis.marketExport.actor}`:`export async function createAuthenticatedSupabaseServerClient(){return{async rpc(name,values){globalThis.marketExport.calls.push({name,values});return globalThis.marketExport.result}}}`}));
}}]});
const {GET}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const row={id:'ledger',occurred_at:'2026-10-09T14:00:00Z',kind:'cash_out',bank_account_id:'bank',bank_reference:'=MALICIOUS()',order_reference:'RYL-123',plugin_name:'Booking Deposit',publisher:'Reylumi',salon_id:'salon',amount_cents:680,revenue_cents:-590,tax_cents:-47,fee_cents:-43,commission_cents:0,publisher_payable_cents:0,unapplied_cents:0,expense_cents:0,note:'line 1, "quoted"\nline 2'};
function reset(){globalThis.marketExport={actor:{roleSlug:'platform_owner',permissions:['admin.team.manage']},calls:[],result:{data:{row_count:1,ledger:[row]},error:null}};}
const request=query=>({nextUrl:new URL('https://example.com/admin/market/ledger/export'+query)});
test('financial export rejects unauthenticated and limited administrators before reading money',async()=>{
 for(const actor of [null,{roleSlug:'platform_admin',permissions:['admin.team.manage']},{roleSlug:'platform_owner',permissions:[]}]){reset();globalThis.marketExport.actor=actor;assert.equal((await GET(request(''))).status,403);assert.equal(globalThis.marketExport.calls.length,0);}
});
test('CSV retains negative refunds as summable numbers and escapes user-supplied formulas',async()=>{
 reset();const response=await GET(request('?from=2026-10-01&to=2026-11-01'));
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const csv=await response.text();assert.ok(csv.includes(',0.00,6.80,-5.90,-0.47,-0.43,0.00,0.00,0.00,0.00,'));
 assert.ok(csv.includes('"\'=MALICIOUS()"'));assert.ok(csv.includes('"line 1, ""quoted""\nline 2"'));
 assert.deepEqual(globalThis.marketExport.calls,[{name:'market_billing_export_ledger',values:{p_from:'2026-10-01',p_to:'2026-11-01'}}]);
});
test('CSV never returns a successful silently incomplete ledger or an invalid date range',async()=>{
 reset();assert.equal((await GET(request('?from=2026-11-01&to=2026-10-01'))).status,400);assert.equal(globalThis.marketExport.calls.length,0);
 reset();globalThis.marketExport.result.data.row_count=2;assert.equal((await GET(request(''))).status,503);
 reset();globalThis.marketExport.result.error={message:'private database information'};const response=await GET(request(''));assert.equal(response.status,503);assert.ok(!(await response.text()).includes('private database'));
});

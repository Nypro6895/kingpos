import {NextRequest,NextResponse} from 'next/server';
import {getCurrentPlatformAdminContext} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS as P} from '@/lib/platform-admin/permissions';
import {createAuthenticatedSupabaseServerClient} from '@/lib/supabase/server';
import {marketTaxDateRange} from '@/lib/market-tax';
import {adminCsvCell} from '@/lib/platform-admin/csv';
import type {MarketTaxLedgerEntry} from '@/types/market-tax';
export async function GET(request:NextRequest){
 const actor=await getCurrentPlatformAdminContext();if(actor?.roleSlug!=='platform_owner'||!actor.permissions.includes(P.teamManage))return NextResponse.json({error:'Access denied'},{status:403});
 let range;try{range=marketTaxDateRange({from:request.nextUrl.searchParams.get('from')??undefined,to:request.nextUrl.searchParams.get('to')??undefined});}catch{return NextResponse.json({error:'Choose a valid date range. Both dates are included.'},{status:400});}
 try{
  const client=await createAuthenticatedSupabaseServerClient();if(!client)return NextResponse.json({error:'Sign in again'},{status:401});
  const {data,error}=await client.rpc('market_tax_export_ledger',{p_from:range.p_from,p_to:range.p_to});if(error||!Array.isArray(data?.ledger)||data.row_count!==data.ledger.length)throw Error('Incomplete export');
  const rows=[['Entry ID','Date (UTC)','Kind','Invoice','Purchase','Country','State','Jurisdiction','Tax collected USD','Tax returned USD','Net tax USD'],...(data.ledger as MarketTaxLedgerEntry[]).map(row=>[row.id,row.occurred_at,row.kind,row.invoice_id,row.purchase_id,row.country,row.state,row.jurisdiction,row.kind==='sale'?row.tax_cents/100:0,row.kind==='refund'?-row.tax_cents/100:0,row.tax_cents/100])];
  return new NextResponse('\uFEFF'+rows.map(row=>row.map(value=>typeof value==='number'?value.toFixed(2):adminCsvCell(value)).join(',')).join('\r\n'),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename=reylumi-plugin-tax.csv','Cache-Control':'private, no-store'}});
 }catch{return NextResponse.json({error:'The complete tax report could not be exported. Try a narrower date range or retry.'},{status:503});}
}

import Link from "next/link";
import {notFound} from "next/navigation";
import {withExperiencePage} from "@/components/experience-page";
import {requirePlatformAdmin} from "@/lib/platform-admin/auth";
import {PLATFORM_ADMIN_PERMISSIONS as P} from "@/types/platform-admin";
import {advertisingClient} from "@/lib/explore-advertising";
import {formatCredits} from "@/lib/campaign-credit-display";
import {money} from "@/lib/owner-campaign-rules";
import {ownerCampaignSettings} from "@/lib/owner-campaigns";
import {OwnerCampaignSettingsPanel} from "../../advertising/owner-campaign-settings";
import {EntityPicker} from "../../_components/entity-picker";
import {AdminActionForm} from "../../_components/action-form";
import {campaignCreditAdminAction} from "./actions";
import {AdminPageHeader} from "../../_components/admin-ui";
import "../system.css";
type CreditAdminRow={id?:string;salon_id:string;credits?:number;amount_cents?:number;status?:string;automatic?:boolean;created_at?:string;error?:string;provider_reference?:string;kind?:string;reference?:string;available_credits?:number;reserved_credits?:number;auto_topup_enabled?:boolean;payment_blocked?:boolean};
async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const actor=await requirePlatformAdmin(P.teamManage);if(actor.roleSlug!=="platform_owner")notFound();
 const params=await searchParams;const page=Math.max(1,Math.min(10000,Math.floor(Number(params.page)||1)));const size=25;
 const salon=typeof params.salon==="string"&&/^[0-9a-f-]{36}$/i.test(params.salon)?params.salon:"";
 const status=typeof params.status==="string"&&["pending","processing","paid","failed","cancelled"].includes(params.status)?params.status:"";
 const view=params.view==="ledger"?"ledger":params.view==="wallets"?"wallets":"orders";
 const client=advertisingClient();
 let query=client.from(view==="orders"?"campaign_credit_orders":view==="ledger"?"campaign_credit_ledger":"campaign_wallets").select(view==="orders"?"id,salon_id,credits,amount_cents,status,automatic,created_at,error,provider_reference":view==="ledger"?"id,salon_id,kind,credits,reference,created_at":"salon_id,available_credits,reserved_credits,installed,auto_topup_enabled,payment_blocked,updated_at",{count:"exact"});
 if(salon)query=query.eq("salon_id",salon);if(status&&view==="orders")query=query.eq("status",status);
 const result=await query.order(view==="wallets"?"updated_at":"created_at",{ascending:false}).order(view==="wallets"?"salon_id":"id").range((page-1)*size,page*size-1).returns<CreditAdminRow[]>();
 const rows=result.data??[];const ids=[...new Set(rows.map(row=>String(row.salon_id)))];const names=ids.length?await client.from("locations").select("id,name").in("id",ids):{data:[],error:null};
 const salonName=(id:string)=>names.data?.find(row=>row.id===id)?.name??id;
 const href=(p:number)=>`/admin/market/credits?${new URLSearchParams({view,salon,status,page:String(p)})}`;
 const reason=<label className="system-field"><span>Reason</span><input name="reason" minLength={3} maxLength={1000} required/></label>;
 const settings=actor.permissions.includes(P.advertisingManage)?await ownerCampaignSettings().catch(()=>null):null;
 return <div className="market-system"><AdminPageHeader eyebrow="Market · Campaigns" title="Ad credits">$1 = 120 credits. Purchases, balances and credit usage are separate from plugin subscriptions.</AdminPageHeader><p><Link href="/admin/market">← Market &amp; System</Link> · <Link href="/admin/advertising/reviews">Ad reviews</Link></p>
 <nav className="system-actions">{["orders","ledger","wallets"].map(v=><Link key={v} href={`/admin/market/credits?view=${v}`} aria-current={view===v?"page":undefined}>{v==="orders"?"Credit purchases":v==="ledger"?"Credit activity":"Salon balances"}</Link>)}</nav>
 <form className="system-form" method="get"><input type="hidden" name="view" value={view}/><EntityPicker kind="location" name="salon" label="Salon" defaultValue={salon} defaultLabel={salon?salonName(salon):""}/>{view==="orders"?<label className="system-field"><span>Purchase status</span><select name="status" defaultValue={status}><option value="">All</option>{["pending","processing","paid","failed","cancelled"].map(s=><option key={s}>{s}</option>)}</select></label>:null}<button>Apply filters</button></form>
 {result.error?<p role="alert">Credit records could not load. Refresh before performing an operation.</p>:<><p>{result.count??0} records</p>{rows.length?rows.map(row=><article className="system-row" key={String(row.id??row.salon_id)}><div className="system-row-body"><h2>{salonName(String(row.salon_id))}</h2><p><Link href={`/admin/market/credits?view=wallets&salon=${row.salon_id}`}>Salon balance</Link> · <Link href={`/admin/market/credits?view=orders&salon=${row.salon_id}`}>Purchases</Link> · <Link href={`/admin/market/credits?view=ledger&salon=${row.salon_id}`}>Credit activity</Link></p>
 {view==="orders"?<><p><strong>{formatCredits(Number(row.credits))} credits</strong> · {money(Number(row.amount_cents))} · {String(row.status)} · {row.automatic?"Automatic purchase":"One-time purchase"}</p><small>{new Date(String(row.created_at)).toLocaleString()}</small>{row.error?<p role="status">{String(row.error)}</p>:null}<details><summary>Details &amp; payment check</summary><p>Order {String(row.id)}</p>{row.provider_reference?<p>Payment {String(row.provider_reference)}</p>:null}<AdminActionForm action={campaignCreditAdminAction} className="system-form"><input type="hidden" name="id" value={String(row.id)}/>{reason}<label className="system-field"><span>Payment reference, if missing</span><input name="reference" placeholder="From the payment provider" maxLength={240}/></label><button name="intent" value="reconcile">Check payment &amp; sync credits</button><p className="system-note">Checks an existing payment. Never sends a new charge.</p></AdminActionForm>{!row.automatic&&row.status==="pending"?<AdminActionForm action={campaignCreditAdminAction} className="system-form" confirmMessage="Cancel this unpaid checkout? A completed payment will be preserved."><input type="hidden" name="id" value={String(row.id)}/>{reason}<button name="intent" value="cancel">Cancel unpaid checkout</button></AdminActionForm>:null}</details></>:view==="ledger"?<><p>{String(row.kind)} · <strong>{formatCredits(Number(row.credits))} credits</strong></p><small>{new Date(String(row.created_at)).toLocaleString()}</small><details><summary>Activity reference</summary><p>{String(row.reference)}</p></details></>:<><p>{formatCredits(Number(row.available_credits))} available · {formatCredits(Number(row.reserved_credits))} reserved</p><p>Automatic purchases: {row.auto_topup_enabled?"On":"Off"} · Payments: {row.payment_blocked?"Blocked":"Allowed"}</p>{row.auto_topup_enabled?<AdminActionForm action={campaignCreditAdminAction} className="system-form" confirmMessage="Stop this salon's future automatic credit purchases? A payment already processing may still finish."><input type="hidden" name="id" value={String(row.salon_id)}/>{reason}<button name="intent" value="stop">Stop future automatic purchases</button></AdminActionForm>:null}</>}
 </div></article>):<p>No matching credit records.</p>}<nav className="system-actions">{page>1?<Link href={href(page-1)}>Previous</Link>:null}{page*size<(result.count??0)?<Link href={href(page+1)}>Next</Link>:null}</nav></>}
 {settings?<details><summary>Edit Campaigns defaults for future ads</summary><OwnerCampaignSettingsPanel initial={settings} error=""/></details>:actor.permissions.includes(P.advertisingManage)?<p role="alert">Campaign settings could not load. Refresh before editing.</p>:null}
 </div>;
}
export default withExperiencePage(Page,{admin:true});

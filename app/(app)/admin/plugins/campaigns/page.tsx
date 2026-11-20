import Link from 'next/link';
import {withExperiencePage} from '@/components/experience-page';
import {requirePlatformAdmin} from '@/lib/platform-admin/auth';
import {PLATFORM_ADMIN_PERMISSIONS as P} from '@/types/platform-admin';
import {advertisingClient} from '@/lib/explore-advertising';
import {ownerCampaignSettings} from '@/lib/owner-campaigns';
import {adminCampaignFilters} from '@/lib/admin-campaign-filters';
import {OwnerCampaignSettingsPanel} from '../../advertising/owner-campaign-settings';
import {CampaignCredits} from '../../market/credits/workspace';
import {CampaignList,type CampaignAdminRow} from './campaign-list';
import {AdminIcon} from '../../_components/admin-icon';
import './workspace.css';
type Params=Record<string,string|string[]|undefined>;
async function Page({searchParams}:{searchParams:Promise<Params>}){
 const actor=await requirePlatformAdmin(P.advertisingReview),params=await searchParams;
 const owner=actor.roleSlug==='platform_owner',canSettings=actor.permissions.includes(P.advertisingManage);
 const tab=params.tab==='credits'&&owner?'credits':params.tab==='settings'&&canSettings?'settings':'ads';
 let filters:ReturnType<typeof adminCampaignFilters>|null=null,error='';
 try{filters=adminCampaignFilters(params);}catch(e){error=e instanceof Error?e.message:'Check the filters.';}
 const client=advertisingClient();let rows:CampaignAdminRow[]=[],count=0;
 if(tab==='ads'&&filters){const f=filters;let query=client.from('admin_campaign_list').select('*',{count:'exact'}).is('archived_at',null).in('status',[...f.states]);
 if(f.focus)query=query.eq('id',f.focus);if(f.from)query=query.gte('created_at',f.from+'T00:00:00Z');if(f.endExclusive)query=query.lt('created_at',f.endExclusive);
 if(f.q)query=query.or(`title.ilike.%${f.q}%,salon_name.ilike.%${f.q}%`);
 const result=await query.order('created_at',{ascending:false}).order('id').range((f.page-1)*25,f.page*25-1);if(result.error)error='Ads could not load. Refresh and retry.';
 count=result.count??0;const campaigns=(result.data??[]) as (CampaignAdminRow&{salon_name:string|null})[];
 rows=await Promise.all(campaigns.map(async c=>{let image:string|null=null,caption='',href:string|null=null;try{
 const table=c.source_type==='custom'?'owner_campaign_creatives':c.source_type==='salon_profile_look'?'salon_profile_looks':c.source_type==='salon_profile_update'?'salon_profile_updates':null;
 if(table){const result=await client.from(table).select('caption,media_path').eq('id',c.source_id).eq('salon_id',c.salon_id).maybeSingle();if(result.error)throw result.error;const post=result.data;caption=post?.caption??'';if(post?.media_path){if(c.source_type==='custom'){const signed=await client.storage.from('campaign-creatives').createSignedUrl(post.media_path,3600);image=signed.data?.signedUrl??null;}else image=client.storage.from('salon-profile-media').getPublicUrl(post.media_path).data.publicUrl;}}
 if(c.source_type==='salon_profile_look')href=`/explore/looks/${c.source_id}`;else if(c.source_type!=='custom')href=`/explore/salons/${c.salon_id}`;
 }catch{/* Keep the row and actions visible if its source asset is unavailable. */}
 return{...c,salonName:c.salon_name??'Salon',image,caption,href};}));}
 const url=(patch:Record<string,string>)=>{const q=new URLSearchParams();for(const [k,v]of Object.entries(params))if(typeof v==='string'&&k!=='page')q.set(k,v);for(const[k,v]of Object.entries(patch)){if(v)q.set(k,v);else q.delete(k);}return '/admin/plugins/campaigns?'+q;};
 return <div className="campaign-admin"><Link className="campaign-back" href="/admin/plugins">← Back to Plugins</Link><header className="campaign-heading"><h1>Campaigns</h1><small>120 credits = $1</small></header><nav className="campaign-tabs" aria-label="Campaigns">{[['ads','Ads'],...(owner?[['credits','Credits']]:[]),...(canSettings?[['settings','Settings']]:[])].map(([key,label])=><Link key={key} href={url({tab:key,page:'',campaign:'',status:'',q:'',month:'',from:'',to:'',view:'',salon:''})} aria-current={tab===key?'page':undefined}>{label}</Link>)}</nav>
 {tab==='credits'?<CampaignCredits embedded searchParams={searchParams}/>:tab==='settings'?<OwnerCampaignSettingsPanel initial={await ownerCampaignSettings()} error=""/>:<><div className="campaign-toolbar"><nav className="campaign-status-tabs" aria-label="Ad status">{[['pending','Awaiting review'],['running','Running'],['completed','Finished'],['issues','Needs attention']].map(([key,label])=><Link key={key} aria-current={filters?.group===key?'page':undefined} href={url({status:key,campaign:''})}>{label}</Link>)}</nav><form className="campaign-search" method="get"><input type="hidden" name="status" value={filters?.group??'pending'}/>{['from','to','month'].map(k=>typeof params[k]==='string'?<input key={k} type="hidden" name={k} value={params[k] as string}/>:null)}<input name="q" aria-label="Search salon or ad" placeholder="Search salon or ad…" defaultValue={typeof params.q==='string'?params.q:''}/><button aria-label="Search" type="submit"><AdminIcon name="search"/></button></form><details className="campaign-date-filter" open={Boolean(error&&Object.keys(params).some(k=>['from','to','month'].includes(k)))}><summary aria-label="Filter by month or date"><AdminIcon name="calendar"/></summary><form method="get"><input type="hidden" name="status" value={filters?.group??'pending'}/><input type="hidden" name="q" value={filters?.q??''}/><label>Month<input type="month" name="month" defaultValue={typeof params.month==='string'?params.month:''}/></label><span>or date range</span><label>From<input type="date" name="from" defaultValue={typeof params.from==='string'?params.from:''}/></label><label>To<input type="date" name="to" defaultValue={typeof params.to==='string'?params.to:''}/></label><button>Apply</button><Link href={url({month:'',from:'',to:''})}>Clear dates</Link></form></details></div>
 {filters&&(filters.from||filters.to||filters.q)?<p className="campaign-filter-summary">{filters.q?`“${filters.q}” · `:''}{filters.from||'Any date'} – {filters.to||'today'} · <Link href={url({q:'',month:'',from:'',to:'',campaign:''})}>Clear filters</Link></p>:null}
 {error?<p role="alert">{error}</p>:<><CampaignList campaigns={rows}/><nav className="campaign-pagination" aria-label="Ad pages"><span>{count} ads</span>{(filters?.page??1)>1?<Link href={url({page:String(filters!.page-1)})}>Previous</Link>:null}{(filters?.page??1)*25<count?<Link href={url({page:String(filters!.page+1)})}>Next</Link>:null}</nav></>}
 </>}
 </div>;
}
export default withExperiencePage(Page,{admin:true});

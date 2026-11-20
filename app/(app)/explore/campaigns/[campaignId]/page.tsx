import { withExperiencePage } from "@/components/experience-page";
import {notFound} from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {advertisingClient} from "@/lib/explore-advertising";
import {getPublicBookingPageData} from "@/lib/public-booking";
import styles from "@/components/owner-campaign.module.css";
async function CampaignDetail({params}:{params:Promise<{campaignId:string}>}){
 const {campaignId}=await params;if(!/^[0-9a-f-]{36}$/i.test(campaignId))notFound();const client=advertisingClient();
 // A final admitted view can exhaust the budget before its CTA navigation lands.
 // Keep that approved destination readable for the remaining scheduled period.
 const {data:c}=await client.from("owner_campaigns").select("source_id,source_type,salon_id,approved_at").eq("id",campaignId).in("status",["running","completed"]).is("archived_at",null).gt("ends_at",new Date().toISOString()).maybeSingle();if(!c?.approved_at||c.source_type!=="custom")notFound();
 const {data:creative}=await client.rpc("owner_campaign_post",{p_type:"custom",p_source:c.source_id,p_salon:c.salon_id});if(!creative)notFound();
 const {data:image}=await client.storage.from("campaign-creatives").createSignedUrl(creative.media_path,3600);
 const booking=await getPublicBookingPageData(c.salon_id,{}, {deferAvailability:true}).catch(()=>null);
 return <main className={styles.page} style={{maxWidth:760}}><Link href="/explore">Back to Explore</Link><p className={styles.eyebrow}>SPONSORED</p><h1>{creative.title}</h1>{image?.signedUrl?<Image unoptimized src={image.signedUrl} alt={creative.title} width={1200} height={900} style={{width:"100%",height:"auto",borderRadius:20}}/>:null}<p style={{whiteSpace:"pre-wrap",lineHeight:1.7}}>{creative.caption}</p><div className={styles.actions}><Link className={styles.secondary} href={`/explore/salons/${c.salon_id}`}>Visit business</Link>{booking?.state==="ready"?<Link className={styles.primary} href={`/book/${c.salon_id}`}>Choose a service & time</Link>:<p>Check the business profile for services and contact options. Online booking is currently unavailable.</p>}</div></main>;
}

export default withExperiencePage(CampaignDetail);

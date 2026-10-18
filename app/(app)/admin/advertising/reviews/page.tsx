import Link from "next/link";
import {withExperiencePage} from "@/components/experience-page";
import {requirePlatformAdmin} from "@/lib/platform-admin/auth";
import {PLATFORM_ADMIN_PERMISSIONS as P} from "@/types/platform-admin";
import {advertisingClient} from "@/lib/explore-advertising";
import type {OwnerCampaign} from "@/types/owner-campaign";
import {CampaignReviewQueue} from "./review-queue";
import {AdminPageHeader} from "../../_components/admin-ui";
async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await requirePlatformAdmin(P.advertisingReview);const params=await searchParams;
 const page=Math.max(1,Math.min(10000,Math.floor(Number(params.page)||1)));const size=25;
 const focus=typeof params.campaign==="string"&&/^[0-9a-f-]{36}$/i.test(params.campaign)?params.campaign:null;
 let query=advertisingClient().from("owner_campaigns").select("*",{count:"exact"}).eq("status","pending_review");if(focus)query=query.eq("id",focus);
 const {data,error,count}=await query.order("updated_at").order("id").range((page-1)*size,page*size-1);
 return <><AdminPageHeader eyebrow="Review & support" title="Ad reviews">Preview each ad before approving it. Declining returns unused reserved credits. Pricing and payment settings are managed separately.</AdminPageHeader>{error?<p role="alert">Ads could not load. Refresh to retry.</p>:<><p>{count??0} ads awaiting review{focus?<> · <Link href="/admin/advertising/reviews">View all reviews</Link></>:null}</p><CampaignReviewQueue campaigns={(data??[]) as OwnerCampaign[]}/><nav aria-label="Review pages">{page>1?<Link href={`/admin/advertising/reviews?page=${page-1}`}>Previous</Link>:null} {page*size<(count??0)?<Link href={`/admin/advertising/reviews?page=${page+1}`}>Next</Link>:null}</nav></>}</>;
}
export default withExperiencePage(Page,{admin:true});

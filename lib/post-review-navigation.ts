import type {AdminPostSafetyCase} from "@/types/admin-post-safety";

export const reportReasonLabels:Record<string,string>={minor_safety:"Safety of someone under 18",harassment:"Harassment or abuse",self_harm:"Suicide or self-harm",violence:"Violent or hateful content",restricted_items:"Restricted items",sexual:"Adult content",scam:"Scam or false information",intellectual_property:"Intellectual property",unwanted:"Does not want to see this"};
export function reportReasonLabel(reason:string){return reportReasonLabels[reason]??reason.replace(/_/g," ");}
export function formatReviewDate(value?:string|null){
 if(!value)return "Not available";
 const date=new Date(value);
 return Number.isNaN(date.getTime())?"Not available":new Intl.DateTimeFormat("en-US",{timeZone:"America/Chicago",dateStyle:"medium",timeStyle:"short"}).format(date);
}
export function originalPostHref(item:AdminPostSafetyCase){
 const post=item.current_post??item.content_snapshot;
 if(item.source_type==="beauty_post")return post.profile_id?`/explore/beauty/${encodeURIComponent(post.profile_id)}/posts/${encodeURIComponent(item.source_id)}`:null;
 return post.salon_id?`/explore/salons/${encodeURIComponent(post.salon_id)}#${item.source_type==="salon_profile_look"?"look":"update"}-${encodeURIComponent(item.source_id)}`:null;
}
export type ReviewFilters={query:string;status:string;reason:string;sort:string;author:string;reporter:string;post:string};
export function filterReviewCases(cases:AdminPostSafetyCase[],origin:string,f:ReviewFilters){
 const query=f.query.trim().toLowerCase();
 return cases.filter(c=>c.origin===origin&&(f.status==="all"||c.status===f.status||(f.status==="resolved"&&c.status!=="pending"))&&(f.reason==="all"||c.reason===f.reason)&&(!f.author||c.author_user_id===f.author)&&(!f.reporter||c.reporter_user_id===f.reporter)&&(!f.post||`${c.source_type}:${c.source_id}`===f.post)&&(!query||[c.id,c.platform_report_id,c.source_id,c.author_name,c.reporter_name,c.salon_name,reportReasonLabel(c.reason),c.current_post?.caption,c.current_post?.title,c.content_snapshot.caption,c.content_snapshot.title].some(v=>v?.toLowerCase().includes(query)))).sort((a,b)=>{
  const time=new Date(a.created_at).getTime()-new Date(b.created_at).getTime();
  return (f.sort==="oldest"?time:-time)||a.id.localeCompare(b.id);
 });
}

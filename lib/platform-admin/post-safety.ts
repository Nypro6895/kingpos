import "server-only";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { abuseServiceClient } from "@/lib/abuse-server";
import type { AdminPostSafetyCase, AdminPostReviewWorkspace } from "@/types/admin-post-safety";
import type {AdminReportPreview} from '@/lib/admin-report-presentation';

export async function loadAdminPostSafetyCases(origin: string = "user", reportId?: string) {
  // This permission-checked RPC must succeed before privileged storage signing.
  const cases = await callPlatformAdminRpc<AdminPostSafetyCase[]>("get_admin_post_safety_cases", {p_origin: origin, p_report_id: reportId ?? null});
  if (!cases.length) return cases;
  const storage = abuseServiceClient().storage;
  return Promise.all(cases.map(async item => ({...item, media: await Promise.all(item.media.map(async media => {
    if (!["salon-profile-media", "beauty-profile-media"].includes(media.bucket)) return {...media, url: null};
    const {data, error} = await storage.from(media.bucket).createSignedUrl(media.path, 3600);
    return {...media, url: error ? null : data?.signedUrl ?? null};
  }))})));
}

export async function loadAdminPostReviewWorkspace(origin="user", caseId?:string, reportId?:string, params:Record<string,string|undefined>={}) {
  const validId=(value?:string)=>value&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?value:null;
  const data=await callPlatformAdminRpc<AdminPostReviewWorkspace>("get_admin_post_review_workspace",{p_origin:origin,p_case_id:validId(caseId),p_report_id:validId(reportId),p_offset:Math.max(0,Math.min(100000,Number(params.offset)||0)),p_post:params.post??"",p_author:validId(params.author),p_reporter:validId(params.reporter),p_status:["all","resolved"].includes(params.status??"")?params.status:"pending",p_query:(params.q??"").trim().slice(0,200),p_reason:params.reason??"all",p_sort:params.sort==="oldest"?"oldest":"newest"});
  const storage=abuseServiceClient().storage;
  const communication=await callPlatformAdminRpc<Record<string,{report_id:string;status:string;responded:boolean}>>("get_admin_review_communication_states",{p_ids:data.cases.map(item=>item.id)});
  data.cases=data.cases.map(item=>({...item,support_report_id:communication[item.id]?.report_id,communication_status:communication[item.id]?.status,reporter_responded:communication[item.id]?.responded}));
  const reportIds=[...new Set(data.cases.map(item=>item.support_report_id??item.platform_report_id).filter((id):id is string=>Boolean(id)))];
  const previews:Record<string,AdminReportPreview>={};
  for(let i=0;i<reportIds.length;i+=200)Object.assign(previews,await callPlatformAdminRpc<Record<string,AdminReportPreview>>('get_admin_report_previews',{p_report_ids:reportIds.slice(i,i+200)}));
  data.cases=data.cases.map(item=>({...item,support_preview:previews[item.support_report_id??item.platform_report_id??'']??null}));
  // Reuse signed URLs for repeated reports on the same post.
  const urls=new Map<string,Promise<string|null>>();
  data.cases=await Promise.all(data.cases.map(async item=>({...item,media:await Promise.all(item.media.map(async media=>{
    if(!["salon-profile-media","beauty-profile-media"].includes(media.bucket))return {...media,url:null};
    const key=`${media.bucket}:${media.path}`;
    if(!urls.has(key))urls.set(key,storage.from(media.bucket).createSignedUrl(media.path,3600).then(({data,error})=>error?null:data?.signedUrl??null));
    return {...media,url:await urls.get(key)};
  }))})));
  return data;
}

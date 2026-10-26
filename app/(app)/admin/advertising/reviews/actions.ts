"use server";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { PLATFORM_ADMIN_PERMISSIONS as P } from "@/types/platform-admin";
import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
export type CampaignAdminNotices={unread:number;items:{id:string;campaign_id:string;title:string;created_at:string;resolved_at:string|null;read_at:string|null}[]};
export async function campaignAdminNoticesAction(read?:string){
 await requirePlatformAdmin(P.advertisingReview);
 if(read&&!/^[0-9a-f-]{36}$/i.test(read))throw new Error("Reopen your ad notifications.");
 return callPlatformAdminRpc<CampaignAdminNotices>("admin_campaign_notices",{p_read:read??null});
}

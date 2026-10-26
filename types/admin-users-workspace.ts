import type { PlatformAdminUserDetail } from "@/lib/platform-admin/users";
import type { PlatformAdminNoteItem, PlatformAdminPermission } from "./platform-admin";

export type UserDrawerTab = "profile" | "access" | "security" | "activity";
export type UserAccessStore = {id:string;name:string;status:string;staff_linked:boolean;sources:Array<{membership_id:string;scope:'business'|'salon';entity_id:string;role:string;status:string;account_status:string;store_count:number}>};
export type UserRecoveryCase = {
  id: string; reference: string; category: string; summary: string; description: string;
  status: string; priority: string; assigned_membership_id: string | null; resolution: string | null;
  created_at: string; updated_at: string;
  context: { recovery_contact?: string; identity_verified?: boolean; contact_verified?: boolean; ownership_verified?: boolean;
    verification_evidence?: string; attachments?: Array<{path:string;name:string}> };
};
export type UserWorkspace = PlatformAdminUserDetail & {
  access_stores?:UserAccessStore[]|null;
  permissions: PlatformAdminPermission[]; ownAccount: boolean; identityReady: boolean;
  authentication: {email_confirmed_at:string|null; invited_at:string|null; last_sign_in_at:string|null; banned_until:string|null;
    factors:Array<{id:string;factor_type:string;status:string}>} | null;
  sessions:Array<{id:string;created_at:string;updated_at:string|null;user_agent?:string|null;device_label?:string}>;
  identity_jobs:Array<{id:string;operation:string;status:string;created_at:string}>;
  cases:UserRecoveryCase[]; assignees:Array<{id:string;name:string}>;
  notes:PlatformAdminNoteItem[]; activity:Array<{id:string;title:string;body:string|null;at:string;actor:string|null}>;
  deletion:{blocked:boolean;grace_days:number;salons:Array<{id:string;name:string;status:string;last_owner:boolean}>}|null;
  errors:string[];
};
export type UserOperationResult = {ok:boolean;message:string;userId?:string;caseId?:string;requestStatus?:string;
  results?:Array<{id:string;ok:boolean;message:string}>};

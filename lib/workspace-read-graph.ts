import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Account, AccountMembership } from "@/types/account";
import type { SalonMembership } from "@/types/salon-membership";
import type { Business } from "@/types/business";
import type { Role } from "@/types/role";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkspaceReadGraph = {
  version: 1;
  userId: string;
  bootstrapRequired: boolean;
  accountMemberships: AccountMembership[];
  salonMemberships: SalonMembership[];
  accounts: Account[];
  roles: Role[];
  locations: Business[];
  staff: {id:string;salon_id:string}[];
  profiles: {salon_id:string;public_profile_logo_path:string|null}[];
  grants: {role_id:string;code:string}[];
};
const graph = new AsyncLocalStorage<WorkspaceReadGraph | undefined>();
export const currentWorkspaceReadGraph = () => graph.getStore();
export function runWithWorkspaceReadGraph<T>(value: WorkspaceReadGraph | undefined, read: () => Promise<T>) {
  return graph.run(value, read);
}

/** Fresh SQL snapshot per context load. Never shared across requests or writes.
 * Only a missing migration falls back; denied/unavailable reads fail closed. */
export async function loadWorkspaceReadGraph(client: SupabaseClient, verifiedUserId: string | Promise<string | null>): Promise<WorkspaceReadGraph | null> {
  if (process.env.KINGPOS_WORKSPACE_DAL_RPC === "0") return null;
  const {data,error} = await client.rpc("read_my_workspace_graph_v1");
  // Transport may overlap authentication, but no rows or graph errors escape
  // before the original complete account/session validation has succeeded.
  const userId=await verifiedUserId;
  if(!userId)return null;
  if (error) {
    if (["PGRST202","42883"].includes(error.code)) return null;
    throw new Error("Workspace verification is temporarily unavailable.");
  }
  if (!data || data.version !== 1 || data.userId !== userId || typeof data.bootstrapRequired !== "boolean"
    || ["accountMemberships","salonMemberships","accounts","roles","locations","staff","profiles","grants"].some(key=>!Array.isArray(data[key]))) {
    throw new Error("Workspace verification returned an invalid identity.");
  }
  // New accounts keep the existing provisioning path; established reads do no writes.
  return data.bootstrapRequired ? null : data as WorkspaceReadGraph;
}

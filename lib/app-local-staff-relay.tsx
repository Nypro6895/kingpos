"use client";
import { StaffRelay } from "@/app/service-relay/staff-relay";
import { useAppLocalResource } from "./app-local-resource";
import type { RelayWorkspace } from "@/types/service-relay";
/** The real amount editor can restore its approved workspace before networking. */
export function AppLocalStaffRelay({scope,salonId,staffId}:{scope:string;salonId:string;staffId:string}){
  const resource=useAppLocalResource<RelayWorkspace>(scope,"staff.relay",{staffId});
  return <StaffRelay scope={scope} salonId={salonId} initialData={resource.data} managedRead refreshResource={resource.refresh}/>;
}

"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import type { BookingSetupData, StaffBookingReadiness } from "@/lib/booking-setup";
import { discoverySetupAction, salonSetupHref, staffSetupAction } from "@/lib/salon-setup-navigation";
import { getSalonOnlineBookingStatus } from "@/lib/booking-status";
import type { BookingSettings } from "@/types/booking";
import type { SalonDiscoveryReadiness } from "@/lib/salon-publication-readiness";

export type SetupPublication = {
 readiness: Pick<SalonDiscoveryReadiness,"items">;
 enabled: boolean;
 available: boolean | null;
 canManageStatus?: boolean;
};

export function StaffBookingGuide({salonId, readiness,permissions}: {salonId:string;readiness:StaffBookingReadiness;permissions?:{canManageAssignments?:boolean;canManageAvailability?:boolean;canManageStaff?:boolean;canManageBooking?:boolean;canManageOnline?:boolean}}) {
  const t=useWorkspaceTranslation();
  return <aside className="salon-setup-guide settings-page-persistent" aria-label={t("Online booking setup")}>
    <p><strong><WorkspaceText text={readiness.ready ? "Booking setup is complete for this staff member." : "More setup is needed before customers can book this staff member."}/></strong></p>
    {readiness.reasons.length ? <ul>{readiness.reasons.map(reason => {
      const action=staffSetupAction(reason.code,salonId,readiness.staffId);
      const allowed=reason.code==="no_assigned_services"?permissions?.canManageAssignments:reason.code==="no_working_hours"?permissions?.canManageAvailability:reason.code==="staff_inactive"?permissions?.canManageStaff:reason.code==="booking_disabled"?permissions?.canManageBooking:permissions?.canManageOnline;
      return <li key={reason.code}>{action&&allowed!==false?<a href={action.href}><WorkspaceText text={action.label}/> →</a>:<><WorkspaceText text={action?.label||reason.label}/>. <WorkspaceText text="Ask the salon owner to complete this step."/></>}</li>;
    })}</ul>:<p><WorkspaceText text="Available times depend on working hours, time off and existing appointments."/> <a href={`/book/${salonId}?staffId=${readiness.staffId}`}><WorkspaceText text="Preview booking"/> →</a></p>}
  </aside>;
}

export function BookingSetupGuide({salonId,setup,settings,publication}: {salonId:string;setup:BookingSetupData;settings:BookingSettings;publication?:SetupPublication}) {
 const t=useWorkspaceTranslation();
 const open=getSalonOnlineBookingStatus(settings).onlineBookingOpen;
 const hasServices=setup.services.some(s=>s.is_active&&s.online_booking_enabled&&!s.booking_parent_service_id);
 const staff=setup.staff.filter(s=>s.is_active&&s.online_booking_enabled);
 const ready=staff.filter(s=>setup.readinessByStaffId[s.id]?.ready);
 const staffTasks=staff.flatMap(s=>(setup.readinessByStaffId[s.id]?.reasons||[])
  .filter(reason=>reason.code!=="booking_disabled")
  .map(reason=>({staff:s,reason,action:staffSetupAction(reason.code,salonId,s.id)})));
 const nextStaffTask=staffTasks.find(task=>task.action);
 const bookingHref=salonSetupHref(salonId,"booking","booking-access");
 const teamHref=salonSetupHref(salonId,"staff-team");
 const serviceHref=salonSetupHref(salonId,"services");
 const canDo=(code:string)=>code==="no_assigned_services"?setup.permissions.canManageAssignments:code==="no_working_hours"?setup.permissions.canManageAvailability:setup.permissions.canManageStaff;
 const infoItems=publication?.readiness.items.filter(item=>!["active-service","salon-status"].includes(item.id))||[];
 const missingInfo=infoItems.find(item=>!item.complete);
 const statusIssue=publication?.readiness.items.find(item=>item.id==="salon-status"&&!item.complete);
 const steps=publication?[
  {label:"Salon information",done:infoItems.length>0&&!missingInfo,href:missingInfo?discoverySetupAction(missingInfo.id,salonId).href:salonSetupHref(salonId,"salon-profile"),allowed:true},
  {label:"Services & prices",done:hasServices,href:serviceHref,allowed:setup.permissions.canManageServices},
  {label:"Team",done:staff.length>0,href:teamHref,allowed:setup.permissions.canManageStaff},
  {label:"Hours & booking",done:open&&ready.length>0,href:nextStaffTask?.action?.href||bookingHref,allowed:nextStaffTask?canDo(nextStaffTask.reason.code):setup.permissions.canManageBooking},
  {label:"Go online",done:publication.enabled&&publication.available===true,href:statusIssue?discoverySetupAction(statusIssue.id,salonId).href:salonSetupHref(salonId,"public-profile","salon-visibility"),allowed:!statusIssue||publication.canManageStatus===true},
 ]:[];
 const nextStep=steps.find(step=>!step.done);
 return <aside className="salon-setup-guide settings-page-persistent" aria-label={t("Online booking setup")}>
  {publication?<><p><strong><WorkspaceText text="Your salon setup"/></strong></p>
   <p><WorkspaceText text="Completed steps"/>: {steps.filter(step=>step.done).length}/{steps.length}</p>
   <ol className="salon-setup-checklist">{steps.map((step,index)=><li key={step.label}>{step.allowed||step.done?<a href={step.href}>{index+1}. <WorkspaceText text={step.label}/></a>:<span>{index+1}. <WorkspaceText text={step.label}/></span>}<span><WorkspaceText text={step.done?"Done":"Needs attention"}/></span></li>)}</ol>
   {nextStep?<p>{nextStep.allowed?<a className="salon-setup-primary" href={nextStep.href}><WorkspaceText text="Continue setup"/>: <WorkspaceText text={nextStep.label}/> →</a>:<WorkspaceText text="Ask the salon owner to complete this step."/>}</p>:<p><WorkspaceText text="Your profile is public and booking is configured. Preview booking before sharing your link."/></p>}
  </>:null}
  <p><strong><WorkspaceText text={open&&ready.length ? "Review your online booking setup" : "Finish setting up online booking"}/></strong></p>
  <ul>
   {!hasServices?<li>{setup.permissions.canManageServices?<a href={serviceHref}><WorkspaceText text="Add a service customers can book online"/> →</a>:<WorkspaceText text="Ask the salon owner to add an online service."/>}</li>:null}
   {!staff.length?<li>{setup.permissions.canManageStaff?<a href={teamHref}><WorkspaceText text="Choose someone to accept online appointments"/> →</a>:<WorkspaceText text="Ask the salon owner to choose who accepts online appointments."/>}</li>:null}
   {staffTasks.map(({staff:s,reason,action})=><li key={`${s.id}-${reason.code}`}>{s.staff_profile_display_name||s.display_name}: {action&&canDo(reason.code)?<a href={action.href}><WorkspaceText text={action.label}/> →</a>:<WorkspaceText text="Ask the salon owner to complete this step."/>}</li>)}
   {!open?<li>{setup.permissions.canManageBooking?<a href={bookingHref}><WorkspaceText text="Open online booking for the salon"/> →</a>:<WorkspaceText text="Ask the salon owner to open online booking."/>}</li>:null}
  </ul>
  <p><WorkspaceText text="Opening hours describe when the salon is open. Each staff member also needs booking hours."/></p>
  {!publication?<p><a href={salonSetupHref(salonId,"public-profile")}><WorkspaceText text="Review your public salon profile"/> →</a></p>:null}
  {open&&ready.length?<p><WorkspaceText text="Setup is complete for at least one staff member. Preview booking to check available times before sharing your link."/> <a href={`/book/${salonId}`}><WorkspaceText text="Preview booking"/> →</a></p>:null}
 </aside>;
}

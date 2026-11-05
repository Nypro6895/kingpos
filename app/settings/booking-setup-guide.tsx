"use client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import type { BookingSetupData, StaffBookingReadiness } from "@/lib/booking-setup";
import { salonSetupHref, staffSetupAction } from "@/lib/salon-setup-navigation";
import { getSalonOnlineBookingStatus } from "@/lib/booking-status";
import type { BookingSettings } from "@/types/booking";

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

export function BookingSetupGuide({salonId,setup,settings}: {salonId:string;setup:BookingSetupData;settings:BookingSettings}) {
 const t=useWorkspaceTranslation();
 const open=getSalonOnlineBookingStatus(settings).onlineBookingOpen;
 const hasServices=setup.services.some(s=>s.is_active&&s.online_booking_enabled&&!s.booking_parent_service_id);
 const staff=setup.staff.filter(s=>s.is_active);
 const ready=staff.filter(s=>setup.readinessByStaffId[s.id]?.ready);
 return <aside className="salon-setup-guide settings-page-persistent" aria-label={t("Online booking setup")}>
  <p><strong><WorkspaceText text={open&&ready.length ? "Review your online booking setup" : "Finish setting up online booking"}/></strong></p>
  <ul>
   {!hasServices?<li><a href={salonSetupHref(salonId,"services")}><WorkspaceText text="Add a service customers can book online"/> →</a></li>:null}
   {!staff.length?<li><a href={salonSetupHref(salonId,"staff-team")}><WorkspaceText text="Add someone to take appointments"/> →</a></li>:null}
   {staff.filter(s=>!setup.readinessByStaffId[s.id]?.ready).map(s=><li key={s.id}><a href={salonSetupHref(salonId,"booking","booking-hours",s.id)}>{s.staff_profile_display_name||s.display_name}: <WorkspaceText text="Review services and booking hours"/> →</a></li>)}
   {!open?<li><WorkspaceText text="To accept online appointments, turn on Enable booking, Show online booking and Allow guest booking below, then save."/></li>:null}
  </ul>
  <p><WorkspaceText text="Opening hours describe when the salon is open. Each staff member also needs booking hours."/></p>
  <p><a href={salonSetupHref(salonId,"public-profile")}><WorkspaceText text="Review your public salon profile"/> →</a></p>
  {open&&ready.length?<p><WorkspaceText text="Setup is complete for at least one staff member. Preview booking to check available times before sharing your link."/> <a href={`/book/${salonId}`}><WorkspaceText text="Preview booking"/> →</a></p>:null}
 </aside>;
}

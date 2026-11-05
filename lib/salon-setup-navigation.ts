export type SalonSetupDestination = "salon-profile" | "services" | "staff-team" | "booking" | "public-profile" | "close-salon";

export function salonSetupHref(salonId: string, section: SalonSetupDestination, child = "", staffId = "") {
  const params = new URLSearchParams({ section: `salon-${salonId}-${section}` });
  if (staffId) params.set("staffId", staffId);
  return `/settings?${params}${child ? `#${encodeURIComponent(child)}` : ""}`;
}

export function staffSetupAction(code: string, salonId: string, staffId: string) {
  switch (code) {
    case "no_assigned_services": return { label: "Choose services for this staff member", href: salonSetupHref(salonId, "booking", `staff-services-${staffId}`, staffId) };
    case "no_working_hours": return { label: "Add booking hours for this staff member", href: salonSetupHref(salonId, "booking", "booking-hours", staffId) };
    case "staff_inactive": return { label: "Make this staff member active", href: salonSetupHref(salonId, "staff-team", `staff-${staffId}`) };
    case "online_booking_disabled": return { label: "Allow online bookings for this staff member", href: salonSetupHref(salonId, "booking", "booking-hours", staffId) };
    case "booking_disabled": return { label: "Open online booking for the salon", href: salonSetupHref(salonId, "booking") };
    default: return null;
  }
}

export function discoverySetupAction(id: string, salonId: string) {
  const labels: Record<string,string> = {
    "salon-status":"Review salon status", "business-name":"Add salon name",
    phone:"Add salon phone", address:"Add street address", city:"Add city",
    state:"Add state", "postal-code":"Add ZIP code", description:"Add a salon description",
    "active-service":"Add a service",
  };
  return {label:labels[id]||"Review your public salon profile",href:salonSetupHref(salonId,id==="active-service"?"services":id==="salon-status"?"close-salon":"salon-profile",id==="salon-status"||id==="active-service"?"":"salon-information")};
}

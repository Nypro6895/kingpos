import type { CurrentWorkspaceOption } from "@/lib/current-context";

export function placeWorkspaceHref(workspaceId: string, destination: string) {
  return `/workspace/open?${new URLSearchParams({ workspace_id: workspaceId, destination })}`;
}

export function placeShortcuts(workspace: CurrentWorkspaceOption) {
  const actions = [...workspace.quickActions, ...workspace.menuActions];
  const has = (id: string) => actions.some((a) => a.id === id);
  const links: { label: string; destination: string }[] = [];
  if (workspace.salonMode === "staff") {
    if (has("today"))
      links.push({
        label: "My profile",
        destination: "/staff/my-work?profile=1",
      });
    if (has("schedule"))
      links.push({
        label: "My appointments",
        destination: "/staff/appointments",
      });
    if (has("payroll"))
      links.push({
        label: "My payroll",
        destination: "/staff/my-work?tab=payroll",
      });
  } else {
    if (has("salon-settings"))
      links.push({
        label: "Working hours",
        destination: "/salon-settings#operating-hours",
      });
    if (has("book"))
      links.push({
        label: "Booking settings",
        destination: "/bookings?tab=settings",
      });
    if (has("profile"))
      links.push({ label: "Salon profile", destination: "/salon-profile" });
    if (has("salon-settings"))
      links.push({
        label: "Business settings",
        destination: "/salon-settings",
      });
    if (has("services"))
      links.push({ label: "Services", destination: "/services" });
    if (has("staff")) links.push({ label: "Team", destination: "/staff" });
    if (has("pos"))
      links.push({ label: "POS settings", destination: "/pos/settings" });
  }
  return links.map((link) => ({
    ...link,
    href: placeWorkspaceHref(workspace.id, link.destination),
  }));
}

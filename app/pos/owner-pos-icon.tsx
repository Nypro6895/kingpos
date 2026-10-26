
import type { ReactNode } from "react";
import type { NavigationIcon } from "@/app/role-navigation";
import { WorkspaceNavigationIcon } from "@/components/workspace-navigation-icon";

export type OwnerPosIconName = "more" | "checkin" | "pos" | "ticket" | "report" | "booking" | "settings" | "services" | "employees" | "tip" | "discount" | "backspace";
const navigationIcons: Partial<Record<OwnerPosIconName, NavigationIcon>> = {
  more: "more", checkin: "check", pos: "store", ticket: "receipt", report: "list", booking: "book", settings: "gear", employees: "people",
};

export function OwnerPosIcon({ name }: { name: OwnerPosIconName }) {
  const navigationIcon = navigationIcons[name];
  if (navigationIcon) return <WorkspaceNavigationIcon name={navigationIcon} className="owner-icon" />;
  const paths: Partial<Record<OwnerPosIconName, ReactNode>> = {
    services: <><circle cx="6" cy="18" r="3" /><circle cx="18" cy="18" r="3" /><path d="m8 16 11-13M16 16 5 3" /></>,
    tip: <><circle cx="16" cy="5" r="3" /><path d="m3 16 4-4a3 3 0 0 1 2-1h4a2 2 0 0 1 0 4h-3m3 0 5-3a2 2 0 0 1 3 2l-7 6H7l-3 2M2 15l5 5" /></>,
    discount: <><circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><path d="M4 20 20 4" /></>,
    backspace: <><path d="M9 4h12v16H9l-7-8 7-8Z" /><path d="m11 9 6 6m0-6-6 6" /></>,
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

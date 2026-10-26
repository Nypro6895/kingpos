import type { ComponentProps } from "react";
import type { NavigationShell } from "@/app/navigation-shell";
import type { OwnerCampaignRuntime } from "@/components/owner-campaign-runtime";
import type { CustomerNotificationSummary } from "@/app/customer-shell-context";

export type AppLocalShellNavigation = {
  scope: string;
  authenticated: boolean;
  navigation: Omit<ComponentProps<typeof NavigationShell>, "children"> | null;
  ownerQueueScope: string | null;
  audience: "guest" | "personal" | "staff" | "owner";
};
export type AppLocalShellConfiguration = {
  scope: string;
  language: { enabled: boolean; portableEnabled: boolean; expiresAt: string | null };
  campaign: { installed: boolean; runtime: ComponentProps<typeof OwnerCampaignRuntime> | null };
};
export type AppLocalShellSummary = { scope: string; notificationScope: string; summary: CustomerNotificationSummary };
export type AppLocalShellNotice = { scope: string; mode: string | null };
export const APP_LOCAL_SHELL_READS = [
  { name: "shell.navigation", argumentKeys: [], retain: true },
  { name: "shell.configuration", argumentKeys: [], retain: true },
  { name: "shell.summary", argumentKeys: [], retain: true },
  { name: "shell.notice", argumentKeys: [], retain: true },
  { name: "http.shell.session", argumentKeys: [], retain: false },
  { name: "http.shell.quick-booking", argumentKeys: ["salonId", "inspiration", "lookId", "serviceId", "staffId", "date", "startAt", "source"], retain: false },
  { name: "http.shell.campaigns", argumentKeys: ["location", "latitude", "longitude", "batch", "query"], retain: false },
  { name: "http.shell.advertising", argumentKeys: ["path", "device"], retain: false },
] as const;
export const APP_LOCAL_SHELL_COMMANDS = [
  { name: "shell.switch-workspace", argumentKeys: ["workspaceId", "destination"] },
  { name: "shell.logout", argumentKeys: [] },
  { name: "http.shell.campaign-event", argumentKeys: ["input"] },
  { name: "http.shell.advertising-event", argumentKeys: ["input"] },
] as const;

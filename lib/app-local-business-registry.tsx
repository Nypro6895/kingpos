"use client";

import { type ReactNode } from "react";
import { SalonProfileView } from "@/app/salon-profile/salon-profile-view";
import { AppLocalSalonSettings } from "@/components/app-local-salon-settings";
import { AppLocalPosSettings } from "@/components/app-local-pos-settings";
import { AppLocalSalons } from "@/components/app-local-salons";
import { useAppLocalResource } from "./app-local-resource";
import { getAppLocalHost } from "./app-local-host";
import type { AppLocalPage, AppLocalPageProps } from "./app-local-page-registry";
import type { AppLocalSalonProfileData, AppLocalSalonSettingsData, AppLocalPosSettingsData, AppLocalSalonsData } from "./app-local-business-metadata";

function View<T>({ name, title, children, ...props }: AppLocalPageProps & { name: string; title: string; children: (data: T) => ReactNode }) {
  const scope = props.context?.context.authenticated ? props.context.context.scope : undefined;
  const resource = useAppLocalResource<T>(scope, name, {}, { enabled: Boolean(scope) });
  if (!scope) return <main className="mx-auto max-w-5xl p-6"><h1 className="text-2xl font-semibold">{title}</h1><p>Sign in to view your salon.</p><button type="button" onClick={() => void (props.host ?? getAppLocalHost()).openOnline(`/login?next=${encodeURIComponent(props.path)}`)}>Sign in</button></main>;
  if (resource.data) return children(resource.data);
  return <main className="mx-auto grid max-w-5xl gap-4 p-6"><h1 className="text-2xl font-semibold">{title}</h1>{resource.error ? <div role="alert"><p>{resource.error}</p><button type="button" onClick={() => void resource.refresh()}>Try again</button></div> : <p role="status">Opening…</p>}</main>;
}
const urlFor = (path: string) => new URL(path, "https://reylumi.com");
function ProfilePage(props: AppLocalPageProps) {
  const query = urlFor(props.path).searchParams;
  return <View<AppLocalSalonProfileData> {...props} name="owner.salon-profile" title="Salon Profile">{data => <main><SalonProfileView {...data} key={props.context?.context.scope} error={query.get("error") ?? undefined} notice={query.get("notice") ?? undefined} /></main>}</View>;
}
function SettingsPage(props: AppLocalPageProps) {
  const query = urlFor(props.path).searchParams;
  return <View<AppLocalSalonSettingsData> {...props} name="owner.salon-settings" title="Salon settings">{data => <AppLocalSalonSettings data={data} key={props.context?.context.scope} error={query.get("error") ?? undefined} lifecycleError={query.get("lifecycle_error") ?? undefined} notice={query.get("notice") ?? undefined} operatingNotice={query.get("operating_notice") ?? undefined} />}</View>;
}
function PosSettingsPage(props: AppLocalPageProps) {
  const query = urlFor(props.path).searchParams;
  return <View<AppLocalPosSettingsData> {...props} name="owner.pos-settings" title="POS settings">{data => <AppLocalPosSettings data={data} key={props.context?.context.scope} error={query.get("error") ?? undefined} saved={query.get("saved") ?? undefined} />}</View>;
}
function SalonsPage(props: AppLocalPageProps) {
  const url = urlFor(props.path), mode = url.pathname.endsWith("/new") ? "create" : "list";
  return <View<AppLocalSalonsData> {...props} name="customer.salons" title={mode === "create" ? "Create Salon" : "Your Salons"}>{data => <AppLocalSalons key={`${props.context?.context.scope}:${mode}`} scope={props.context!.context.scope} data={data} mode={mode} query={Object.fromEntries(url.searchParams)} />}</View>;
}
const pages: Record<string, AppLocalPage> = {
  profile: { id: "salon.profile.manage", title: "Salon Profile", requiresContext: true, Component: ProfilePage, features: ["original-profile-view", "feed", "looks", "publication", "original-confirmations"] },
  settings: { id: "salon.settings", title: "Salon settings", requiresContext: true, Component: SettingsPage, features: ["complete-business-information", "hours", "public-team", "original-ownership", "original-lifecycle"] },
  pos: { id: "pos.settings", title: "POS settings", requiresContext: true, Component: PosSettingsPage, features: ["complete-settings-groups", "original-conflict-checks", "devices", "customer-display-setup", "original-access-controls"] },
  salons: { id: "salons", title: "Your Salons", requiresContext: true, Component: SalonsPage, features: ["complete-original-list", "original-selection", "original-create-form", "original-duplicate-check"] },
};
export function getAppLocalBusinessPage(path: string): AppLocalPage | null {
  try {
    if (!path.startsWith("/") || path.startsWith("//") || /\\|%2f|%5c|%00/i.test(path) || path.length > 4096) return null;
    const url = urlFor(path), pathname = url.pathname.replace(/\/$/, "");
    if ([...url.searchParams].some(([key, value]) => /^(?:token|access_token|refresh_token|code|secret|signature|session|password|payment|checkout|client_secret|next|return_to)$/i.test(key) || value.length > 512)) return null;
    if (pathname === "/salon-profile") return pages.profile;
    if (pathname === "/salon-settings") return pages.settings;
    if (pathname === "/pos/settings") return pages.pos;
    if (["/salons", "/businesses", "/salons/new", "/businesses/new"].includes(pathname)) return pages.salons;
    return null;
  } catch { return null; }
}

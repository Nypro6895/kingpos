"use client";

import { CustomerDisplayClient } from "@/app/pos/customer-display/customer-display-client";
import { getAppLocalHost } from "./app-local-host";
import { useAppLocalResource } from "./app-local-resource";
import { isExperienceOfflineGrant } from "./experience-offline-policy";
import { APP_LOCAL_DISPLAY_DEFAULTS, type AppLocalDisplayContext, type AppLocalDisplayData, type AppLocalDisplaySettingsData } from "./app-local-display-metadata";
import type { AppLocalPortableWorkspaceData } from "./app-local-portable-metadata";
import type { AppLocalPage, AppLocalPageProps } from "./app-local-page-registry";

function SetupPage(props: AppLocalPageProps) {
  return <main className="grid min-h-screen place-items-center bg-zinc-100 px-4 py-8 text-zinc-950"><div className="grid w-full max-w-md justify-items-center gap-6">
    {/* The PIN form stays on its original HTTPS authority and never enters the local URL. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img alt="Reylumi" className="h-auto w-44 object-contain" height={419} src="/brand/reylumi-logo-horizontal.png" width={1527} />
    <p>Pair this display with your POS ID and passcode.</p>
    <button type="button" className="rounded-xl bg-zinc-950 px-6 py-3 font-semibold text-white" onClick={() => void (props.host ?? getAppLocalHost()).openOnline("/pos/customer-display/setup")}>Pair Display</button>
  </div></main>;
}

function DisplayPage(props: AppLocalPageProps) {
  const context = props.context as AppLocalDisplayContext | null, scope = context?.context.scope;
  const owner = context?.displayAuthority?.kind === "owner" && context.context.authenticated;
  const portable = context?.displayAuthority?.kind === "portable" && "portable" in context && context.portable.scope === scope
    && context.portable.capabilities.includes("portable.pos.use") && context.grant?.kind === "portable" && isExperienceOfflineGrant(context.grant, { scope });
  const ownerData = useAppLocalResource<AppLocalDisplayData>(owner ? scope : undefined, "owner.customer-display", {}, { enabled: Boolean(owner) });
  const workspace = useAppLocalResource<AppLocalPortableWorkspaceData>(portable ? scope : undefined, "portable.workspace", {}, { enabled: Boolean(portable) });
  const deviceSettings = useAppLocalResource<AppLocalDisplaySettingsData>(portable ? scope : undefined, "portable.customer-display-settings", {}, { enabled: Boolean(portable) });
  const matchedDevice = portable && workspace.data?.liveDraft?.id === deviceSettings.data?.draftId && workspace.data?.salonId === context?.context.salonId
    && workspace.data?.liveDraft?.salon_id === context.context.salonId && /^[a-f0-9]{32}$/i.test(workspace.data?.liveDraft?.token ?? "");
  const data = owner ? ownerData.data : matchedDevice && workspace.data?.liveDraft?.token && deviceSettings.data ? { ...deviceSettings.data, token: workspace.data.liveDraft.token, initialSnapshot: workspace.data.liveDraft } : undefined;
  const pending = Boolean((owner || portable) && !data), error = owner ? ownerData.error : workspace.error ?? deviceSettings.error;
  return <div className="h-full" data-local-customer-display data-display-authority={owner ? "owner" : portable ? "portable" : "public"}>
    {/* The public attract frame paints immediately; it cannot accept a phone draft before the authorized frame is ready. */}
    <div inert={pending || undefined} aria-busy={pending || undefined} data-display-opening={pending ? "true" : undefined}>
      <CustomerDisplayClient key={`${scope ?? "public"}:${data?.token ?? "public"}`} {...(data ?? { settings: APP_LOCAL_DISPLAY_DEFAULTS, serviceCatalog: [], token: "" })} />
    </div>
    {pending && error ? <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-white p-4 shadow-lg" role="alert"><p>{error}</p><button type="button" className="mt-2 rounded border px-4 py-2" onClick={() => { void ownerData.refresh(); void workspace.refresh(); void deviceSettings.refresh(); }}>Try again</button></div> : null}
  </div>;
}

const display: AppLocalPage = { id: "customer-display", title: "Customer Display", requiresContext: true, Component: DisplayPage, features: ["original-complete-display", "owner-or-original-paired-device-authority", "original-phone-tip-service-and-receipt-actions", "public-token-links-stay-https"] };
const setup: AppLocalPage = { id: "customer-display.setup", title: "Pair Display", requiresContext: false, Component: SetupPage, features: ["original-branding", "explicit-https-pin-pairing-authority"] };
export function getAppLocalDisplayPage(path: string): AppLocalPage | null {
  try {
    if (!path.startsWith("/") || path.startsWith("//") || /\\|%2f|%5c|%00/i.test(path) || path.length > 4096) return null;
    const url = new URL(path, "https://reylumi.com");
    // Public token links and pairing credentials always use the original HTTPS page.
    if (url.search || url.hash) return null;
    return url.pathname === "/pos/customer-display" ? display : url.pathname === "/pos/customer-display/setup" ? setup : null;
  } catch { return null; }
}

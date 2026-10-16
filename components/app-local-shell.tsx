"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { NavigationShell } from "@/app/navigation-shell";
import { GuestNavigationShell } from "@/app/guest-navigation-shell";
import { ActionDialog } from "@/app/action-dialog";
import { WorkspaceLanguageProvider } from "./workspace-language";
import { CampaignPluginProvider } from "./campaign-plugin-context";
import { ExploreAccountActionsProvider } from "./explore-account-actions";
import { ExploreAdvertising } from "./explore-advertising";
import { QuickBooking } from "./quick-booking";
import { AppLocalSessionExpiryPrompt } from "./app-local-session-expiry-prompt";
import { OverlayDismissal } from "./overlay-dismissal";
import { OwnerCampaignRuntime } from "./owner-campaign-runtime";
import { OwnerQueueRuntime } from "@/app/pos/owner-queue-runtime";
import { AbuseNoticeView } from "./abuse-notice-view";
import { WorkspaceSummarySeed } from "@/app/notifications/workspace-summary-seed";
import { useAppLocalResource } from "@/lib/app-local-resource";
import type { AppLocalContext } from "@/lib/app-local-host";
import type { AppLocalShellNavigation, AppLocalShellConfiguration, AppLocalShellSummary, AppLocalShellNotice } from "@/lib/app-local-shell-metadata";

/** One shell around the retained page registry, never a shell per hidden page. */
export function AppLocalShell({ context, presentationContext, children, path }: { context: AppLocalContext | null; presentationContext?: AppLocalContext | null; children: ReactNode; path?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const route = (path ?? pathname).split("?")[0];
  const presentationOnly = !context && /^\/help(?:\/|$)/.test(route) && Boolean(presentationContext?.context.authenticated);
  const scope = context?.context.scope ?? (presentationOnly ? presentationContext?.context.scope : undefined);
  const deviceContext = context?.grant?.kind === "portable" || route === "/pos/portable" || route.startsWith("/pos/portable/");
  const publicInitial = !context && /^\/(?:help(?:\/|$)|legal$|privacy$|terms$|community$|business-terms$)/.test(route);
  const accountEnabled = !publicInitial && !deviceContext;
  const navigation = useAppLocalResource<AppLocalShellNavigation>(scope, "shell.navigation", {}, { enabled: accountEnabled });
  const configuration = useAppLocalResource<AppLocalShellConfiguration>(scope, "shell.configuration", {}, { enabled: accountEnabled, refreshAfterMs: 60_000 });
  const pending = useAppLocalResource<AppLocalShellSummary>(scope, "shell.summary", {}, { enabled: accountEnabled && Boolean(context?.context.authenticated), refreshAfterMs: 60_000 });
  const notice = useAppLocalResource<AppLocalShellNotice>(scope, "shell.notice", {}, { enabled: accountEnabled });
  const menu = navigation.data?.scope === scope ? navigation.data : undefined;
  const config = configuration.data?.scope === scope ? configuration.data : undefined;
  const pendingSummary = pending.data && pending.data.scope === scope ? pending.data : undefined;
  const [error, setError] = useState("");
  const [bodyHost] = useState(() => typeof document === "undefined" ? null : document.createElement("div"));
  const attachBody = useCallback((slot: HTMLDivElement | null) => { if (slot && bodyHost && bodyHost.parentNode !== slot) slot.appendChild(bodyHost); }, [bodyHost]);
  useEffect(() => {
    const failed = (event: Event) => setError(String((event as CustomEvent<string>).detail || "Please try again."));
    window.addEventListener("reylumi:app-local-workspace-error", failed);
    return () => window.removeEventListener("reylumi:app-local-workspace-error", failed);
  }, []);
  // The portal's container and React position never change when the original
  // chrome chooses a different route layout or a held menu read completes.
  const body = <div data-app-local-content-slot="true" ref={attachBody} />;
  // Device PIN authority is not an account session or an expired guest. Its own
  // portable view provides its language, lease, lock and queue runtimes.
  if (deviceContext) return <><GuestNavigationShell authenticated={false}>{body}</GuestNavigationShell>{bodyHost ? createPortal(children, bodyHost) : children}</>;
  return <WorkspaceLanguageProvider scope={scope ?? ""} enabled={config?.language.enabled ?? false} portableEnabled={config?.language.portableEnabled ?? false} expiresAt={config?.language.expiresAt ?? null}>
    <CampaignPluginProvider scope={scope ?? ""} installed={config?.campaign.installed ?? false}>
      <OverlayDismissal />
      <AppLocalSessionExpiryPrompt authenticated={context ? context.context.authenticated : null} scope={scope} enabled={!publicInitial} />
      {!publicInitial && menu ? <OwnerQueueRuntime scope={menu.ownerQueueScope} /> : null}
      {!publicInitial && menu && pendingSummary ? <WorkspaceSummarySeed scope={pendingSummary.notificationScope} summary={pendingSummary.summary} /> : null}
      {notice.data?.scope === scope ? <AbuseNoticeView mode={notice.data?.mode ?? null} /> : null}
      {!publicInitial && config?.campaign.runtime ? <OwnerCampaignRuntime {...config.campaign.runtime} /> : null}
      <ExploreAccountActionsProvider authenticated={context?.context.authenticated ?? false}>
        <ExploreAdvertising audience={menu?.audience ?? "guest"} enabled={!publicInitial}>
          <div className="contents" onClickCapture={event => {
            if (!presentationOnly || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element) || bodyHost?.contains(event.target)) return;
            const control = event.target.closest("button,summary,input[type=submit]");
            if (!control || control.hasAttribute("data-more-menu-target")) return;
            const notification = control.closest("details")?.querySelector("summary[data-app-notification-trigger]");
            const account = control.matches('[aria-controls="customer-context-sheet"],[aria-controls="customer-desktop-account-menu"],[data-testid="customer-desktop-account-trigger"]')
              || control.closest("#customer-context-sheet,#customer-desktop-account-menu");
            if (!notification && !account) return;
            event.preventDefault(); event.stopPropagation();
            router.push(notification ? "/notifications" : "/my-place");
          }} onSubmitCapture={event => {
            if (!presentationOnly || !(event.target instanceof HTMLFormElement) || bodyHost?.contains(event.target)
              || event.target.method.toLowerCase() === "get" || !event.target.closest("#customer-context-sheet,#customer-desktop-account-menu")) return;
            event.preventDefault(); event.stopPropagation(); router.push("/my-place");
          }}>
            {menu?.navigation ? <NavigationShell {...menu.navigation} passive={presentationOnly}>{body}</NavigationShell> : <GuestNavigationShell authenticated={context?.context.authenticated ?? false}>{body}</GuestNavigationShell>}
          </div>
          {bodyHost ? createPortal(children, bodyHost) : children}
        </ExploreAdvertising>
        {!publicInitial ? <QuickBooking /> : null}
      </ExploreAccountActionsProvider>
      <ActionDialog open={Boolean(error)} title="Workspace action needed" description={error} onClose={() => setError("")} primaryAction={{ label: "Try again", onClick: () => setError("") }} />
    </CampaignPluginProvider>
  </WorkspaceLanguageProvider>;
}

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
import type { AppLocalShellNavigation, AppLocalShellConfiguration, AppLocalShellSummary, AppLocalShellNotice, AppLocalShellAuxiliary } from "@/lib/app-local-shell-metadata";

/** One shell around the retained page registry, never a shell per hidden page. */
export function AppLocalShell({ context, presentationContext, children, path, checkContext, onContinueAsGuest, guestContinuation = 0 }: { context: AppLocalContext | null; presentationContext?: AppLocalContext | null; children: ReactNode; path?: string; checkContext?: () => Promise<void>; onContinueAsGuest?: () => void; guestContinuation?: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const route = (path ?? pathname).split("?")[0];
  const presentationOnly = !context && /^\/help(?:\/|$)/.test(route) && Boolean(presentationContext?.context.authenticated);
  const scope = context?.context.scope ?? (presentationOnly ? presentationContext?.context.scope : undefined);
  const deviceContext = context?.grant?.kind === "portable" || route === "/pos/portable" || route.startsWith("/pos/portable/");
  const publicInitial = !context && /^\/(?:help(?:\/|$)|legal$|privacy$|terms$|community$|business-terms$)/.test(route);
  const neutralHelp = publicInitial && /^\/help(?:\/|$)/.test(route);
  // A public Help page has no private authority. Expiry of decorative Staff
  // chrome is not a confirmed logout; return through the ordinary home gate.
  const helpReturn = neutralHelp ? <button type="button" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-white px-4 text-sm font-semibold text-text-primary" onClick={() => router.push("/")}>{new URLSearchParams((path ?? pathname).split("?")[1] ?? "").get("lang") === "en" ? "Back to app" : "Quay lại ứng dụng"}</button> : undefined;
  const accountEnabled = !publicInitial && !deviceContext;
  const navigation = useAppLocalResource<AppLocalShellNavigation>(scope, "shell.navigation", {}, { enabled: accountEnabled });
  const auxiliary = useAppLocalResource<AppLocalShellAuxiliary>(scope, "shell.auxiliary", {}, { enabled: accountEnabled, refreshAfterMs: 60_000 });
  const bundle = auxiliary.data?.scope === scope ? auxiliary.data : undefined;
  const fallback = accountEnabled && !auxiliary.accessDenied && Boolean(auxiliary.error);
  const configuration = useAppLocalResource<AppLocalShellConfiguration>(scope, "shell.configuration", {}, { enabled: fallback || accountEnabled && Boolean(bundle && "unavailable" in bundle.configuration), refreshAfterMs: 60_000 });
  const pending = useAppLocalResource<AppLocalShellSummary>(scope, "shell.summary", {}, { enabled: Boolean(context?.context.authenticated) && (fallback || accountEnabled && Boolean(bundle && "unavailable" in bundle.summary)), refreshAfterMs: 60_000 });
  const notice = useAppLocalResource<AppLocalShellNotice>(scope, "shell.notice", {}, { enabled: fallback || accountEnabled && Boolean(bundle && "unavailable" in bundle.notice) });
  const menu = navigation.data?.scope === scope ? navigation.data : undefined;
  const configData = bundle && "data" in bundle.configuration ? bundle.configuration.data : configuration.data;
  const summaryData = bundle && "data" in bundle.summary ? bundle.summary.data : pending.data;
  const noticeData = bundle && "data" in bundle.notice ? bundle.notice.data : notice.data;
  const config = configData?.scope === scope ? configData : undefined;
  const pendingSummary = summaryData?.scope === scope ? summaryData : undefined;
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
      <AppLocalSessionExpiryPrompt key={guestContinuation} authenticated={context ? context.context.authenticated : null} scope={scope} enabled={!publicInitial} checkContext={checkContext} onContinueAsGuest={onContinueAsGuest} />
      {!publicInitial && menu ? <OwnerQueueRuntime scope={menu.ownerQueueScope} /> : null}
      {!publicInitial && menu && pendingSummary ? <WorkspaceSummarySeed scope={pendingSummary.notificationScope} summary={pendingSummary.summary} /> : null}
      {noticeData?.scope === scope ? <AbuseNoticeView mode={noticeData?.mode ?? null} /> : null}
      {!publicInitial && config?.campaign.runtime ? <OwnerCampaignRuntime {...config.campaign.runtime} /> : null}
      <ExploreAccountActionsProvider authenticated={context?.context.authenticated ?? false}>
        <ExploreAdvertising audience={menu?.audience ?? "guest"} enabled={!publicInitial}>
          <div className="contents" onClickCapture={event => {
            if (!presentationOnly || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element) || bodyHost?.contains(event.target)) return;
            const control = event.target.closest("button,summary,input[type=submit]");
            if (!control || control.hasAttribute("data-more-menu-target")) return;
            // Closing a retained drawer is only a local UI action. It must
            // not become account navigation while Help has display-only chrome.
            if (control.matches('button[type="button"][data-app-local-dismiss="account-switcher"]')
              && control.closest("#customer-context-sheet")) return;
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
            {menu?.navigation ? <NavigationShell {...menu.navigation} passive={presentationOnly}>{body}</NavigationShell> : <GuestNavigationShell authenticated={context ? context.context.authenticated : neutralHelp ? null : publicInitial ? false : null} accountFallback={helpReturn}>{body}</GuestNavigationShell>}
          </div>
          {bodyHost ? createPortal(children, bodyHost) : children}
        </ExploreAdvertising>
        {!publicInitial ? <QuickBooking /> : null}
      </ExploreAccountActionsProvider>
      <ActionDialog open={Boolean(error)} title="Workspace action needed" description={error} onClose={() => setError("")} primaryAction={{ label: "Try again", onClick: () => { setError(""); window.dispatchEvent(new Event("reylumi:app-local-workspace-retry")); } }} />
    </CampaignPluginProvider>
  </WorkspaceLanguageProvider>;
}

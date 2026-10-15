import { CampaignPluginConfiguration, CampaignPluginProvider } from "@/components/campaign-plugin-context";
import { campaignWalletAction } from "@/app/campaigns/credit-actions";
import { AbuseNotice } from "@/components/abuse-notice";
import { OverlayDismissal } from "@/components/overlay-dismissal";
import { WindowsPosDownloadPrompt } from "@/components/windows-pos-download";
import { SalonSwitcher } from "@/app/salon-switcher";
import { getRequestBusinessContext as getCurrentBusinessContext } from "@/lib/request-business-context";
import { isSalonManageContext } from "@/lib/current-context";
import { OwnerCampaignRuntime } from "@/components/owner-campaign-runtime";
import { ownerCampaignSettings } from "@/lib/owner-campaigns";
import { isOwnerMembership, type CurrentBusinessContext } from "@/lib/current-context";
import { OwnerQueueRuntime } from "@/app/pos/owner-queue-runtime";
import { QuickBooking } from "@/components/quick-booking";
import { SessionExpiryPrompt } from "@/components/session-expiry-prompt";
import { ExploreAdvertising } from "@/components/explore-advertising";
import { ExploreAccountActionsProvider } from "@/components/explore-account-actions";
import { WorkspaceLanguageProvider } from "@/components/workspace-language";
import { vietnamesePluginState } from "@/lib/vietnamese-plugin";
import { ExperienceCacheLifecycle } from "@/components/experience-cache-lifecycle";
import { ExperienceNavigation } from "@/components/experience-navigation";
import { Suspense } from "react";
import { getExperienceContext } from "@/lib/experience-context";
import { ExperienceScopeProvider } from "@/components/experience-scope";
import { runReadWithDeadline } from "@/lib/bounded-get";
import { StartupReady } from "@/components/startup-ready";
import type { CampaignWallet } from "@/types/owner-campaign";

export { metadata } from "../layout";

async function OptionalCampaignRuntime({ context, wallet }: { context: CurrentBusinessContext; wallet: CampaignWallet }) {
  const settings = await runReadWithDeadline(ownerCampaignSettings(), 12_000).catch(() => null);
  if (!settings || !context.currentSalon || !context.user) return null;
  return <OwnerCampaignRuntime availableCredits={wallet.available_credits} key={`${context.currentSalon.id}:${context.user.id}`} scope={`${context.currentSalon.id}:${context.user.id}`} settings={settings} location={{ city: context.currentSalon.city ?? "", state: context.currentSalon.state ?? "", country: context.currentSalon.country }} />;
}

async function OptionalCampaignWallet({ context, scope }: { context: CurrentBusinessContext; scope: string }) {
  const wallet = await runReadWithDeadline(campaignWalletAction(), 12_000).catch(() => null);
  return <>
    <CampaignPluginConfiguration scope={scope} installed={wallet?.installed ?? false} />
    {wallet?.installed ? <Suspense fallback={null}><OptionalCampaignRuntime context={context} wallet={wallet} /></Suspense> : null}
  </>;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const context = await getCurrentBusinessContext();
  const experience = getExperienceContext(context);
  const languageSalonId = context.workspaceType === "salon" ? (context.salonMode === "staff" ? context.currentStaffSalon?.id : context.currentSalon?.id) : null;
  const isOwner = isSalonManageContext(context) && isOwnerMembership(context.currentMembership);
  const languagePlugin = await runReadWithDeadline(vietnamesePluginState(languageSalonId ?? null).catch(() => null), 8_000);
  const languageEnabled = Boolean(languagePlugin?.active && (context.salonMode === "manage" || (context.salonMode === "staff" && languagePlugin.staff_enabled)));
  const languageExpiry = languagePlugin ? [languagePlugin.trial_ends_at, languagePlugin.paid_until].filter((value): value is string => Boolean(value)).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null : null;

  return (
    <ExperienceScopeProvider key={experience.scope} context={experience}>
        <ExperienceCacheLifecycle scope={experience.scope} viewerId={experience.viewerId} workspace={experience.workspaceId} permissionRevision={experience.permissionRevision} />
        <Suspense fallback={null}><ExperienceNavigation scope={experience.scope} /></Suspense>
        <WorkspaceLanguageProvider enabled={languageEnabled} portableEnabled={Boolean(languagePlugin?.active && languagePlugin.portable_enabled)} expiresAt={languageExpiry}>
        <AbuseNotice userId={context.user?.id ?? null} />
        <OverlayDismissal />
        <WindowsPosDownloadPrompt authenticated={Boolean(context.user)} />
        <SessionExpiryPrompt authenticated={Boolean(context.user)} />
        <OwnerQueueRuntime scope={isSalonManageContext(context)&&context.currentSalon&&context.user?`owner:${context.currentSalon.id}:${context.user.id}`:null}/>
        <CampaignPluginProvider key={experience.scope} scope={experience.scope} installed={false}>
          {isOwner ? <Suspense fallback={null}><OptionalCampaignWallet context={context} scope={experience.scope} /></Suspense> : null}
          <ExploreAccountActionsProvider authenticated={Boolean(context.user)}><ExploreAdvertising audience={!context.user ? "guest" : context.workspaceType === "salon" ? context.salonMode === "staff" ? "staff" : "owner" : "personal"}><SalonSwitcher context={context}><StartupReady />{children}</SalonSwitcher></ExploreAdvertising><QuickBooking /></ExploreAccountActionsProvider>
        </CampaignPluginProvider></WorkspaceLanguageProvider>
    </ExperienceScopeProvider>
  );
}

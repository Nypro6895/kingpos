import { withExperiencePage } from "@/components/experience-page";
import { SalonPublicationStatus } from "@/components/salon-publication-status";
export const metadata = { title: "Salon profile | Reylumi" };
import { loadSalonPostAttribution } from "@/lib/salon-post-attribution";
import { WorkspaceText } from "@/components/workspace-language";
import { SalonProfileView } from "@/app/salon-profile/salon-profile-view";
import {
  buildSalonProfileFeed,
  getCurrentSalonProfileManageData,
  getPublicSalonProfileData,
  getSalonProfileHref,
} from "@/lib/salon-profile";
import { getCurrentSalonOperatingStatus } from "@/lib/salon-operating-status";
import { defaultSalonOperatingStatus } from "@/lib/salon-operating-status-core";
import { isSalonManageContext, isOwnerMembership } from "@/lib/current-context";
import { requireSalonWorkspacePageContext } from "@/lib/route-context-guards";
import type {
  PublicSalonProfileData,
  SalonProfileViewerCapabilities,
} from "@/types/salon-profile";

type SalonProfilePageProps = {
  searchParams: Promise<{
    error?: string;
    notice?: string;
  }>;
};

import { buildPreviewData } from "@/lib/salon-profile-preview";

function withManagedSalonName(
  data: PublicSalonProfileData,
  name: string,
): PublicSalonProfileData {
  if (data.profile.name === name) {
    return data;
  }

  return {
    ...data,
    feed: buildSalonProfileFeed({
      looks: data.looks,
      profileName: name,
      salonId: data.profile.salonId,
      updates: data.updates,
    }),
    profile: {
      ...data.profile,
      name,
    },
  };
}

function withManagedPreviewStaff(
  data: PublicSalonProfileData,
  previewData: PublicSalonProfileData,
): PublicSalonProfileData {
  const publicStaffIds = new Set(data.staff.map((member) => member.id));
  const missingPreviewStaff = previewData.staff.filter(
    (member) => !publicStaffIds.has(member.id),
  );

  if (missingPreviewStaff.length === 0) {
    return data;
  }

  return {
    ...data,
    staff: [...data.staff, ...missingPreviewStaff],
  };
}

async function SalonProfilePage({
  searchParams,
}: SalonProfilePageProps) {
  const [{ error, notice }, context] = await Promise.all([
    searchParams,
    requireSalonWorkspacePageContext("/salon-profile"),
  ]);
  const salonId = context.salonMode === "staff" ? context.currentStaffSalon?.id : context.currentSalon?.id;
  const publicData = salonId ? await getPublicSalonProfileData(salonId, 0) : null;
  // Published content is already in the authorized public DTO. Do not pull the
  // same posts a second time just to build the owner's management controls.
  const data = await getCurrentSalonProfileManageData(context, 0, !publicData);

  if (!data.canViewProfile) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          <WorkspaceText text="You do not have permission to view Salon Profile." />
        </p>
      </main>
    );
  }

  const operatingStatus = publicData?.profile.operatingStatus ?? await getCurrentSalonOperatingStatus(context).catch(() => defaultSalonOperatingStatus());
  const attribution = await loadSalonPostAttribution([...data.looks, ...data.updates].map(post => post.id));
  const previewData = buildPreviewData({
    attribution,
    ...data,
    accountId: data.context.currentAccount?.id ?? data.context.accountId ?? "",
    operatingStatus,
  });
  const managedSalonName =
    data.context.currentSalon?.name ?? previewData.profile.name;
  const viewData = publicData
    ? withManagedPreviewStaff(
        withManagedSalonName(publicData, managedSalonName),
        previewData,
      )
    : previewData;
  const capabilities: SalonProfileViewerCapabilities = {
    canBook: Boolean(publicData) && viewData.profile.operatingStatus.kind !== "permanently_closed",
    canCreateContent: data.canCreateContent,
    canEditProfile: data.canManageIdentity,
    canFollow: false,
    canManageContent: data.canManageContent,
    canFeatureOwnContent: isOwnerMembership(context.currentMembership),
    canModerateComments: data.canManageContent,
    canPublish: data.canManageIdentity,
    canReplyAsSalon: data.canManageContent,
    canViewDraftContent: data.canManageContent,
    currentUserId: context.user?.id ?? null,
    isAuthenticated: Boolean(context.user),
    isOwnSalon: isSalonManageContext(context),
  };

  return (
    <main>
      {isSalonManageContext(context) && !publicData ? <div className="mx-auto max-w-6xl px-4 pt-4"><SalonPublicationStatus publicHref={null} /></div> : null}
      <SalonProfileView
        capabilities={capabilities}
        data={viewData}
        error={error}
        manageData={{
          ownedLookIds: data.looks.filter(look => (look.created_by_user_id ?? look.author_user_id) === context.user?.id).map(look=>look.id),
          publicHref: publicData ? getSalonProfileHref(data.setting.salon_id) : null,
          readiness: data.readiness,
          setting: data.setting,
        }}
        notice={notice}
      />
    </main>
  );
}

export default withExperiencePage(SalonProfilePage);

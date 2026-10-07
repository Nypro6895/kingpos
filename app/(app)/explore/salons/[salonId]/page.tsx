import {ExploreBookButton,ExploreSalonLove} from "@/components/explore-account-actions";
import { SalonProfileView } from "@/app/salon-profile/salon-profile-view";
import { getCurrentBusinessContext, isSalonManageContext } from "@/lib/current-context";
import { getPublicSalonProfileData } from "@/lib/salon-profile";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

type PublicSalonProfilePageProps = {
  params: Promise<{
    salonId: string;
  }>;
};

export async function generateMetadata({
  params,
}: PublicSalonProfilePageProps): Promise<Metadata> {
  const { salonId } = await params;
  const data = await getPublicSalonProfileData(salonId);

  if (!data) {
    return {
      title: "Salon not found | Reylumi",
    };
  }

  return {
    title: `${data.profile.name} | Reylumi`,
    description:
      data.profile.tagline ??
      data.profile.description ??
      "Explore this salon on Reylumi.",
  };
}

export default async function PublicSalonProfilePage({
  params,
}: PublicSalonProfilePageProps) {
  const { salonId } = await params;
  const [data, context] = await Promise.all([
    getPublicSalonProfileData(salonId),
    getCurrentBusinessContext(),
  ]);

  if (!data) {
    notFound();
  }

  if (context.user && context.currentSalon?.id === salonId && isSalonManageContext(context)) {
    redirect("/salon-profile");
  }

  return (
    <main>
      <div className="flex justify-end gap-3 px-5 py-3"><ExploreSalonLove salonId={salonId} name={data.profile.name}/><ExploreBookButton href={`/book/${salonId}`} name={data.profile.name} contactHref={`/explore/salons/${salonId}`} phoneHref={data.profile.phone?`tel:${data.profile.phone}`:null}/></div>
      <SalonProfileView
        capabilities={{
          canBook: data.directoryListing?.claimState !== "unclaimed" && data.profile.operatingStatus.kind !== "permanently_closed",
          canCreateContent: false,
          canEditProfile: false,
          canFollow: true,
          canManageContent: false,
          canModerateComments: false,
          canPublish: false,
          canReplyAsSalon: false,
          canViewDraftContent: false,
          currentUserId: context.user?.id ?? null,
          isAuthenticated: Boolean(context.user),
          isOwnSalon: false,
        }}
        data={data}
      />
    </main>
  );
}

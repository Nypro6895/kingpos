import { SalonProfileView } from "@/app/salon-profile/salon-profile-view";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { getPublicSalonProfileData } from "@/lib/salon-profile";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

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
      title: "Salon not found | KingPOS",
    };
  }

  return {
    title: `${data.profile.name} | KingPOS`,
    description:
      data.profile.tagline ??
      data.profile.description ??
      "Explore this salon on KingPOS.",
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

  return (
    <main>
      <SalonProfileView
        capabilities={{
          canBook: true,
          canCreateContent: false,
          canEditProfile: false,
          canFollow: true,
          canManageContent: false,
          canModerateComments: false,
          canPublish: false,
          canReplyAsSalon: false,
          canViewDraftContent: false,
          isAuthenticated: Boolean(context.user),
          isOwnSalon: false,
        }}
        data={data}
      />
    </main>
  );
}

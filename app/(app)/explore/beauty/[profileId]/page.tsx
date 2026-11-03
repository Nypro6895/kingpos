import { withExperiencePage } from "@/components/experience-page";
import { getPublicBeautyProfile, getBeautyProfileRoutePage } from "@/lib/beauty-relationship";
import { BeautyProfileReadView } from "@/app/explore/beauty/beauty-profile-read-view";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

type PublicBeautyProfilePageProps = {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ customerId?: string; before?: string; post?: string }>;
};

export async function generateMetadata({ params }: PublicBeautyProfilePageProps): Promise<Metadata> {
  const { profileId } = await params;
  const result = await getPublicBeautyProfile(profileId);
  return { title: result.ok && result.profile ? result.profile.displayName + " | Reylumi Beauty" : "Beauty profile | Reylumi" };
}

async function PublicBeautyProfilePage({
  params,
  searchParams,
}: PublicBeautyProfilePageProps) {
  const [{ profileId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const page = await getBeautyProfileRoutePage({ customerId: query.customerId, profileId, cursor: query.before && query.post ? {createdAt:query.before,postId:query.post} : null });

  if (!page) {
    notFound();
  }

  if (page.profile.isSelf) redirect("/beauty");
  return <BeautyProfileReadView page={page} />;
}

export default withExperiencePage(PublicBeautyProfilePage);

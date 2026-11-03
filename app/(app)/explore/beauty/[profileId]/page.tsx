import { withExperiencePage } from "@/components/experience-page";
import { getBeautyProfileRoutePage } from "@/lib/beauty-relationship";
import { BeautyProfileReadView } from "@/app/explore/beauty/beauty-profile-read-view";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

type PublicBeautyProfilePageProps = {
  params: Promise<{ profileId: string }>;
  searchParams: Promise<{ customerId?: string; before?: string; post?: string }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: PublicBeautyProfilePageProps): Promise<Metadata> {
  const [{ profileId }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const page = await getBeautyProfileRoutePage({ customerId: query.customerId, profileId, cursor: query.before && query.post ? {createdAt:query.before,postId:query.post} : null });

  if (!page) {
    return {
      title: "Beauty profile not found | Reylumi",
    };
  }

  if (page.access === "private_relationship") {
    return {
      description: "This Beauty profile is private.",
      title: "Private Beauty profile | Reylumi",
    };
  }

  return {
    description:
      page.profile.bio ?? `${page.profile.displayName}'s Beauty profile on Reylumi.`,
    title: `${page.profile.displayName} | Reylumi Beauty`,
  };
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

import { withExperiencePage } from "@/components/experience-page";
import { getBeautyProfileRoutePage } from "@/lib/beauty-relationship";
import { BeautyProfileReadView } from "@/app/explore/beauty/beauty-profile-read-view";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PublicBeautyProfilePageProps = {
  params: Promise<{
    profileId: string;
  }>;
  searchParams: Promise<{
    customerId?: string;
  }>;
};

export async function generateMetadata({
  params,
  searchParams,
}: PublicBeautyProfilePageProps): Promise<Metadata> {
  const [{ profileId }, { customerId }] = await Promise.all([
    params,
    searchParams,
  ]);
  const page = await getBeautyProfileRoutePage({ customerId, profileId });

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
  const [{ profileId }, { customerId }] = await Promise.all([
    params,
    searchParams,
  ]);
  const page = await getBeautyProfileRoutePage({ customerId, profileId });

  if (!page) {
    notFound();
  }

  return <BeautyProfileReadView page={page} />;
}

export default withExperiencePage(PublicBeautyProfilePage);

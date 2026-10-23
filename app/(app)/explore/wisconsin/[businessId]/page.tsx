import { withExperiencePage } from "@/components/experience-page";
import { notFound, redirect } from "next/navigation";
import { resolveReferenceFavorites } from "@/lib/explore-reference-favorites";

async function DirectoryBusinessPage({ params }: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const current = await resolveReferenceFavorites([`directory:${businessId}`]);
  if (current.error) throw new Error(current.error);
  const favorite = current.items[0];
  if (!favorite) notFound();
  redirect(favorite.href);
}

export default withExperiencePage(DirectoryBusinessPage);

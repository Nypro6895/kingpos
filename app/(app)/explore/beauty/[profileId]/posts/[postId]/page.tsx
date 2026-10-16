import { withExperiencePage } from "@/components/experience-page";
import { getPublicExploreBeautyPost } from "@/lib/explore-personal";
import { getPostCommentViewer } from "@/lib/post-comments";
import { BeautyPostReadView } from "@/app/explore/beauty/beauty-post-read-view";
import type { ExploreFeedItem } from "@/types/explore";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type PublicBeautyPostPageProps = {
  params: Promise<{
    postId: string;
    profileId: string;
  }>;
};

function postLabel(item: ExploreFeedItem) {
  return item.personal?.postType === "before_after"
    ? "Before & After"
    : "Beauty moment";
}

export async function generateMetadata({
  params,
}: PublicBeautyPostPageProps): Promise<Metadata> {
  const { postId, profileId } = await params;
  const item = await getPublicExploreBeautyPost({ postId, profileId });

  if (!item) {
    return {
      title: "Beauty post not found | Reylumi",
    };
  }

  return {
    title: `${item.author.name} on Reylumi`,
    description: item.caption ?? `Explore this ${postLabel(item)} on Reylumi.`,
  };
}

async function PublicBeautyPostPage({
  params,
}: PublicBeautyPostPageProps) {
  const { postId, profileId } = await params;
  const [item, commentViewer] = await Promise.all([
    getPublicExploreBeautyPost({ postId, profileId }),
    getPostCommentViewer(),
  ]);

  if (!item || item.personal.profileId !== profileId) {
    notFound();
  }

  return <BeautyPostReadView item={item} commentViewer={commentViewer} profileId={profileId} postId={postId} />;
}

export default withExperiencePage(PublicBeautyPostPage);

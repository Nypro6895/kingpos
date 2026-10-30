import Link from "next/link";
import { redirect } from "next/navigation";
import { withExperiencePage } from "@/components/experience-page";
import { BeautyProfileClient } from "@/app/beauty/beauty-profile-client";
import { getSelfBeautyProfilePage } from "@/lib/beauty";
import { getPostCommentViewer } from "@/lib/post-comments";

async function BeautyLibraryPage() {
  const [result, commentViewer] = await Promise.all([getSelfBeautyProfilePage(), getPostCommentViewer()]);
  if (!result.ok) {
    if (result.code === "sign_in_required") redirect("/login?next=%2Fbeauty%2Flibrary");
    return <main className="mx-auto max-w-3xl p-5"><Link href="/beauty" className="text-brand-teal">← Beauty</Link><h1 className="mt-4 text-xl">We could not load your profile</h1><p className="mt-2 text-text-secondary">{result.message}</p></main>;
  }
  return <><div className="mx-auto max-w-3xl px-3 pt-3 sm:px-6"><Link href="/beauty" className="inline-flex min-h-11 items-center text-sm text-brand-teal">← Beauty</Link></div><BeautyProfileClient commentViewer={commentViewer} initialTimeline={result.data.timeline} profile={result.data.profile} visitCandidates={result.data.visitCandidates}/></>;
}

export default withExperiencePage(BeautyLibraryPage);

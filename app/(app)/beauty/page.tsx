import { withExperiencePage } from "@/components/experience-page";
import { BeautyProfileClient } from "@/app/beauty/beauty-profile-client";
import { getSelfBeautyProfilePage } from "@/lib/beauty";
import { getPostCommentViewer } from "@/lib/post-comments";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BeautyAppointment } from "@/app/beauty/beauty-appointment";
import { BeautyHomeFavorites } from "@/app/beauty/beauty-home-favorites";

async function BeautyPage() {
  const [result, commentViewer] = await Promise.all([
    getSelfBeautyProfilePage(),
    getPostCommentViewer(),
  ]);

  if (!result.ok) {
    if (result.code === "sign_in_required") {
      redirect("/login?next=/beauty");
    }

    return (
      <main className="min-h-screen bg-surface-muted px-4 py-6 sm:px-6 lg:px-8">
        <section className="mx-auto grid max-w-xl gap-3 border-border-subtle bg-surface p-5 text-center rounded-none border-0 shadow-none">
          <p className="text-xs font-extrabold uppercase tracking-wide text-brand-orange">
            Beauty
          </p>
          <h1 className="text-2xl font-extrabold text-text-primary">
            We could not load your profile
          </h1>
          <p className="text-sm leading-6 text-text-secondary">
            {result.message}
          </p>
        </section>
      </main>
    );
  }

  return (
    <BeautyProfileClient
      home
      appointment={<Suspense fallback={<div className="h-28 animate-pulse rounded-2xl bg-surface" aria-label="Loading appointment" />}><BeautyAppointment compact /></Suspense>}
      favorites={<Suspense fallback={<div className="h-32 animate-pulse rounded-2xl bg-surface" aria-label="Loading favorites" />}><BeautyHomeFavorites /></Suspense>}
      commentViewer={commentViewer}
      initialTimeline={result.data.timeline}
      profile={result.data.profile}
      visitCandidates={result.data.visitCandidates}
    />
  );
}

export default withExperiencePage(BeautyPage);

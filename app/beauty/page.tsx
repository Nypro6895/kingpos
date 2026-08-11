import { BeautyProfileClient } from "@/app/beauty/beauty-profile-client";
import { getSelfBeautyProfilePage } from "@/lib/beauty";
import { redirect } from "next/navigation";

export default async function BeautyPage() {
  const result = await getSelfBeautyProfilePage();

  if (!result.ok) {
    if (result.code === "sign_in_required") {
      redirect("/login?next=/beauty");
    }

    return (
      <main className="min-h-screen bg-surface-muted px-4 py-6 sm:px-6 lg:px-8">
        <section className="mx-auto grid max-w-xl gap-3 rounded-2xl border border-border-subtle bg-surface p-5 text-center shadow-sm">
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
      initialTimeline={result.data.timeline}
      profile={result.data.profile}
      visitCandidates={result.data.visitCandidates}
    />
  );
}

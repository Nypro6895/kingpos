import { getCurrentBusinessContext } from "@/lib/current-context";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type MoreSectionPageProps = {
  params: Promise<{
    section: string;
  }>;
};

type MoreSection = {
  actionHref: string;
  actionLabel: string;
  description: string;
  eyebrow: string;
  title: string;
};

const MORE_SECTIONS: Record<string, MoreSection> = {
  "saved-designs": {
    actionHref: "/explore",
    actionLabel: "Explore salons",
    description:
      "Saved looks will appear here when they are available for your account.",
    eyebrow: "Saved Designs",
    title: "No saved designs yet",
  },
  following: {
    actionHref: "/explore",
    actionLabel: "Find salons",
    description:
      "Followed salons will appear here when they are available for your account.",
    eyebrow: "Following",
    title: "No followed salons yet",
  },
  memberships: {
    actionHref: "/explore",
    actionLabel: "Browse salons",
    description:
      "Customer memberships will appear here when they are available for your account.",
    eyebrow: "Memberships",
    title: "No memberships yet",
  },
  reviews: {
    actionHref: "/explore",
    actionLabel: "Explore salons",
    description:
      "Reviews posted from your customer account will appear here.",
    eyebrow: "Reviews",
    title: "No reviews yet",
  },
  "gift-cards": {
    actionHref: "/more",
    actionLabel: "Back to More",
    description:
      "Gift card balances and history will appear here when they are available.",
    eyebrow: "Gift Cards",
    title: "No gift cards yet",
  },
  reports: {
    actionHref: "/notifications",
    actionLabel: "Open notifications",
    description:
      "Support updates tied to your customer account will appear here when they are available.",
    eyebrow: "Reports",
    title: "Reports & Support",
  },
};

export default async function MoreSectionPage({ params }: MoreSectionPageProps) {
  const [{ section }, context] = await Promise.all([
    params,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect(`/login?next=/more/${encodeURIComponent(section)}`);
  }

  const content = MORE_SECTIONS[section];

  if (!content) {
    notFound();
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        <Link
          className="w-fit rounded-full px-2 py-1 text-sm font-bold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href="/more"
        >
          Back to More
        </Link>

        <section className="grid gap-4 rounded-2xl border border-dashed border-border-subtle bg-surface px-5 py-8 text-center shadow-sm">
          <p className="text-xs font-bold uppercase text-brand-orange">
            {content.eyebrow}
          </p>
          <h1 className="text-2xl font-extrabold text-text-primary">
            {content.title}
          </h1>
          <p className="mx-auto max-w-md text-sm leading-6 text-text-secondary">
            {content.description}
          </p>
          <Link
            className="mx-auto inline-flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#ef5d28] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href={content.actionHref}
          >
            {content.actionLabel}
          </Link>
        </section>
      </div>
    </main>
  );
}

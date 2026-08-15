import {
  getAccountFavoriteCustomers,
  getAccountFavoriteShops,
  getAccountSavedPosts,
  removeAccountFavoriteCustomer,
  removeAccountFavoriteShop,
  removeAccountSavedPost,
  type AccountFavoriteCustomer,
  type AccountFavoriteShop,
  type AccountSavedPost,
} from "@/lib/account-social";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { revalidatePath } from "next/cache";
import Image from "next/image";
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
};

const MORE_SECTIONS: Record<string, MoreSection> = {
  memberships: {
    actionHref: "/explore",
    actionLabel: "Browse salons",
    description:
      "Customer memberships will appear here when they are available for your account.",
  },
  reviews: {
    actionHref: "/explore",
    actionLabel: "Explore salons",
    description:
      "Reviews posted from your customer account will appear here.",
  },
  "gift-cards": {
    actionHref: "/more",
    actionLabel: "Back to More",
    description:
      "Gift card balances and history will appear here when they are available.",
  },
  reports: {
    actionHref: "/notifications",
    actionLabel: "Open notifications",
    description:
      "Support updates tied to your customer account will appear here when they are available.",
  },
};

function normalizeSection(section: string) {
  if (section === "saved-designs") {
    return "saved-post";
  }

  if (section === "following") {
    return "favorite-shop";
  }

  return section;
}

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

async function removeSavedPostAction(formData: FormData) {
  "use server";

  const lookId = readFormString(formData, "look_id");

  if (lookId) {
    await removeAccountSavedPost(lookId);
    revalidatePath("/more/saved-post");
    revalidatePath("/more/saved-designs");
  }
}

async function removeFavoriteShopAction(formData: FormData) {
  "use server";

  const salonId = readFormString(formData, "salon_id");

  if (salonId) {
    await removeAccountFavoriteShop(salonId);
    revalidatePath("/more/favorite-shop");
    revalidatePath("/more/following");
  }
}

async function removeFavoriteCustomerAction(formData: FormData) {
  "use server";

  const customerId = readFormString(formData, "customer_id");

  if (customerId) {
    await removeAccountFavoriteCustomer(customerId);
    revalidatePath("/more/favorite-customer");
  }
}

function BackLink() {
  return (
    <Link
      className="w-fit rounded-full px-2 py-1 text-sm font-bold text-brand-orange transition hover:bg-brand-orange-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      href="/more"
    >
      Back to More
    </Link>
  );
}

function EmptyState({
  actionHref,
  actionLabel,
  description,
}: MoreSection) {
  return (
    <section className="grid gap-4 rounded-2xl border border-dashed border-border-subtle bg-surface px-5 py-8 text-center shadow-sm">
      <p className="mx-auto max-w-md text-sm leading-6 text-text-secondary">
        {description}
      </p>
      <Link
        className="mx-auto inline-flex min-h-11 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#ef5d28] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        href={actionHref}
      >
        {actionLabel}
      </Link>
    </section>
  );
}

function RemoveButton({ children }: { children: string }) {
  return (
    <button
      className="inline-flex min-h-10 items-center justify-center rounded-full border border-border-subtle px-4 text-sm font-bold text-text-primary transition hover:border-brand-orange/40 hover:text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      type="submit"
    >
      {children}
    </button>
  );
}

function SavedPostCard({ post }: { post: AccountSavedPost }) {
  return (
    <article className="grid gap-3 rounded-2xl border border-border-subtle bg-surface p-3 shadow-sm sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <Link
        className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-surface-muted"
        href={post.href}
      >
        {post.imageUrl ? (
          <Image
            alt=""
            className="object-cover"
            fill
            sizes="(min-width: 640px) 7.5rem, calc(100vw - 2.5rem)"
            src={post.imageUrl}
          />
        ) : null}
      </Link>
      <div className="grid min-w-0 content-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold uppercase text-brand-orange">
            {post.salonName}
          </p>
          <h2 className="mt-1 line-clamp-2 text-lg font-extrabold text-text-primary">
            {post.title}
          </h2>
          {post.caption ? (
            <p className="mt-1 line-clamp-2 text-sm font-semibold text-text-secondary">
              {post.caption}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href={post.href}
          >
            View
          </Link>
          <form action={removeSavedPostAction}>
            <input name="look_id" type="hidden" value={post.lookId} />
            <RemoveButton>Remove</RemoveButton>
          </form>
        </div>
      </div>
    </article>
  );
}

function FavoriteShopCard({ shop }: { shop: AccountFavoriteShop }) {
  return (
    <article className="grid min-h-[92px] gap-3 rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase text-brand-orange">
          Favorite Shop
        </p>
        <h2 className="mt-1 truncate text-lg font-extrabold text-text-primary">
          {shop.salonName}
        </h2>
        {shop.locationLabel ? (
          <p className="mt-1 truncate text-sm font-semibold text-text-secondary">
            {shop.locationLabel}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          href={shop.href}
        >
          View
        </Link>
        <form action={removeFavoriteShopAction}>
          <input name="salon_id" type="hidden" value={shop.salonId} />
          <RemoveButton>Unfollow</RemoveButton>
        </form>
      </div>
    </article>
  );
}

function FavoriteCustomerCard({
  canOpenCustomer,
  customer,
}: {
  canOpenCustomer: boolean;
  customer: AccountFavoriteCustomer;
}) {
  return (
    <article className="grid min-h-[92px] gap-3 rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase text-brand-orange">
          {customer.salonName}
        </p>
        <h2 className="mt-1 truncate text-lg font-extrabold text-text-primary">
          {customer.name}
        </h2>
        <p className="mt-1 truncate text-sm font-semibold text-text-secondary">
          {[customer.phone, customer.email].filter(Boolean).join(" / ") ||
            "No contact"}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {canOpenCustomer ? (
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-brand-orange px-4 text-sm font-bold text-white transition hover:bg-brand-orange-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            href={customer.href}
          >
            View
          </Link>
        ) : null}
        <form action={removeFavoriteCustomerAction}>
          <input name="customer_id" type="hidden" value={customer.customerId} />
          <RemoveButton>Remove</RemoveButton>
        </form>
      </div>
    </article>
  );
}

function SavedPostsSection({ posts }: { posts: AccountSavedPost[] }) {
  if (posts.length === 0) {
    return (
      <EmptyState
        actionHref="/explore"
        actionLabel="Explore salons"
        description="Saved posts will appear here from Personal, Staff, and Owner."
      />
    );
  }

  return (
    <section className="grid gap-3" aria-label="Saved posts">
      {posts.map((post) => (
        <SavedPostCard key={post.id} post={post} />
      ))}
    </section>
  );
}

function FavoriteShopsSection({ shops }: { shops: AccountFavoriteShop[] }) {
  if (shops.length === 0) {
    return (
      <EmptyState
        actionHref="/explore"
        actionLabel="Find salons"
        description="Favorite shops will appear here from every role."
      />
    );
  }

  return (
    <section className="grid gap-3" aria-label="Favorite shops">
      {shops.map((shop) => (
        <FavoriteShopCard key={shop.id} shop={shop} />
      ))}
    </section>
  );
}

function FavoriteCustomersSection({
  canOpenCustomers,
  customers,
}: {
  canOpenCustomers: boolean;
  customers: AccountFavoriteCustomer[];
}) {
  if (customers.length === 0) {
    return (
      <EmptyState
        actionHref="/more"
        actionLabel="Back to More"
        description="Favorite customers will appear here from every role."
      />
    );
  }

  return (
    <section className="grid gap-3" aria-label="Favorite customers">
      {customers.map((customer) => (
        <FavoriteCustomerCard
          canOpenCustomer={canOpenCustomers}
          customer={customer}
          key={customer.id}
        />
      ))}
    </section>
  );
}

export default async function MoreSectionPage({ params }: MoreSectionPageProps) {
  const [{ section }, context] = await Promise.all([
    params,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect(`/login?next=/more/${encodeURIComponent(section)}`);
  }

  const normalizedSection = normalizeSection(section);

  if (normalizedSection === "saved-post") {
    const posts = await getAccountSavedPosts();

    return (
      <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-4xl gap-5">
          <BackLink />
          <SavedPostsSection posts={posts} />
        </div>
      </main>
    );
  }

  if (normalizedSection === "favorite-shop") {
    const shops = await getAccountFavoriteShops();

    return (
      <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-4xl gap-5">
          <BackLink />
          <FavoriteShopsSection shops={shops} />
        </div>
      </main>
    );
  }

  if (normalizedSection === "favorite-customer") {
    const customers = await getAccountFavoriteCustomers();

    return (
      <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto grid w-full max-w-4xl gap-5">
          <BackLink />
          <FavoriteCustomersSection
            canOpenCustomers={isSalonManageContext(context)}
            customers={customers}
          />
        </div>
      </main>
    );
  }

  const content = MORE_SECTIONS[normalizedSection];

  if (!content) {
    notFound();
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-muted px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        <BackLink />
        <EmptyState {...content} />
      </div>
    </main>
  );
}

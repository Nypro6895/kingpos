import Link from "next/link";
import { getSupabaseAuthUser } from "@/lib/supabase/server";
import { advertisingClient } from "@/lib/explore-advertising";
import { referenceFavorite } from "@/lib/explore-reference-favorites";
import { redirect } from "next/navigation";
import { ExploreReferenceLove } from "@/components/explore-account-actions";
export default async function ExploreFavoritesPage() {
  const user = await getSupabaseAuthUser();
  if (!user) redirect("/login?next=%2Fexplore%2Ffavorites");
  const { data, error } = await advertisingClient()
    .from("explore_reference_favorites")
    .select("item_key")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const favorites = (data ?? [])
    .map((item) => referenceFavorite(item.item_key))
    .filter((item) => item !== null);
  return (
    <main className="mx-auto max-w-3xl space-y-5 p-6">
      <Link href="/explore" className="text-brand-orange">
        ← Explore
      </Link>
      <h1 className="text-3xl font-semibold">Your favorites ♡</h1>
      <p className="text-zinc-600">
        Your saved directory places and inspiration previews.
      </p>
      <div className="flex gap-4">
        <Link className="text-brand-orange" href="/more/saved-post">
          Saved posts
        </Link>
        <Link className="text-brand-orange" href="/more/following">
          Followed salons & artists
        </Link>
      </div>
      {error ? (
        <p role="alert">Favorites could not be loaded. Please try again.</p>
      ) : favorites.length ? (
        favorites.map((item) => (
          <article
            key={item.key}
            className="flex items-center justify-between rounded-2xl border p-4"
          >
            <Link href={item.href} className="font-semibold">
              {item.name}
            </Link>
            <ExploreReferenceLove itemKey={item.key} name={item.name} />
          </article>
        ))
      ) : (
        <p className="rounded-2xl bg-orange-50 p-5">
          Find something you love on Explore and tap the heart to keep it here.
        </p>
      )}
    </main>
  );
}

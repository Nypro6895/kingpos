import { withExperiencePage } from "@/components/experience-page";
import { SavedSalonList } from "@/components/saved-salon-list";
import Link from "next/link";
import { createAuthenticatedSupabaseServerClient, getSupabaseAuthUser } from "@/lib/supabase/server";
import { encodeReferenceFavoriteCursor, referenceFavoriteCursor, resolveReferenceFavorites } from "@/lib/explore-reference-favorites";
import { redirect } from "next/navigation";
import { ExploreReferenceLove } from "@/components/explore-account-actions";
import { nailLookById } from "@/lib/nail-inspiration-catalog";
import { NailInspirationCard } from "@/app/explore/nail-inspiration";
async function ExploreFavoritesPage({ searchParams }: {
  searchParams: Promise<{ salons?: string; after?: string | string[] }>;
}) {
  const user = await getSupabaseAuthUser();
  const client = await createAuthenticatedSupabaseServerClient();
  if (!user || !client) redirect("/login?next=%2Fexplore%2Ffavorites");
  const params = await searchParams;
  const salonOffset = Math.max(0, Math.min(100000, Number.parseInt(params.salons ?? "0", 10) || 0));
  const salonPreferences = await client.rpc("get_my_explore_salon_preferences", { p_offset: salonOffset });
  const salonRows = Array.isArray(salonPreferences.data) ? salonPreferences.data : [];
  const cursor = referenceFavoriteCursor(Array.isArray(params.after) ? params.after[0] : params.after);
  const { data, error } = await client.rpc("get_my_explore_reference_favorites", {
    p_before_created_at: cursor?.createdAt ?? null,
    p_before_item_key: cursor?.itemKey ?? null,
    p_limit: 20,
  });
  const rows = Array.isArray(data) ? data as Array<{ item_key: string; created_at: string }> : [];
  const shown = rows.slice(0, 20);
  const resolved = await resolveReferenceFavorites(shown.map(item => item.item_key));
  const favorites = resolved.items;
  const last = shown.at(-1);
  const next = rows.length > 20 && last ? encodeReferenceFavoriteCursor({ createdAt: last.created_at, itemKey: last.item_key }) : null;
  return (
    <main className="w-full min-w-0 space-y-5 p-6">
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
      {salonPreferences.error ? <p role="alert">Your salons could not be loaded. Please try again.</p> : salonRows.length ? <><SavedSalonList items={salonRows.slice(0,20)}/>{salonRows.length>20?<Link href={`/explore/favorites?salons=${salonOffset+20}`} className="text-brand-orange">More salons →</Link>:null}</> : null}
      {error || resolved.error ? (
        <p role="alert">Favorites could not be loaded. Please try again.</p>
      ) : favorites.length ? (
        favorites.map((item) => item.nailLookId && nailLookById(item.nailLookId) ? <NailInspirationCard key={item.key} look={nailLookById(item.nailLookId)!} initialSaved /> : (
          <article
            key={item.key}
            className="flex min-w-0 items-center justify-between gap-4 border-b border-divider-subtle py-4"
          >
            <Link href={item.href} className="font-semibold">
              {item.name}
            </Link>
            <ExploreReferenceLove itemKey={item.key} name={item.name} initialActive />
          </article>
        ))
      ) : (
        <p className="bg-orange-50 p-5">
          Find something you love on Explore and tap the heart to keep it here.
        </p>
      )}
      {next ? <Link className="text-brand-orange" href={`/explore/favorites?after=${next}`}>More favorites →</Link> : null}
    </main>
  );
}

export default withExperiencePage(ExploreFavoritesPage);

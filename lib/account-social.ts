import "server-only";

import { getCurrentBusinessContext } from "@/lib/current-context";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

type SavedPostRpcRow = {
  caption: string | null;
  look_id: string;
  media_path: string | null;
  published_at: string | null;
  salon_id: string;
  salon_name: string;
  saved_at: string;
  saved_id: string;
  title: string;
};

type FavoriteShopRpcRow = {
  city: string | null;
  followed_at: string;
  follow_id: string;
  salon_id: string;
  salon_name: string;
  state: string | null;
};

type FavoriteCustomerRpcRow = {
  customer_id: string;
  customer_name: string;
  email: string | null;
  favorite_id: string;
  favorited_at: string;
  phone: string | null;
  salon_id: string;
  salon_name: string;
};

export type AccountSavedPost = {
  caption: string | null;
  href: string;
  id: string;
  imageUrl: string | null;
  lookId: string;
  publishedAt: string | null;
  salonId: string;
  salonName: string;
  savedAt: string;
  title: string;
};

export type AccountFavoriteShop = {
  followedAt: string;
  href: string;
  id: string;
  locationLabel: string | null;
  salonId: string;
  salonName: string;
};

export type AccountFavoriteCustomer = {
  customerId: string;
  email: string | null;
  favoritedAt: string;
  href: string;
  id: string;
  name: string;
  phone: string | null;
  salonId: string;
  salonName: string;
};

function normalizedLimit(limit: number | undefined) {
  return Math.min(100, Math.max(1, Math.round(limit ?? 100)));
}

function joinLocation(city: string | null, state: string | null) {
  const parts = [city, state].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

async function requireAccountSocialClient() {
  const [context, supabase] = await Promise.all([
    getCurrentBusinessContext(),
    createAuthenticatedSupabaseServerClient(),
  ]);

  if (!context.user) {
    throw new Error("Sign in to manage saved and favorite items.");
  }

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  return { supabase, user: context.user };
}

export async function getAccountSavedPosts(limit?: number) {
  const { supabase } = await requireAccountSocialClient();
  const { data, error } = await supabase
    .rpc("list_account_saved_posts", { p_limit: normalizedLimit(limit) });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as SavedPostRpcRow[];

  return rows.map<AccountSavedPost>((row) => ({
    caption: row.caption,
    href: `/explore/salons/${row.salon_id}`,
    id: row.saved_id,
    imageUrl: getSalonProfileMediaUrl(row.media_path),
    lookId: row.look_id,
    publishedAt: row.published_at,
    salonId: row.salon_id,
    salonName: row.salon_name,
    savedAt: row.saved_at,
    title: row.title,
  }));
}

export async function getAccountFavoriteShops(limit?: number) {
  const { supabase } = await requireAccountSocialClient();
  const { data, error } = await supabase
    .rpc("list_account_favorite_shops", { p_limit: normalizedLimit(limit) });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as FavoriteShopRpcRow[];

  return rows.map<AccountFavoriteShop>((row) => ({
    followedAt: row.followed_at,
    href: `/explore/salons/${row.salon_id}`,
    id: row.follow_id,
    locationLabel: joinLocation(row.city, row.state),
    salonId: row.salon_id,
    salonName: row.salon_name,
  }));
}

export async function getAccountFavoriteCustomers(limit?: number) {
  const { supabase } = await requireAccountSocialClient();
  const { data, error } = await supabase
    .rpc("list_account_favorite_customers", { p_limit: normalizedLimit(limit) });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as FavoriteCustomerRpcRow[];

  return rows.map<AccountFavoriteCustomer>((row) => ({
    customerId: row.customer_id,
    email: row.email,
    favoritedAt: row.favorited_at,
    href: `/customers/${row.customer_id}`,
    id: row.favorite_id,
    name: row.customer_name,
    phone: row.phone,
    salonId: row.salon_id,
    salonName: row.salon_name,
  }));
}

export async function removeAccountSavedPost(lookId: string) {
  const { supabase, user } = await requireAccountSocialClient();
  const { error } = await supabase
    .from("salon_profile_look_saves")
    .delete()
    .eq("look_id", lookId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function removeAccountFavoriteShop(salonId: string) {
  const { supabase, user } = await requireAccountSocialClient();
  const { error } = await supabase
    .from("salon_profile_follows")
    .delete()
    .eq("salon_id", salonId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function removeAccountFavoriteCustomer(customerId: string) {
  const { supabase, user } = await requireAccountSocialClient();
  const { error } = await supabase
    .from("account_favorite_customers")
    .delete()
    .eq("customer_id", customerId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function toggleAccountFavoriteCustomer(customerId: string) {
  const { supabase, user } = await requireAccountSocialClient();
  const { data: existing, error: loadError } = await supabase
    .from("account_favorite_customers")
    .select("id")
    .eq("customer_id", customerId)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  if (loadError) {
    throw new Error(loadError.message);
  }

  if (existing) {
    await removeAccountFavoriteCustomer(customerId);
    return false;
  }

  const { error } = await supabase.from("account_favorite_customers").insert({
    customer_id: customerId,
    user_id: user.id,
  });

  if (error) {
    throw new Error(error.message);
  }

  return true;
}

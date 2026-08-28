import "server-only";

import { getBeautyMediaPublicUrl } from "@/lib/beauty-media";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { getSalonProfileMediaUrl } from "@/lib/salon-profile";
import {
  createAuthenticatedSupabaseServerClient,
  createSupabaseServerClient,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import {
  ACCOUNT_SAVED_POST_SOURCE_TYPES,
  savedPostKey,
  type AccountSavedPostFilter,
  type AccountSavedPostSourceType,
  type AccountSavedPostTarget,
} from "@/types/saved-post";

type SavedPostRpcRow = {
  author_name: string | null;
  caption: string | null;
  look_id: string | null;
  media_bucket: string | null;
  media_path: string | null;
  post_id: string | null;
  profile_id: string | null;
  published_at: string | null;
  salon_id: string | null;
  salon_name: string | null;
  saved_at: string;
  saved_id: string;
  source_id: string;
  source_type: string;
  title: string;
};

type SavedPostCountRpcRow = {
  save_count: number | string | null;
  source_id: string | null;
  source_type: string | null;
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

export type AccountFollowingFilter = "all" | "beauty" | "shop";

type AccountFollowingRpcRow = {
  display_name: string | null;
  followed_at: string;
  follow_id: string;
  href: string | null;
  image_path: string | null;
  image_url: string | null;
  secondary_text: string | null;
  target_id: string;
  target_type: string;
  total_count: number | string | null;
};

export type AccountSavedPost = {
  authorName: string | null;
  caption: string | null;
  contentLabel: string;
  href: string;
  id: string;
  imageUrl: string | null;
  publishedAt: string | null;
  salonId: string | null;
  salonName: string | null;
  savedAt: string;
  sourceId: string;
  sourceType: AccountSavedPostSourceType;
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

export type AccountFollowingItem = {
  followedAt: string;
  href: string;
  id: string;
  imageUrl: string | null;
  name: string;
  secondaryLabel: string | null;
  targetId: string;
  targetType: Exclude<AccountFollowingFilter, "all">;
};

export type AccountFollowingPage = {
  filter: AccountFollowingFilter;
  items: AccountFollowingItem[];
  page: number;
  pageSize: number;
  query: string;
  totalCount: number;
  totalPages: number;
};

function normalizedLimit(limit: number | undefined) {
  return Math.min(100, Math.max(1, Math.round(limit ?? 100)));
}

function normalizedOffset(offset: number | undefined) {
  return Math.max(0, Math.round(offset ?? 0));
}

function normalizedSavedPostFilter(
  filter: string | null | undefined,
): AccountSavedPostFilter {
  return ACCOUNT_SAVED_POST_SOURCE_TYPES.some((type) => type === filter)
    ? (filter as AccountSavedPostSourceType)
    : "all";
}

function normalizedQuery(query: string | null | undefined) {
  const trimmed = query?.trim().replace(/\s+/g, " ") ?? "";

  return trimmed || null;
}

function normalizedFollowingFilter(
  filter: string | null | undefined,
): AccountFollowingFilter {
  return filter === "beauty" || filter === "shop" ? filter : "all";
}

function joinLocation(city: string | null, state: string | null) {
  const parts = [city, state].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function isSavedPostSourceType(
  value: string | null | undefined,
): value is AccountSavedPostSourceType {
  return ACCOUNT_SAVED_POST_SOURCE_TYPES.some((type) => type === value);
}

function contentLabel(sourceType: AccountSavedPostSourceType) {
  if (sourceType === "beauty_post") {
    return "Beauty post";
  }

  if (sourceType === "salon_profile_update") {
    return "Salon update";
  }

  return "Salon look";
}

function savedPostHref(row: SavedPostRpcRow, sourceType: AccountSavedPostSourceType) {
  if (sourceType === "beauty_post" && row.profile_id && row.post_id) {
    return `/explore/beauty/${encodeURIComponent(
      row.profile_id,
    )}/posts/${encodeURIComponent(row.post_id)}`;
  }

  if (row.salon_id) {
    const anchor =
      sourceType === "salon_profile_update"
        ? `update-${row.source_id}`
        : `look-${row.source_id}`;

    return `/explore/salons/${encodeURIComponent(row.salon_id)}#${anchor}`;
  }

  return "/explore";
}

function savedPostImageUrl(row: SavedPostRpcRow) {
  if (row.media_bucket === "beauty-profile-media") {
    const config = getSupabaseConfig();

    return config
      ? getBeautyMediaPublicUrl({
          path: row.media_path,
          supabaseUrl: config.supabaseUrl,
        })
      : null;
  }

  return getSalonProfileMediaUrl(row.media_path);
}

function followingImageUrl(row: AccountFollowingRpcRow) {
  if (row.target_type === "beauty") {
    const config = getSupabaseConfig();

    return (
      safeHttpUrl(row.image_url) ??
      (config
        ? getBeautyMediaPublicUrl({
            path: row.image_path,
            supabaseUrl: config.supabaseUrl,
          })
        : null)
    );
  }

  return getSalonProfileMediaUrl(row.image_path);
}

function isAccountFollowingTargetType(
  value: string | null | undefined,
): value is Exclude<AccountFollowingFilter, "all"> {
  return value === "beauty" || value === "shop";
}

function followingHref(row: AccountFollowingRpcRow) {
  const href = row.href?.trim();

  if (href?.startsWith("/") && !href.startsWith("//")) {
    return href;
  }

  return row.target_type === "beauty"
    ? `/explore/beauty/${encodeURIComponent(row.target_id)}`
    : `/explore/salons/${encodeURIComponent(row.target_id)}`;
}

type NormalizedSavedPostTarget = AccountSavedPostTarget & {
  salonId: string | null;
};

function normalizeSaveTarget(
  target: AccountSavedPostTarget,
): NormalizedSavedPostTarget | null {
  const sourceId = target.sourceId.trim();
  const sourceType = target.sourceType;

  if (!sourceId || !isSavedPostSourceType(sourceType)) {
    return null;
  }

  return {
    salonId: target.salonId?.trim() || null,
    sourceId,
    sourceType,
  } satisfies AccountSavedPostTarget;
}

function readSavedPostCount(value: number | string | null | undefined) {
  const count =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : 0;

  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function isSaveCountsRpcUnavailableError(error: {
  code?: string | null;
  message?: string | null;
}) {
  return (
    error.code === "42883" ||
    error.code === "42501" ||
    error.code === "PGRST202" ||
    /could not find the function|schema cache|permission denied/i.test(
      error.message ?? "",
    )
  );
}

const ACCOUNT_SOCIAL_AUTH_REQUIRED_MESSAGE =
  "Sign in to manage saved and favorite items.";

export function isAccountSocialAuthRequiredError(error: unknown) {
  return (
    error instanceof Error &&
    error.message === ACCOUNT_SOCIAL_AUTH_REQUIRED_MESSAGE
  );
}

async function requireAccountSocialClient() {
  const [context, supabase] = await Promise.all([
    getCurrentBusinessContext(),
    createAuthenticatedSupabaseServerClient(),
  ]);

  if (!context.user) {
    throw new Error(ACCOUNT_SOCIAL_AUTH_REQUIRED_MESSAGE);
  }

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  return { supabase, user: context.user };
}

async function getOptionalAccountSocialClient() {
  const [context, supabase] = await Promise.all([
    getCurrentBusinessContext(),
    createAuthenticatedSupabaseServerClient(),
  ]);

  if (!context.user || !supabase) {
    return null;
  }

  return { supabase, user: context.user };
}

export async function hasAccountSocialSession() {
  return Boolean(await getOptionalAccountSocialClient());
}

export async function getAccountSavedPosts(input: {
  filter?: string | null;
  limit?: number;
  offset?: number;
  query?: string | null;
} = {}) {
  const { supabase } = await requireAccountSocialClient();
  const { data, error } = await supabase
    .rpc("list_account_saved_posts", {
      p_filter: normalizedSavedPostFilter(input.filter),
      p_limit: normalizedLimit(input.limit),
      p_offset: normalizedOffset(input.offset),
      p_query: normalizedQuery(input.query),
    });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as SavedPostRpcRow[];

  return rows
    .map<AccountSavedPost | null>((row) => {
      if (!isSavedPostSourceType(row.source_type)) {
        return null;
      }

      return {
        authorName: row.author_name,
        caption: row.caption,
        contentLabel: contentLabel(row.source_type),
        href: savedPostHref(row, row.source_type),
        id: row.saved_id,
        imageUrl: savedPostImageUrl(row),
        publishedAt: row.published_at,
        salonId: row.salon_id,
        salonName: row.salon_name,
        savedAt: row.saved_at,
        sourceId: row.source_id,
        sourceType: row.source_type,
        title: row.title,
      };
    })
    .filter((post): post is AccountSavedPost => Boolean(post));
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

export async function getAccountFollowing(input: {
  filter?: string | null;
  page?: number;
  pageSize?: number;
  query?: string | null;
} = {}): Promise<AccountFollowingPage> {
  const { supabase } = await requireAccountSocialClient();
  const filter = normalizedFollowingFilter(input.filter);
  const query = normalizedQuery(input.query) ?? "";
  const pageSize = normalizedLimit(input.pageSize ?? 10);
  const page = Math.max(1, Math.round(input.page ?? 1));
  const offset = (page - 1) * pageSize;
  const { data, error } = await supabase.rpc("list_account_following", {
    p_filter: filter,
    p_limit: pageSize,
    p_offset: offset,
    p_query: query || null,
  });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as AccountFollowingRpcRow[];
  const items = rows
    .map<AccountFollowingItem | null>((row) => {
      if (!isAccountFollowingTargetType(row.target_type)) {
        return null;
      }

      return {
        followedAt: row.followed_at,
        href: followingHref(row),
        id: row.follow_id,
        imageUrl: followingImageUrl(row),
        name: row.display_name?.trim() || "Reylumi",
        secondaryLabel: row.secondary_text?.trim() || null,
        targetId: row.target_id,
        targetType: row.target_type,
      };
    })
    .filter((item): item is AccountFollowingItem => Boolean(item));
  const firstTotal = rows[0]?.total_count;
  const totalCount =
    typeof firstTotal === "number"
      ? firstTotal
      : typeof firstTotal === "string"
        ? Number.parseInt(firstTotal, 10)
        : 0;
  const totalPages = Math.max(
    1,
    Math.ceil((Number.isFinite(totalCount) ? totalCount : 0) / pageSize),
  );

  return {
    filter,
    items,
    page,
    pageSize,
    query,
    totalCount: Number.isFinite(totalCount) ? totalCount : 0,
    totalPages,
  };
}

export async function removeAccountSavedPost(target: AccountSavedPostTarget) {
  const { supabase, user } = await requireAccountSocialClient();
  const normalizedTarget = normalizeSaveTarget(target);

  if (!normalizedTarget) {
    return;
  }

  if (normalizedTarget.sourceType === "salon_profile_look") {
    const { error } = await supabase
      .from("salon_profile_look_saves")
      .delete()
      .eq("look_id", normalizedTarget.sourceId)
      .eq("user_id", user.id);

    if (error) {
      throw new Error(error.message);
    }

    return;
  }

  const { error } = await supabase
    .from("account_post_saves")
    .delete()
    .eq("source_type", normalizedTarget.sourceType)
    .eq("source_id", normalizedTarget.sourceId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }
}

function isDuplicateSaveError(error: { code?: string | null; message?: string }) {
  return (
    error.code === "23505" ||
    /duplicate key value violates unique constraint/i.test(error.message ?? "")
  );
}

export async function setAccountSavedPost(
  target: AccountSavedPostTarget,
  shouldSave: boolean,
) {
  const { supabase, user } = await requireAccountSocialClient();
  const normalizedTarget = normalizeSaveTarget(target);

  if (!normalizedTarget) {
    throw new Error("Saved post target is invalid.");
  }

  if (!shouldSave) {
    await removeAccountSavedPost(normalizedTarget);
    return false;
  }

  if (normalizedTarget.sourceType === "salon_profile_look") {
    const { data: existing, error: loadError } = await supabase
      .from("salon_profile_look_saves")
      .select("id")
      .eq("look_id", normalizedTarget.sourceId)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string }>();

    if (loadError) {
      throw new Error(loadError.message);
    }

    if (existing) {
      return true;
    }

    const { error } = await supabase.from("salon_profile_look_saves").insert({
      look_id: normalizedTarget.sourceId,
      user_id: user.id,
    });

    if (error && !isDuplicateSaveError(error)) {
      throw new Error(error.message);
    }

    return true;
  }

  const { data: existing, error: loadError } = await supabase
    .from("account_post_saves")
    .select("id")
    .eq("source_type", normalizedTarget.sourceType)
    .eq("source_id", normalizedTarget.sourceId)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  if (loadError) {
    throw new Error(loadError.message);
  }

  if (existing) {
    return true;
  }

  const { error } = await supabase.from("account_post_saves").insert({
    source_id: normalizedTarget.sourceId,
    source_type: normalizedTarget.sourceType,
    user_id: user.id,
  });

  if (error && !isDuplicateSaveError(error)) {
    throw new Error(error.message);
  }

  return true;
}

export async function toggleAccountSavedPost(target: AccountSavedPostTarget) {
  const { supabase, user } = await requireAccountSocialClient();
  const normalizedTarget = normalizeSaveTarget(target);

  if (!normalizedTarget) {
    throw new Error("Saved post target is invalid.");
  }

  if (normalizedTarget.sourceType === "salon_profile_look") {
    const { data: existing, error: loadError } = await supabase
      .from("salon_profile_look_saves")
      .select("id")
      .eq("look_id", normalizedTarget.sourceId)
      .eq("user_id", user.id)
      .maybeSingle<{ id: string }>();

    if (loadError) {
      throw new Error(loadError.message);
    }

    if (existing) {
      const { error } = await supabase
        .from("salon_profile_look_saves")
        .delete()
        .eq("id", existing.id)
        .eq("user_id", user.id);

      if (error) {
        throw new Error(error.message);
      }

      return false;
    }

    const { error } = await supabase.from("salon_profile_look_saves").insert({
      look_id: normalizedTarget.sourceId,
      user_id: user.id,
    });

    if (error) {
      throw new Error(error.message);
    }

    return true;
  }

  const { data: existing, error: loadError } = await supabase
    .from("account_post_saves")
    .select("id")
    .eq("source_type", normalizedTarget.sourceType)
    .eq("source_id", normalizedTarget.sourceId)
    .eq("user_id", user.id)
    .maybeSingle<{ id: string }>();

  if (loadError) {
    throw new Error(loadError.message);
  }

  if (existing) {
    const { error } = await supabase
      .from("account_post_saves")
      .delete()
      .eq("id", existing.id)
      .eq("user_id", user.id);

    if (error) {
      throw new Error(error.message);
    }

    return false;
  }

  const { error } = await supabase.from("account_post_saves").insert({
    source_id: normalizedTarget.sourceId,
    source_type: normalizedTarget.sourceType,
    user_id: user.id,
  });

  if (error) {
    throw new Error(error.message);
  }

  return true;
}

export async function getAccountSavedPostStateKeys(
  targets: AccountSavedPostTarget[],
) {
  const client = await getOptionalAccountSocialClient();

  if (!client) {
    return new Set<string>();
  }

  const normalizedTargets = targets
    .map(normalizeSaveTarget)
    .filter((target): target is NormalizedSavedPostTarget => target !== null);
  const lookIds = normalizedTargets
    .filter((target) => target.sourceType === "salon_profile_look")
    .map((target) => target.sourceId);
  const accountTargets = normalizedTargets.filter(
    (target) => target.sourceType !== "salon_profile_look",
  );
  const savedKeys = new Set<string>();

  if (lookIds.length > 0) {
    const { data, error } = await client.supabase
      .from("salon_profile_look_saves")
      .select("look_id")
      .eq("user_id", client.user.id)
      .in("look_id", [...new Set(lookIds)]);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as Array<{ look_id: string }>) {
      savedKeys.add(savedPostKey({
        sourceId: row.look_id,
        sourceType: "salon_profile_look",
      }));
    }
  }

  if (accountTargets.length > 0) {
    const sourceIds = [...new Set(accountTargets.map((target) => target.sourceId))];

    const { data, error } = await client.supabase
      .from("account_post_saves")
      .select("source_id, source_type")
      .eq("user_id", client.user.id)
      .in("source_id", sourceIds);

    if (error) {
      throw new Error(error.message);
    }

    const requestedKeys = new Set(accountTargets.map(savedPostKey));

    for (const row of (data ?? []) as Array<{
      source_id: string;
      source_type: string;
    }>) {
      if (isSavedPostSourceType(row.source_type)) {
        const key = savedPostKey({
          sourceId: row.source_id,
          sourceType: row.source_type,
        });

        if (requestedKeys.has(key)) {
          savedKeys.add(key);
        }
      }
    }
  }

  return savedKeys;
}

async function getAccountOwnedSavedPostCounts(
  targets: NormalizedSavedPostTarget[],
) {
  const client = await getOptionalAccountSocialClient();
  const counts = new Map<string, number>();

  if (!client || targets.length === 0) {
    return counts;
  }

  const lookIds = targets
    .filter((target) => target.sourceType === "salon_profile_look")
    .map((target) => target.sourceId);
  const accountTargets = targets.filter(
    (target) => target.sourceType !== "salon_profile_look",
  );

  if (lookIds.length > 0) {
    const { data, error } = await client.supabase
      .from("salon_profile_look_saves")
      .select("look_id")
      .eq("user_id", client.user.id)
      .in("look_id", [...new Set(lookIds)]);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as Array<{ look_id: string }>) {
      const key = savedPostKey({
        sourceId: row.look_id,
        sourceType: "salon_profile_look",
      });

      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  if (accountTargets.length > 0) {
    const sourceIds = [...new Set(accountTargets.map((target) => target.sourceId))];
    const requestedKeys = new Set(accountTargets.map(savedPostKey));
    const { data, error } = await client.supabase
      .from("account_post_saves")
      .select("source_id, source_type")
      .eq("user_id", client.user.id)
      .in("source_id", sourceIds);

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as Array<{
      source_id: string;
      source_type: string;
    }>) {
      if (!isSavedPostSourceType(row.source_type)) {
        continue;
      }

      const key = savedPostKey({
        sourceId: row.source_id,
        sourceType: row.source_type,
      });

      if (requestedKeys.has(key)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  return counts;
}

export async function getAccountSavedPostCounts(
  targets: AccountSavedPostTarget[],
) {
  const supabase = createSupabaseServerClient();

  if (!supabase) {
    return new Map<string, number>();
  }

  const normalizedTargets = targets
    .map(normalizeSaveTarget)
    .filter((target): target is NormalizedSavedPostTarget => target !== null);
  const uniqueTargets = Array.from(
    new Map(
      normalizedTargets.map((target) => [savedPostKey(target), target] as const),
    ).values(),
  );

  if (uniqueTargets.length === 0) {
    return new Map<string, number>();
  }

  const { data, error } = await supabase.rpc(
    "get_account_post_save_counts",
    {
      p_targets: uniqueTargets.map((target) => ({
        source_id: target.sourceId,
        source_type: target.sourceType,
      })),
    },
  );

  if (error) {
    if (isSaveCountsRpcUnavailableError(error)) {
      return getAccountOwnedSavedPostCounts(uniqueTargets);
    }

    throw new Error(error.message);
  }

  const requestedKeys = new Set(uniqueTargets.map(savedPostKey));
  const counts = new Map<string, number>();

  for (const row of (data ?? []) as SavedPostCountRpcRow[]) {
    if (!isSavedPostSourceType(row.source_type) || !row.source_id) {
      continue;
    }

    const key = savedPostKey({
      sourceId: row.source_id,
      sourceType: row.source_type,
    });

    if (requestedKeys.has(key)) {
      counts.set(key, readSavedPostCount(row.save_count));
    }
  }

  return counts;
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

export async function removeAccountBeautyProfileFollow(profileId: string) {
  const { supabase, user } = await requireAccountSocialClient();
  const { error } = await supabase
    .from("beauty_profile_follows")
    .delete()
    .eq("profile_id", profileId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function toggleAccountBeautyProfileFollow(profileId: string) {
  const { supabase } = await requireAccountSocialClient();
  const { data, error } = await supabase.rpc(
    "toggle_account_beauty_profile_follow",
    {
      p_profile_id: profileId,
    },
  );

  if (error) {
    throw new Error(error.message);
  }

  return data === true;
}

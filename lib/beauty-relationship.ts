import "server-only";

import {
  getBeautyMediaPublicUrl,
  normalizeBeautyMediaPath,
} from "@/lib/beauty-media";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { getExplorePersonalPostPage } from "@/lib/explore-personal";
import { hasPermission } from "@/lib/permissions";
import {
  createAuthenticatedSupabaseServerClient,
  createSupabaseServerClient,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import type { BeautyProfileVisibility } from "@/types/beauty";
import type {
  ExplorePersonalPostItem,
  ExplorePersonalPostPage,
} from "@/types/explore";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawRecord = Record<string, unknown>;

export type BeautyProfileAccess = "public" | "salon_customer";
export type BeautyProfileRelationshipState =
  | "forbidden"
  | "private"
  | "profile_not_created"
  | "public"
  | "unavailable"
  | "unlinked";

export type ResolvedBeautyProfile = {
  access: BeautyProfileAccess;
  avatarUrl: string | null;
  bio: string | null;
  coverImageUrl: string | null;
  coverMediaPath: string | null;
  createdAt: string | null;
  displayName: string;
  followerCount: number;
  href: string;
  id: string;
  initials: string;
  isFollowing: boolean;
  isSelf: boolean;
  state: Extract<BeautyProfileRelationshipState, "private" | "public">;
  visibility: BeautyProfileVisibility;
};

export type BeautyProfileResolveCode =
  | "database_error"
  | "forbidden"
  | "invalid_input"
  | "not_found"
  | "private_profile"
  | "profile_not_created"
  | "profile_not_found"
  | "sign_in_required"
  | "unlinked"
  | "unlinked_customer";

export type BeautyProfileResolveResult =
  | {
      ok: true;
      state: Extract<BeautyProfileRelationshipState, "private" | "public">;
      profile: ResolvedBeautyProfile;
    }
  | {
      ok: true;
      profile: null;
      state: Extract<
        BeautyProfileRelationshipState,
        "profile_not_created" | "unlinked"
      >;
    }
  | {
      code: BeautyProfileResolveCode;
      ok: false;
      profile: null;
      state: Extract<BeautyProfileRelationshipState, "forbidden" | "unavailable">;
    };

export type BeautyProfileRoutePage =
  | {
      access: "public";
      customerId: null;
      profile: ResolvedBeautyProfile;
      publicPosts: ExplorePersonalPostItem[];
    }
  | {
      access: "private_relationship";
      customerId: string;
      profile: ResolvedBeautyProfile;
      publicPosts: null;
    };

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown) {
  return value === true;
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function cleanUuid(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  return UUID_PATTERN.test(trimmed) ? trimmed : null;
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

function profileVisibility(value: unknown): BeautyProfileVisibility {
  return value === "self" || value === "private" ? "self" : "public";
}

function initialsFor(value: string | null | undefined) {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "R";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function beautyProfileHref(input: {
  customerId?: string | null;
  profileId: string;
  state?: BeautyProfileRelationshipState | null;
}) {
  const base = `/explore/beauty/${encodeURIComponent(input.profileId)}`;

  return input.state === "private" && input.customerId
    ? `${base}?customerId=${encodeURIComponent(input.customerId)}`
    : base;
}

function profileImageUrl(path: string | null) {
  const config = getSupabaseConfig();

  return config
    ? getBeautyMediaPublicUrl({
        path,
        supabaseUrl: config.supabaseUrl,
      })
    : null;
}

function mapProfilePayload(
  payload: unknown,
  customerId?: string | null,
): BeautyProfileResolveResult {
  const record = asRecord(payload);
  const code = readString(record.code);
  const state = normalizeRelationshipState(readString(record.state), code);

  if (record.ok !== true) {
    if (state === "unlinked") {
      return { ok: true, profile: null, state: "unlinked" };
    }

    if (state === "profile_not_created") {
      return { ok: true, profile: null, state: "profile_not_created" };
    }

    return failedResolveResult(code, state);
  }

  if (state === "unlinked" || state === "profile_not_created") {
    return { ok: true, profile: null, state };
  }

  const profile = asRecord(record.profile);
  const id = cleanUuid(readString(profile.id));
  const displayName = readString(profile.displayName);

  if (!id || !displayName) {
    return {
      code: "profile_not_found",
      ok: false,
      profile: null,
      state: "unavailable",
    };
  }

  const visibility = profileVisibility(profile.visibility);
  const profileState: Extract<BeautyProfileRelationshipState, "private" | "public"> =
    state === "private" || visibility === "self" ? "private" : "public";

  if (profileState !== "private" && profileState !== "public") {
    return {
      code: "database_error",
      ok: false,
      profile: null,
      state: "unavailable",
    };
  }

  const coverMediaPath = normalizeBeautyMediaPath(readString(profile.coverMediaPath));

  return {
    ok: true,
    profile: {
      access:
        profileState === "private" ||
        readString(profile.access) === "salon_customer"
          ? "salon_customer"
          : "public",
      avatarUrl: safeHttpUrl(readString(profile.avatarUrl)),
      bio: profileState === "public" ? readString(profile.bio) : null,
      coverImageUrl: profileState === "public" ? profileImageUrl(coverMediaPath) : null,
      coverMediaPath: profileState === "public" ? coverMediaPath : null,
      createdAt: readString(profile.createdAt),
      displayName,
      followerCount: Math.max(0, readNumber(profile.followerCount) ?? 0),
      href: beautyProfileHref({ customerId, profileId: id, state: profileState }),
      id,
      initials: initialsFor(displayName),
      isFollowing: readBoolean(profile.isFollowing),
      isSelf: readBoolean(profile.isSelf),
      state: profileState,
      visibility,
    },
    state: profileState,
  };
}

function isResolveCode(value: string | null): value is BeautyProfileResolveCode {
  return (
    value === "database_error" ||
    value === "forbidden" ||
    value === "invalid_input" ||
    value === "not_found" ||
    value === "private_profile" ||
    value === "profile_not_created" ||
    value === "profile_not_found" ||
    value === "sign_in_required" ||
    value === "unlinked" ||
    value === "unlinked_customer"
  );
}

function failedResolveResult(
  rawCode: string | null,
  state: BeautyProfileRelationshipState,
): BeautyProfileResolveResult {
  const code = isResolveCode(rawCode) ? rawCode : "database_error";

  return {
    code,
    ok: false,
    profile: null,
    state: state === "forbidden" ? "forbidden" : "unavailable",
  };
}

function normalizeRelationshipState(
  rawState: string | null,
  rawCode: string | null,
): BeautyProfileRelationshipState {
  if (rawState === "public" || rawState === "private") {
    return rawState;
  }

  if (rawState === "profile_not_created" || rawState === "unlinked") {
    return rawState;
  }

  if (rawState === "forbidden" || rawState === "unavailable") {
    return rawState;
  }

  if (rawCode === "unlinked" || rawCode === "unlinked_customer") {
    return "unlinked";
  }

  if (rawCode === "profile_not_created" || rawCode === "profile_not_found") {
    return "profile_not_created";
  }

  if (
    rawCode === "forbidden" ||
    rawCode === "not_found" ||
    rawCode === "private_profile" ||
    rawCode === "sign_in_required"
  ) {
    return "forbidden";
  }

  return "unavailable";
}

function errorText(error: unknown) {
  const record = asRecord(error);

  return [
    readString(record.message),
    readString(record.details),
    readString(record.hint),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function relationshipResolverUnavailable(error: unknown) {
  const record = asRecord(error);
  const code = readString(record.code);
  const haystack = errorText(error);

  return (
    code === "PGRST202" ||
    code === "PGRST203" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42883" ||
    code === "42501" ||
    haystack.includes("could not find") ||
    haystack.includes("does not exist") ||
    haystack.includes("permission denied") ||
    haystack.includes("schema cache")
  );
}

async function resolveSalonContext(
  context?: CurrentBusinessContext | null,
): Promise<CurrentBusinessContext> {
  return context ?? getCurrentBusinessContext();
}

export async function resolveBeautyProfileForSalonCustomer(input: {
  context?: CurrentBusinessContext | null;
  customerId: string;
}): Promise<BeautyProfileResolveResult> {
  const customerId = cleanUuid(input.customerId);

  if (!customerId) {
    return {
      code: "invalid_input",
      ok: false,
      profile: null,
      state: "unavailable",
    };
  }

  const context = await resolveSalonContext(input.context);

  if (
    !context.user ||
    !isSalonManageContext(context) ||
    !context.currentSalon
  ) {
    return { code: "forbidden", ok: false, profile: null, state: "forbidden" };
  }

  const canViewCustomers = await hasPermission("customers.view", context);

  if (!canViewCustomers) {
    return { code: "forbidden", ok: false, profile: null, state: "forbidden" };
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return {
      code: "sign_in_required",
      ok: false,
      profile: null,
      state: "forbidden",
    };
  }

  const { data, error } = await supabase.rpc(
    "resolve_beauty_profile_for_salon_customer",
    {
      p_customer_id: customerId,
      p_salon_id: context.currentSalon.id,
    },
  );

  if (error) {
    if (!relationshipResolverUnavailable(error)) {
      console.warn("Supabase resolve salon customer Beauty profile skipped", {
        code: error.code,
        customerId,
        details: error.details,
        hint: error.hint,
        message: error.message,
        salonId: context.currentSalon.id,
      });
    }

    return {
      code: "database_error",
      ok: false,
      profile: null,
      state: "unavailable",
    };
  }

  return mapProfilePayload(data, customerId);
}

export async function resolveBeautyProfilesForSalonCustomers(input: {
  context?: CurrentBusinessContext | null;
  customerIds: string[];
}) {
  const uniqueCustomerIds = [
    ...new Set(input.customerIds.map(cleanUuid).filter(Boolean)),
  ] as string[];
  const profilesByCustomerId = new Map<string, ResolvedBeautyProfile>();

  if (uniqueCustomerIds.length === 0) {
    return profilesByCustomerId;
  }

  const context = await resolveSalonContext(input.context);

  await Promise.all(
    uniqueCustomerIds.map(async (customerId) => {
      const result = await resolveBeautyProfileForSalonCustomer({
        context,
        customerId,
      });

      if (result.ok && result.profile) {
        profilesByCustomerId.set(customerId, result.profile);
      }
    }),
  );

  return profilesByCustomerId;
}

export async function getPublicBeautyProfile(
  profileId: string,
): Promise<BeautyProfileResolveResult> {
  const cleanProfileId = cleanUuid(profileId);
  const supabase =
    (await createAuthenticatedSupabaseServerClient()) ??
    createSupabaseServerClient();

  if (!cleanProfileId) {
    return {
      code: "invalid_input",
      ok: false,
      profile: null,
      state: "unavailable",
    };
  }

  if (!supabase) {
    return {
      code: "database_error",
      ok: false,
      profile: null,
      state: "unavailable",
    };
  }

  const { data, error } = await supabase.rpc("get_public_beauty_profile", {
    p_profile_id: cleanProfileId,
  });

  if (error) {
    if (!relationshipResolverUnavailable(error)) {
      console.warn("Supabase load public Beauty profile skipped", {
        code: error.code,
        details: error.details,
        hint: error.hint,
        message: error.message,
        profileId: cleanProfileId,
      });
    }

    return {
      code: "database_error",
      ok: false,
      profile: null,
      state: "unavailable",
    };
  }

  return mapProfilePayload(data);
}

export async function getBeautyProfileRoutePage(input: {
  customerId?: string | null;
  profileId: string;
}): Promise<BeautyProfileRoutePage | null> {
  const profileId = cleanUuid(input.profileId);

  if (!profileId) {
    return null;
  }

  const customerId = cleanUuid(input.customerId ?? null);

  let relationshipPublicProfile: ResolvedBeautyProfile | null = null;

  if (customerId) {
    const relationshipResult = await resolveBeautyProfileForSalonCustomer({
      customerId,
    });

    if (
      relationshipResult.ok &&
      relationshipResult.profile &&
      relationshipResult.profile.id === profileId
    ) {
      if (relationshipResult.state === "private") {
        return {
          access: "private_relationship",
          customerId,
          profile: relationshipResult.profile,
          publicPosts: null,
        };
      }

      relationshipPublicProfile = relationshipResult.profile;
    }
  }

  const publicResult = await getPublicBeautyProfile(profileId);
  const publicProfile =
    publicResult.ok && publicResult.profile
      ? publicResult.profile
      : relationshipPublicProfile;

  if (!publicProfile) {
    return null;
  }

  const publicPostPage: ExplorePersonalPostPage = await getExplorePersonalPostPage({
    pageSize: 12,
    profileId,
  });

  return {
    access: "public",
    customerId: null,
    profile: publicProfile,
    publicPosts: publicPostPage.items,
  };
}

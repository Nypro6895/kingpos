import "server-only";

import {
  ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES,
  ACCOUNT_AVATAR_BUCKET,
  ACCOUNT_AVATAR_IMAGE_LIMIT,
  getAccountAvatarPathFromPublicUrl,
  getAccountAvatarPublicUrl,
  isAccountAvatarPathForUser,
  normalizeAccountAvatarPath,
} from "@/lib/account-avatar";
import {
  BEAUTY_ALLOWED_IMAGE_TYPES,
  BEAUTY_IMAGE_LIMIT,
  BEAUTY_MEDIA_BUCKET,
  getBeautyMediaPublicUrl,
  isBeautyMediaPathForUser,
  normalizeBeautyMediaPath,
  type BeautyPostMediaRole,
} from "@/lib/beauty-media";
import {
  createAuthenticatedSupabaseServerClient,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type {
  BeautyAttributionSalon,
  BeautyAttributionStaff,
  BeautyPostAttribution,
  BeautyPostCreateInput,
  BeautyPostMedia,
  BeautyPostMediaInput,
  BeautyPostReward,
  BeautyPostType,
  BeautyPostVerification,
  BeautyProfileSummary,
  BeautyProfileVisibility,
  BeautyRecentVisitCandidate,
  BeautyTimelineCursor,
  BeautyTimelinePage,
  BeautyTimelinePost,
  BeautyVerificationMethod,
  BeautyVerificationState,
} from "@/types/beauty";
import type { KingUser } from "@/types/user";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_DIAGNOSTIC_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const acceptedMimeTypes = new Set<string>(BEAUTY_ALLOWED_IMAGE_TYPES);
const acceptedAccountAvatarMimeTypes = new Set<string>(
  ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES,
);
const BEAUTY_PROFILE_SELECT =
  "id, user_id, bio, cover_media_path, visibility, created_at, updated_at";

type AuthenticatedSupabaseClient = NonNullable<
  Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
>;

type RawRecord = Record<string, unknown>;
type SupabaseErrorDiagnostic = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};
type SupabaseResponseDiagnostic = {
  data?: unknown;
  error?: SupabaseErrorDiagnostic | null;
  status?: number;
  statusText?: string;
};

type BeautyServiceFailureCode =
  | "database_error"
  | "invalid_input"
  | "not_found"
  | "sign_in_required"
  | "upload_error";

export type BeautyServiceResult<T> =
  | {
      data: T;
      ok: true;
    }
  | {
      code: BeautyServiceFailureCode;
      message: string;
      ok: false;
    };

type BeautyProfileRow = {
  bio: string | null;
  cover_media_path: string | null;
  created_at: string;
  id: string;
  updated_at: string;
  user_id: string;
  visibility: string;
};

type StorageObjectMetadata = {
  metadata?: {
    mimetype?: string;
    size?: number;
  };
};

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function readInteger(value: unknown) {
  const parsed = readNumber(value);

  return parsed === null ? null : Math.max(0, Math.round(parsed));
}

function readBoolean(value: unknown) {
  return value === true;
}

function cleanUuid(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function displayNameForUser(user: KingUser) {
  const fullName = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return user.display_name?.trim() || fullName || "Reylumi customer";
}

function initialsFor(label: string | null | undefined) {
  const parts = (label ?? "").trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "R";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
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

function failure<T = never>(
  code: BeautyServiceFailureCode,
  message: string,
): BeautyServiceResult<T> {
  return {
    code,
    message,
    ok: false,
  };
}

function profileVisibility(value: unknown): BeautyProfileVisibility {
  return value === "self" ? "self" : "public";
}

function postType(value: unknown): BeautyPostType {
  return value === "before_after" ? "before_after" : "regular";
}

function verificationState(value: unknown): BeautyVerificationState {
  if (
    value === "pending" ||
    value === "rejected" ||
    value === "unverified" ||
    value === "verified"
  ) {
    return value;
  }

  return "pending";
}

function verificationMethod(value: unknown): BeautyVerificationMethod {
  if (
    value === "booking_checkin" ||
    value === "completed_booking" ||
    value === "none" ||
    value === "pos_ticket"
  ) {
    return value;
  }

  return "none";
}

function mediaRole(value: unknown): BeautyPostMediaRole {
  if (value === "before" || value === "after") {
    return value;
  }

  return "image";
}

function profileFromRow(
  row: BeautyProfileRow,
  user: KingUser,
): BeautyProfileSummary {
  const displayName = displayNameForUser(user);

  return {
    avatarUrl: safeHttpUrl(user.avatar_url),
    bio: row.bio,
    coverImageUrl: mediaUrlForPath(row.cover_media_path),
    coverMediaPath: normalizeBeautyMediaPath(row.cover_media_path),
    createdAt: row.created_at,
    displayName,
    id: row.id,
    initials: initialsFor(displayName),
    isSelf: row.user_id === user.id,
    visibility: profileVisibility(row.visibility),
  };
}

function redactDiagnosticText(value: string | undefined) {
  return value?.replace(UUID_DIAGNOSTIC_PATTERN, "[redacted-uuid]");
}

function supabaseResponseDiagnostic(response: SupabaseResponseDiagnostic) {
  return {
    hasError: Boolean(response.error),
    hasData: Boolean(response.data),
    code: response.error?.code,
    message: redactDiagnosticText(response.error?.message),
    details: redactDiagnosticText(response.error?.details),
    hint: redactDiagnosticText(response.error?.hint),
    status: response.status,
    statusText: response.statusText,
  };
}

function logBeautyProfileDatabaseIssue(
  message: string,
  response: SupabaseResponseDiagnostic,
) {
  if (process.env.NODE_ENV !== "production") {
    console.error(message, supabaseResponseDiagnostic(response));
    return;
  }

  console.error(message);
}

function isExpectedBeautyProfileUserConflict(error: SupabaseErrorDiagnostic | null) {
  if (error?.code !== "23505") {
    return false;
  }

  const conflictText = `${error.message ?? ""}\n${error.details ?? ""}`;
  return (
    conflictText.includes("beauty_profiles_user_id_key") ||
    conflictText.includes("beauty_profiles_user_id") ||
    conflictText.includes("Key (user_id)=")
  );
}

async function getAuthenticatedBeautyContext() {
  const [user, supabase] = await Promise.all([
    getCurrentKingUser(),
    createAuthenticatedSupabaseServerClient(),
  ]);

  if (!user || !supabase) {
    return null;
  }

  return { supabase, user };
}

async function selectOwnBeautyProfile(input: {
  supabase: AuthenticatedSupabaseClient;
  user: KingUser;
}) {
  return input.supabase
    .from("beauty_profiles")
    .select(BEAUTY_PROFILE_SELECT)
    .eq("user_id", input.user.id)
    .maybeSingle<BeautyProfileRow>();
}

async function getOrCreateBeautyProfile(input: {
  supabase: AuthenticatedSupabaseClient;
  user: KingUser;
}) {
  const selectResponse = await selectOwnBeautyProfile(input);

  if (selectResponse.error) {
    logBeautyProfileDatabaseIssue("Beauty profile SELECT failed", selectResponse);
    return null;
  }

  if (selectResponse.data) {
    return selectResponse.data;
  }

  const insertResponse = await input.supabase
    .from("beauty_profiles")
    .insert({
      user_id: input.user.id,
    })
    .select(BEAUTY_PROFILE_SELECT)
    .single<BeautyProfileRow>();

  if (insertResponse.error) {
    if (isExpectedBeautyProfileUserConflict(insertResponse.error)) {
      const recoveryResponse = await selectOwnBeautyProfile(input);

      if (recoveryResponse.error) {
        logBeautyProfileDatabaseIssue(
          "Beauty profile conflict recovery SELECT failed",
          recoveryResponse,
        );
        return null;
      }

      if (!recoveryResponse.data) {
        logBeautyProfileDatabaseIssue(
          "Beauty profile conflict recovery SELECT returned no profile",
          recoveryResponse,
        );
        return null;
      }

      return recoveryResponse.data;
    }

    logBeautyProfileDatabaseIssue("Beauty profile INSERT failed", insertResponse);
    return null;
  }

  if (!insertResponse.data) {
    logBeautyProfileDatabaseIssue(
      "Beauty profile INSERT returned no representation",
      insertResponse,
    );
    return null;
  }

  return insertResponse.data;
}

function emptyTimelinePage(error: string | null = null): BeautyTimelinePage {
  return {
    error,
    hasMore: false,
    items: [],
    nextCursor: null,
  };
}

function normalizeCursor(
  cursor: BeautyTimelineCursor | null | undefined,
): BeautyTimelineCursor | null {
  if (!cursor || !UUID_PATTERN.test(cursor.postId)) {
    return null;
  }

  const date = new Date(cursor.createdAt);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    createdAt: date.toISOString(),
    postId: cursor.postId,
  };
}

function mediaUrlForPath(path: string | null | undefined) {
  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  return getBeautyMediaPublicUrl({
    path,
    supabaseUrl: config.supabaseUrl,
  });
}

function mapMedia(raw: unknown): BeautyPostMedia | null {
  const record = asRecord(raw);
  const id = readString(record.id);
  const objectPath = normalizeBeautyMediaPath(readString(record.objectPath));

  if (!id || !objectPath) {
    return null;
  }

  return {
    displayOrder: readInteger(record.displayOrder) ?? 0,
    height: readInteger(record.height),
    id,
    mimeType: readString(record.mimeType),
    objectPath,
    role: mediaRole(record.role),
    url: mediaUrlForPath(objectPath),
    width: readInteger(record.width),
  };
}

function mapAttribution(raw: unknown): BeautyPostAttribution | null {
  const record = asRecord(raw);
  const salonId = cleanUuid(readString(record.salonId));
  const salonName = readString(record.salonName);

  if (!salonId || !salonName) {
    return null;
  }

  return {
    salonId,
    salonName,
    source: readString(record.source) ?? "customer_claimed",
    staffId: cleanUuid(readString(record.staffId)),
    staffName: readString(record.staffName),
  };
}

function mapVerification(raw: unknown): BeautyPostVerification | null {
  const record = asRecord(raw);
  const state = readString(record.state);

  if (!state) {
    return null;
  }

  return {
    method: verificationMethod(record.method),
    state: verificationState(state),
    verifiedAt: readString(record.verifiedAt),
  };
}

function mapReward(raw: unknown): BeautyPostReward | null {
  const record = asRecord(raw);
  const status = readString(record.status);
  const rewardType = readString(record.rewardType);

  if (!status || !rewardType) {
    return null;
  }

  return {
    createdAt: readString(record.createdAt) ?? "",
    creditAmount: readNumber(record.creditAmount),
    pointsAmount: readInteger(record.pointsAmount) ?? 0,
    rewardType,
    status,
  };
}

function mapTimelinePost(raw: unknown): BeautyTimelinePost | null {
  const record = asRecord(raw);
  const id = cleanUuid(readString(record.id));
  const profileId = cleanUuid(readString(record.profileId));
  const createdAt = readString(record.createdAt);
  const updatedAt = readString(record.updatedAt);
  const author = asRecord(record.author);
  const authorProfileId = cleanUuid(readString(author.profileId));
  const authorDisplayName = readString(author.displayName);

  if (
    !id ||
    !profileId ||
    !createdAt ||
    !updatedAt ||
    !authorProfileId ||
    !authorDisplayName
  ) {
    return null;
  }

  return {
    attribution: mapAttribution(record.attribution),
    author: {
      avatarUrl: safeHttpUrl(readString(author.avatarUrl)),
      displayName: authorDisplayName,
      profileId: authorProfileId,
    },
    caption: readString(record.caption),
    createdAt,
    editedAt: readString(record.editedAt),
    id,
    media: asArray(record.media)
      .map(mapMedia)
      .filter((item): item is BeautyPostMedia => Boolean(item)),
    profileId,
    reward: mapReward(record.reward),
    type: postType(record.type),
    updatedAt,
    verification: mapVerification(record.verification),
    visibility: profileVisibility(record.visibility),
  };
}

function mapTimelinePayload(data: unknown): BeautyTimelinePage {
  const payload = asRecord(data);

  if (payload.ok !== true) {
    return emptyTimelinePage("Beauty timeline could not be loaded.");
  }

  const cursorRecord = asRecord(payload.nextCursor);
  const nextCursor =
    readString(cursorRecord.createdAt) && cleanUuid(readString(cursorRecord.postId))
      ? {
          createdAt: readString(cursorRecord.createdAt) ?? "",
          postId: cleanUuid(readString(cursorRecord.postId)) ?? "",
        }
      : null;

  return {
    error: null,
    hasMore: readBoolean(payload.hasMore),
    items: asArray(payload.items)
      .map(mapTimelinePost)
      .filter((item): item is BeautyTimelinePost => Boolean(item)),
    nextCursor,
  };
}

export async function getBeautyTimelinePage(input: {
  cursor?: BeautyTimelineCursor | null;
  pageSize?: number;
  profileId: string;
}): Promise<BeautyTimelinePage> {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const profileId = cleanUuid(input.profileId);

  if (!supabase || !profileId) {
    return emptyTimelinePage("Beauty timeline could not be loaded.");
  }

  const cursor = normalizeCursor(input.cursor);
  const { data, error } = await supabase.rpc("list_beauty_timeline", {
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_post_id: cursor?.postId ?? null,
    p_page_size: input.pageSize ?? 12,
    p_profile_id: profileId,
  });

  if (error) {
    console.error("Supabase load beauty timeline failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      profileId,
    });

    return emptyTimelinePage("Beauty timeline could not be loaded.");
  }

  return mapTimelinePayload(data);
}

function mapVisitCandidate(raw: unknown): BeautyRecentVisitCandidate | null {
  const record = asRecord(raw);
  const visitKey = readString(record.visitKey);
  const salonId = cleanUuid(readString(record.salonId));
  const salonName = readString(record.salonName);
  const occurredAt = readString(record.occurredAt);
  const source = readString(record.source);

  if (
    !visitKey ||
    !salonId ||
    !salonName ||
    !occurredAt ||
    (source !== "booking" && source !== "check_in" && source !== "receipt")
  ) {
    return null;
  }

  return {
    occurredAt,
    salonId,
    salonName,
    source,
    staffId: cleanUuid(readString(record.staffId)),
    staffName: readString(record.staffName),
    visitKey,
  };
}

export async function getBeautyRecentVisitCandidates(): Promise<
  BeautyRecentVisitCandidate[]
> {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("get_beauty_recent_visit_candidates", {
    p_limit: 8,
  });

  if (error) {
    console.error("Supabase load beauty recent visit candidates failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return [];
  }

  return asArray(data)
    .map(mapVisitCandidate)
    .filter((item): item is BeautyRecentVisitCandidate => Boolean(item));
}

function mapAttributionStaff(raw: unknown): BeautyAttributionStaff | null {
  const record = asRecord(raw);
  const staffId = cleanUuid(readString(record.staffId));
  const staffName = readString(record.staffName);

  if (!staffId || !staffName) {
    return null;
  }

  return { staffId, staffName };
}

function mapAttributionSalon(raw: unknown): BeautyAttributionSalon | null {
  const record = asRecord(raw);
  const salonId = cleanUuid(readString(record.salonId));
  const salonName = readString(record.salonName);

  if (!salonId || !salonName) {
    return null;
  }

  return {
    city: readString(record.city),
    salonId,
    salonName,
    staff: asArray(record.staff)
      .map(mapAttributionStaff)
      .filter((item): item is BeautyAttributionStaff => Boolean(item)),
    state: readString(record.state),
  };
}

export async function searchBeautyAttributionSalons(
  query: string,
): Promise<BeautyAttributionSalon[]> {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase.rpc("search_beauty_attribution_salons", {
    p_limit: 8,
    p_query: query,
  });

  if (error) {
    console.error("Supabase search beauty attribution salons failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      query,
    });
    return [];
  }

  return asArray(data)
    .map(mapAttributionSalon)
    .filter((item): item is BeautyAttributionSalon => Boolean(item));
}

function getStorageParent(path: string) {
  const parts = path.split("/");
  const name = parts.pop() ?? "";

  return {
    folder: parts.join("/"),
    name,
  };
}

async function readStorageObjectMetadata(input: {
  bucket: string;
  path: string;
  supabase: AuthenticatedSupabaseClient;
}) {
  const { folder, name } = getStorageParent(input.path);
  const { data, error } = await input.supabase.storage
    .from(input.bucket)
    .list(folder, { limit: 10, search: name });

  if (error) {
    throw new Error(error.message);
  }

  const object = data?.find((storageObject) => storageObject.name === name);

  if (!object) {
    throw new Error("Uploaded image was not found in Storage.");
  }

  const metadata = (object as StorageObjectMetadata).metadata;

  return {
    bytes: metadata?.size ?? null,
    mimeType: metadata?.mimetype ?? null,
  };
}

async function assertTrustedBeautyMedia(input: {
  media: BeautyPostMediaInput;
  supabase: AuthenticatedSupabaseClient;
  userId: string;
}): Promise<BeautyPostMediaInput> {
  const normalizedPath = normalizeBeautyMediaPath(input.media.objectPath);

  if (
    !normalizedPath ||
    !isBeautyMediaPathForUser({
      path: normalizedPath,
      role: input.media.role,
      userId: input.userId,
    })
  ) {
    throw new Error("Uploaded image does not belong to your Beauty profile.");
  }

  const metadata = await readStorageObjectMetadata({
    bucket: BEAUTY_MEDIA_BUCKET,
    path: normalizedPath,
    supabase: input.supabase,
  });
  const mimeType = metadata.mimeType ?? input.media.mimeType ?? null;
  const bytes = metadata.bytes ?? input.media.bytes ?? null;

  if (mimeType && !acceptedMimeTypes.has(mimeType)) {
    throw new Error("Uploaded image type is not allowed.");
  }

  if (typeof bytes === "number" && bytes > BEAUTY_IMAGE_LIMIT) {
    throw new Error("Uploaded image is too large.");
  }

  return {
    bytes,
    height: input.media.height ?? null,
    mimeType,
    objectPath: normalizedPath,
    role: input.media.role,
    width: input.media.width ?? null,
  };
}

async function assertTrustedBeautyCoverPath(input: {
  path: string | null | undefined;
  supabase: AuthenticatedSupabaseClient;
  userId: string;
}) {
  const normalizedPath = normalizeBeautyMediaPath(input.path);

  if (!normalizedPath) {
    return null;
  }

  if (
    !isBeautyMediaPathForUser({
      path: normalizedPath,
      role: "cover",
      userId: input.userId,
    })
  ) {
    throw new Error("Uploaded cover does not belong to your Beauty profile.");
  }

  const metadata = await readStorageObjectMetadata({
    bucket: BEAUTY_MEDIA_BUCKET,
    path: normalizedPath,
    supabase: input.supabase,
  });

  if (metadata.mimeType && !acceptedMimeTypes.has(metadata.mimeType)) {
    throw new Error("Uploaded cover image type is not allowed.");
  }

  if (typeof metadata.bytes === "number" && metadata.bytes > BEAUTY_IMAGE_LIMIT) {
    throw new Error("Cover image is too large.");
  }

  return normalizedPath;
}

async function assertTrustedAccountAvatarPath(input: {
  path: string | null | undefined;
  supabase: AuthenticatedSupabaseClient;
  userId: string;
}) {
  const normalizedPath = normalizeAccountAvatarPath(input.path);

  if (!normalizedPath) {
    return null;
  }

  if (
    !isAccountAvatarPathForUser({
      path: normalizedPath,
      userId: input.userId,
    })
  ) {
    throw new Error("Uploaded profile photo does not belong to your account.");
  }

  const metadata = await readStorageObjectMetadata({
    bucket: ACCOUNT_AVATAR_BUCKET,
    path: normalizedPath,
    supabase: input.supabase,
  });

  if (
    metadata.mimeType &&
    !acceptedAccountAvatarMimeTypes.has(metadata.mimeType)
  ) {
    throw new Error("Uploaded profile photo type is not allowed.");
  }

  if (
    typeof metadata.bytes === "number" &&
    metadata.bytes > ACCOUNT_AVATAR_IMAGE_LIMIT
  ) {
    throw new Error("Profile photo is too large.");
  }

  return normalizedPath;
}

export async function deleteCurrentBeautyMedia(path: string) {
  const context = await getAuthenticatedBeautyContext();
  const normalizedPath = normalizeBeautyMediaPath(path);

  if (!context || !normalizedPath) {
    return;
  }

  if (
    !isBeautyMediaPathForUser({
      path: normalizedPath,
      userId: context.user.id,
    })
  ) {
    return;
  }

  await context.supabase.storage.from(BEAUTY_MEDIA_BUCKET).remove([normalizedPath]);
}

async function deleteAccountAvatarMedia(input: {
  path: string | null | undefined;
  supabase: AuthenticatedSupabaseClient;
  userId: string;
}) {
  const normalizedPath = normalizeAccountAvatarPath(input.path);

  if (
    !normalizedPath ||
    !isAccountAvatarPathForUser({
      path: normalizedPath,
      userId: input.userId,
    })
  ) {
    return;
  }

  await input.supabase.storage.from(ACCOUNT_AVATAR_BUCKET).remove([normalizedPath]);
}

export async function deleteCurrentBeautyAvatarMedia(path: string) {
  const context = await getAuthenticatedBeautyContext();

  if (!context) {
    return;
  }

  await deleteAccountAvatarMedia({
    path,
    supabase: context.supabase,
    userId: context.user.id,
  });
}

async function cleanupBeautyMedia(paths: string[]) {
  await Promise.all(
    paths.map(async (path) => {
      try {
        await deleteCurrentBeautyMedia(path);
      } catch {
        // Cleanup is best effort; the owner/path checks still run server-side.
      }
    }),
  );
}

export async function createBeautyPost(
  input: BeautyPostCreateInput,
): Promise<
  BeautyServiceResult<{
    postId: string;
    profileId: string;
    rewardIssued: boolean;
    verificationMethod: BeautyVerificationMethod;
    verificationState: BeautyVerificationState;
  }>
> {
  const context = await getAuthenticatedBeautyContext();

  if (!context) {
    return failure("sign_in_required", "Sign in before posting.");
  }

  const caption = typeof input.caption === "string" ? input.caption : null;
  const inputMedia = Array.isArray(input.media) ? input.media : [];

  if (caption && caption.length > 2200) {
    await cleanupBeautyMedia(inputMedia.map((item) => item.objectPath));
    return failure("invalid_input", "Caption is too long.");
  }

  let trustedMedia: BeautyPostMediaInput[];

  try {
    trustedMedia = await Promise.all(
      inputMedia.map((media) =>
        assertTrustedBeautyMedia({
          media,
          supabase: context.supabase,
          userId: context.user.id,
        }),
      ),
    );
  } catch (error) {
    await cleanupBeautyMedia(inputMedia.map((item) => item.objectPath));
    return failure(
      "upload_error",
      error instanceof Error ? error.message : "Uploaded images are not valid.",
    );
  }

  const { data, error } = await context.supabase.rpc("create_beauty_post", {
    p_attribution_source: input.attributionSource ?? "customer_claimed",
    p_caption: caption,
    p_media: trustedMedia.map((media) => ({
      bytes: media.bytes ?? null,
      height: media.height ?? null,
      mimeType: media.mimeType ?? null,
      objectPath: media.objectPath,
      role: media.role,
      width: media.width ?? null,
    })),
    p_post_type: input.postType,
    p_salon_id: cleanUuid(input.salonId ?? null),
    p_staff_id: cleanUuid(input.staffId ?? null),
    p_visibility: "public",
  });

  if (error) {
    await cleanupBeautyMedia(trustedMedia.map((item) => item.objectPath));
    console.error("Supabase create beauty post failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      userId: context.user.id,
    });
    return failure("database_error", "Post could not be created.");
  }

  const payload = asRecord(data);

  if (payload.ok !== true) {
    if (readString(payload.code) !== "duplicate_media_or_reward") {
      await cleanupBeautyMedia(trustedMedia.map((item) => item.objectPath));
    }

    return failure(
      "invalid_input",
      readString(payload.message) ?? "Post could not be created.",
    );
  }

  const postId = cleanUuid(readString(payload.postId));
  const profileId = cleanUuid(readString(payload.profileId));

  if (!postId || !profileId) {
    return failure("database_error", "Post could not be created.");
  }

  return {
    data: {
      postId,
      profileId,
      rewardIssued: readBoolean(payload.rewardIssued),
      verificationMethod: verificationMethod(payload.verificationMethod),
      verificationState: verificationState(payload.verificationState),
    },
    ok: true,
  };
}

export async function updateBeautyProfile(input: {
  avatarPath?: string | null;
  bio?: string | null;
  coverMediaPath?: string | null;
  removeAvatar?: boolean;
  removeCover?: boolean;
  visibility?: BeautyProfileVisibility;
}): Promise<BeautyServiceResult<BeautyProfileSummary>> {
  const context = await getAuthenticatedBeautyContext();

  if (!context) {
    return failure("sign_in_required", "Sign in before updating your profile.");
  }

  const current = await getOrCreateBeautyProfile(context);

  if (!current) {
    return failure("database_error", "Beauty profile could not be loaded.");
  }

  const bio = input.bio === undefined ? current.bio : input.bio?.trim() || null;

  if (bio && bio.length > 500) {
    return failure("invalid_input", "Bio is too long.");
  }

  let trustedCoverPath: string | null = null;
  let trustedAvatarPath: string | null = null;

  try {
    [trustedCoverPath, trustedAvatarPath] = await Promise.all([
      input.removeCover
        ? Promise.resolve(null)
        : assertTrustedBeautyCoverPath({
            path: input.coverMediaPath,
            supabase: context.supabase,
            userId: context.user.id,
          }),
      input.removeAvatar
        ? Promise.resolve(null)
        : assertTrustedAccountAvatarPath({
            path: input.avatarPath,
            supabase: context.supabase,
            userId: context.user.id,
          }),
    ]);
  } catch (error) {
    await Promise.all([
      cleanupBeautyMedia([input.coverMediaPath ?? ""].filter(Boolean)),
      deleteAccountAvatarMedia({
        path: input.avatarPath,
        supabase: context.supabase,
        userId: context.user.id,
      }),
    ]);
    return failure(
      "upload_error",
      error instanceof Error ? error.message : "Uploaded profile image is not valid.",
    );
  }

  const config = getSupabaseConfig();
  const oldCoverPath = normalizeBeautyMediaPath(current.cover_media_path);
  const nextCoverPath = input.removeCover
    ? null
    : (trustedCoverPath ?? oldCoverPath);
  let nextUser = context.user;
  let oldAvatarPath: string | null = null;

  if ((input.removeAvatar || trustedAvatarPath) && !config) {
    let canDeleteNewAvatar = Boolean(trustedAvatarPath);

    if (input.removeAvatar || trustedAvatarPath) {
      const { error: rollbackError } = await context.supabase
        .from("users")
        .update({ avatar_url: context.user.avatar_url })
        .eq("id", context.user.id);

      if (rollbackError) {
        canDeleteNewAvatar = false;
        console.warn("Supabase rollback Beauty avatar failed", {
          code: rollbackError.code,
          details: rollbackError.details,
          hint: rollbackError.hint,
          message: rollbackError.message,
          userId: context.user.id,
        });
      }
    }

    await Promise.all([
      cleanupBeautyMedia([trustedCoverPath ?? ""].filter(Boolean)),
      trustedAvatarPath && canDeleteNewAvatar
        ? deleteAccountAvatarMedia({
            path: trustedAvatarPath,
            supabase: context.supabase,
            userId: context.user.id,
          })
        : Promise.resolve(),
    ]);
    return failure("database_error", "Profile photo could not be updated.");
  }

  if (input.removeAvatar || trustedAvatarPath) {
    const nextAvatarUrl = input.removeAvatar
      ? null
      : getAccountAvatarPublicUrl({
          path: trustedAvatarPath ?? "",
          supabaseUrl: config?.supabaseUrl ?? "",
        });

    oldAvatarPath = config
      ? getAccountAvatarPathFromPublicUrl({
          supabaseUrl: config.supabaseUrl,
          url: context.user.avatar_url,
        })
      : null;

    const { error: avatarError } = await context.supabase
      .from("users")
      .update({ avatar_url: nextAvatarUrl })
      .eq("id", context.user.id);

    if (avatarError) {
      console.error("Supabase update Beauty avatar failed", {
        code: avatarError.code,
        details: avatarError.details,
        hint: avatarError.hint,
        message: avatarError.message,
        userId: context.user.id,
      });
      await Promise.all([
        cleanupBeautyMedia([trustedCoverPath ?? ""].filter(Boolean)),
        trustedAvatarPath
          ? deleteAccountAvatarMedia({
              path: trustedAvatarPath,
              supabase: context.supabase,
              userId: context.user.id,
            })
          : Promise.resolve(),
      ]);
      return failure("database_error", "Profile photo could not be updated.");
    }

    nextUser = {
      ...context.user,
      avatar_url: nextAvatarUrl,
    };
  }

  const { data, error } = await context.supabase
    .from("beauty_profiles")
    .update({
      bio,
      cover_media_path: nextCoverPath,
      visibility: input.visibility ?? current.visibility,
    })
    .eq("id", current.id)
    .eq("user_id", context.user.id)
    .select(BEAUTY_PROFILE_SELECT)
    .single<BeautyProfileRow>();

  if (error || !data) {
    console.error("Supabase update beauty profile failed", {
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      message: error?.message,
      profileId: current.id,
      userId: context.user.id,
    });

    await Promise.all([
      cleanupBeautyMedia([trustedCoverPath ?? ""].filter(Boolean)),
      trustedAvatarPath
        ? deleteAccountAvatarMedia({
            path: trustedAvatarPath,
            supabase: context.supabase,
            userId: context.user.id,
          })
        : Promise.resolve(),
    ]);

    return failure("database_error", "Beauty profile could not be updated.");
  }

  await Promise.all([
    (trustedCoverPath || input.removeCover) &&
    oldCoverPath &&
    oldCoverPath !== nextCoverPath
      ? deleteCurrentBeautyMedia(oldCoverPath)
      : Promise.resolve(),
    (trustedAvatarPath || input.removeAvatar) &&
    oldAvatarPath &&
    oldAvatarPath !== trustedAvatarPath
      ? deleteAccountAvatarMedia({
          path: oldAvatarPath,
          supabase: context.supabase,
          userId: context.user.id,
        })
      : Promise.resolve(),
  ]);

  return {
    data: profileFromRow(data, nextUser),
    ok: true,
  };
}

export async function updateBeautyPostCaption(input: {
  caption: string | null;
  postId: string;
}): Promise<BeautyServiceResult<true>> {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const postId = cleanUuid(input.postId);

  if (!supabase || !postId) {
    return failure("sign_in_required", "Sign in before editing this post.");
  }

  const { data, error } = await supabase.rpc("update_beauty_post_caption", {
    p_caption: input.caption ?? null,
    p_post_id: postId,
  });

  if (error) {
    return failure("database_error", "Post could not be updated.");
  }

  const payload = asRecord(data);

  if (payload.ok !== true) {
    return failure(
      readString(payload.code) === "not_found" ? "not_found" : "invalid_input",
      "Post could not be updated.",
    );
  }

  return { data: true, ok: true };
}

export async function deleteBeautyPost(
  postId: string,
): Promise<BeautyServiceResult<true>> {
  const supabase = await createAuthenticatedSupabaseServerClient();
  const cleanPostId = cleanUuid(postId);

  if (!supabase || !cleanPostId) {
    return failure("sign_in_required", "Sign in before deleting this post.");
  }

  const { data, error } = await supabase.rpc("delete_beauty_post", {
    p_post_id: cleanPostId,
  });

  if (error) {
    return failure("database_error", "Post could not be deleted.");
  }

  const payload = asRecord(data);

  if (payload.ok !== true) {
    return failure(
      readString(payload.code) === "not_found" ? "not_found" : "invalid_input",
      "Post could not be deleted.",
    );
  }

  await cleanupBeautyMedia(
    asArray(payload.mediaPaths)
      .map(readString)
      .filter((path): path is string => Boolean(path)),
  );

  return { data: true, ok: true };
}

export async function getSelfBeautyProfilePage(): Promise<
  BeautyServiceResult<{
    profile: BeautyProfileSummary;
    timeline: BeautyTimelinePage;
    visitCandidates: BeautyRecentVisitCandidate[];
  }>
> {
  const context = await getAuthenticatedBeautyContext();

  if (!context) {
    return failure("sign_in_required", "Sign in to view your Beauty profile.");
  }

  const profileRow = await getOrCreateBeautyProfile(context);

  if (!profileRow) {
    return failure("database_error", "Beauty profile could not be loaded.");
  }

  const profile = profileFromRow(profileRow, context.user);
  const [timeline, visitCandidates] = await Promise.all([
    getBeautyTimelinePage({ profileId: profile.id }),
    getBeautyRecentVisitCandidates(),
  ]);

  return {
    data: {
      profile,
      timeline,
      visitCandidates,
    },
    ok: true,
  };
}

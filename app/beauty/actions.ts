"use server";
import { postModerationAction } from "@/app/post-moderation/actions";
import { PUBLIC_IMAGE_QUARANTINE_BUCKET, publicImageQuarantinePath } from "@/lib/public-image-staging";

import {
  ACCOUNT_AVATAR_BUCKET,
  buildAccountAvatarPath,
  getAccountAvatarPublicUrl,
} from "@/lib/account-avatar";
import {
  createBeautyPost,
  deleteCurrentBeautyAvatarMedia,
  deleteCurrentBeautyMedia,
  getBeautyTimelinePage,
  searchBeautyAttributionSalons,
  updateBeautyProfile,
} from "@/lib/beauty";
import {
  BEAUTY_MEDIA_BUCKET,
  BEAUTY_UPLOAD_ROLES,
  buildBeautyMediaPath,
  type BeautyUploadRole,
} from "@/lib/beauty-media";
import {
  getAccessTokenFromRequest,
  getSupabaseConfig,
  createAuthenticatedSupabaseServerClient,
} from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type {
  BeautyAttributionSalon,
  BeautyPostCreateInput,
  BeautyProfileSummary,
  BeautyProfileVisibility,
  BeautyTimelineCursor,
  BeautyTimelinePage,
} from "@/types/beauty";
import { revalidatePath } from "next/cache";

export type BeautyMediaUploadSession = {
  accessToken: string;
  anonKey: string;
  bucket: string;
  path: string;
  objectPath?: string;
  supabaseUrl: string;
};

export type BeautyAvatarUploadSession = BeautyMediaUploadSession & {
  publicUrl: string;
};

export type BeautyMutationResult<T extends object = object> =
  | ({ error: null } & T)
  | { error: string; outcome?: "rejected" | "unknown"; requestId?: string };

function isBeautyUploadRole(value: string): value is BeautyUploadRole {
  return BEAUTY_UPLOAD_ROLES.includes(value as BeautyUploadRole);
}

export async function getBeautyMediaUploadSessionAction(
  role: BeautyUploadRole,
): Promise<BeautyMediaUploadSession> {
  const [accessToken, user] = await Promise.all([
    getAccessTokenFromRequest(),
    getCurrentKingUser(),
  ]);
  const config = getSupabaseConfig();

  if (!config || !accessToken || !user) {
    throw new Error("Sign in before uploading Beauty photos.");
  }

  if (!isBeautyUploadRole(role)) {
    throw new Error("Upload role is not valid.");
  }

  const path = buildBeautyMediaPath({
    role,
    userId: user.id,
  });

  if (role !== "cover") {
    const client = await createAuthenticatedSupabaseServerClient();
    if (!client) throw new Error("Photo uploads are temporarily unavailable.");
    const { error } = await client.rpc("reserve_public_post_image", {
      p_bucket: BEAUTY_MEDIA_BUCKET, p_path: path, p_purpose: role, p_salon_id: null,
    });
    if (error) throw new Error("Photo uploads are temporarily unavailable. Please try again.");
  }

  return {
    accessToken,
    anonKey: config.supabaseAnonKey,
    bucket: role === "cover" ? BEAUTY_MEDIA_BUCKET : PUBLIC_IMAGE_QUARANTINE_BUCKET,
    path: role === "cover" ? path : publicImageQuarantinePath(BEAUTY_MEDIA_BUCKET, path),
    objectPath: path,
    supabaseUrl: config.supabaseUrl,
  };
}

export async function getBeautyAvatarUploadSessionAction(): Promise<BeautyAvatarUploadSession> {
  const [accessToken, user] = await Promise.all([
    getAccessTokenFromRequest(),
    getCurrentKingUser(),
  ]);
  const config = getSupabaseConfig();

  if (!config || !accessToken || !user) {
    throw new Error("Sign in before uploading a profile photo.");
  }

  const path = buildAccountAvatarPath(user.id);

  return {
    accessToken,
    anonKey: config.supabaseAnonKey,
    bucket: ACCOUNT_AVATAR_BUCKET,
    path,
    publicUrl: getAccountAvatarPublicUrl({
      bucket: ACCOUNT_AVATAR_BUCKET,
      path,
      supabaseUrl: config.supabaseUrl,
    }),
    supabaseUrl: config.supabaseUrl,
  };
}

export async function deleteBeautyMediaAction(path: string) {
  await deleteCurrentBeautyMedia(path);
}

export async function deleteBeautyAvatarMediaAction(path: string) {
  await deleteCurrentBeautyAvatarMedia(path);
}

export async function updateBeautyProfileAction(input: {
  avatarPath?: string | null;
  bio?: string | null;
  coverMediaPath?: string | null;
  removeAvatar?: boolean;
  removeCover?: boolean;
  visibility?: BeautyProfileVisibility;
}): Promise<BeautyMutationResult<{ profile: BeautyProfileSummary }>> {
  const result = await updateBeautyProfile({
    avatarPath: input.avatarPath ?? null,
    bio: input.bio ?? null,
    coverMediaPath: input.coverMediaPath ?? null,
    removeAvatar: input.removeAvatar === true,
    removeCover: input.removeCover === true,
    visibility: input.visibility ?? undefined,
  });

  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/beauty");
  revalidatePath("/beauty/library");
  revalidatePath("/account");
  revalidatePath("/explore");
  revalidatePath(`/explore/beauty/${result.data.id}`);
  revalidatePath("/", "layout");

  return {
    error: null,
    profile: result.data,
  };
}

export async function createBeautyPostAction(
  input: BeautyPostCreateInput,
): Promise<
  BeautyMutationResult<{
    timeline: BeautyTimelinePage;
    publicationStatus?: "published";
    requestId?: string;
    postId?: string;
  }>
> {
  const result = await createBeautyPost(input);

  if (!result.ok) {
    return { error: result.message, outcome: result.outcome ?? "rejected", requestId: input.requestId };
  }

  try {
    const timeline = await getBeautyTimelinePage({ profileId: result.data.profileId });
    if (timeline.error) return { error: "Your post was saved, but the feed could not be refreshed. Retry to check this same post safely.", outcome: "unknown", requestId: input.requestId };

    revalidatePath("/beauty");
    revalidatePath("/beauty/library");

    return { error: null, timeline, publicationStatus: "published", requestId: input.requestId, postId: result.data.postId };
  } catch {
    return { error: "Your post was saved, but the feed could not be refreshed. Retry to check this same post safely.", outcome: "unknown", requestId: input.requestId };
  }
}

export async function loadBeautyTimelineAction(
  profileId: string,
  cursor: BeautyTimelineCursor | null,
): Promise<BeautyTimelinePage> {
  return getBeautyTimelinePage({
    cursor,
    profileId,
  });
}

export async function searchBeautyAttributionSalonsAction(
  query: string,
): Promise<BeautyAttributionSalon[]> {
  return searchBeautyAttributionSalons(query);
}

/** Compatibility entry points for older loaded clients; mutations have one implementation. */
export async function updateBeautyPostCaptionAction(input: {
  caption: string | null;
  postId: string;
}): Promise<BeautyMutationResult> {
  const result = await postModerationAction({ sourceType: "beauty_post", sourceId: input.postId }, "edit", { caption: input.caption });
  return { error: result.error };
}

export async function deleteBeautyPostAction(postId: string): Promise<BeautyMutationResult> {
  const result = await postModerationAction({ sourceType: "beauty_post", sourceId: postId }, "delete");
  return { error: result.error };
}

"use server";

import {
  ACCOUNT_AVATAR_BUCKET,
  buildAccountAvatarPath,
  getAccountAvatarPublicUrl,
} from "@/lib/account-avatar";
import {
  createBeautyPost,
  deleteCurrentBeautyAvatarMedia,
  deleteBeautyPost,
  deleteCurrentBeautyMedia,
  getBeautyTimelinePage,
  searchBeautyAttributionSalons,
  updateBeautyPostCaption,
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
} from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import type {
  BeautyAttributionSalon,
  BeautyPostCreateInput,
  BeautyProfileSummary,
  BeautyTimelineCursor,
  BeautyTimelinePage,
} from "@/types/beauty";
import { revalidatePath } from "next/cache";

export type BeautyMediaUploadSession = {
  accessToken: string;
  anonKey: string;
  bucket: string;
  path: string;
  supabaseUrl: string;
};

export type BeautyAvatarUploadSession = BeautyMediaUploadSession & {
  publicUrl: string;
};

export type BeautyMutationResult<T extends object = object> =
  | ({ error: null } & T)
  | { error: string };

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

  return {
    accessToken,
    anonKey: config.supabaseAnonKey,
    bucket: BEAUTY_MEDIA_BUCKET,
    path,
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
}): Promise<BeautyMutationResult<{ profile: BeautyProfileSummary }>> {
  const result = await updateBeautyProfile({
    avatarPath: input.avatarPath ?? null,
    bio: input.bio ?? null,
    coverMediaPath: input.coverMediaPath ?? null,
    removeAvatar: input.removeAvatar === true,
    removeCover: input.removeCover === true,
    visibility: "public",
  });

  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/beauty");
  revalidatePath("/account");
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
  }>
> {
  const result = await createBeautyPost(input);

  if (!result.ok) {
    return { error: result.message };
  }

  const timeline = await getBeautyTimelinePage({
    profileId: result.data.profileId,
  });

  revalidatePath("/beauty");

  return {
    error: null,
    timeline,
  };
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

export async function updateBeautyPostCaptionAction(input: {
  caption: string | null;
  postId: string;
}): Promise<BeautyMutationResult> {
  const result = await updateBeautyPostCaption(input);

  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/beauty");

  return { error: null };
}

export async function deleteBeautyPostAction(
  postId: string,
): Promise<BeautyMutationResult> {
  const result = await deleteBeautyPost(postId);

  if (!result.ok) {
    return { error: result.message };
  }

  revalidatePath("/beauty");

  return { error: null };
}

export const ACCOUNT_AVATAR_BUCKET = "account-avatars";

export const ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const ACCOUNT_AVATAR_IMAGE_LIMIT = 8 * 1024 * 1024;

export function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function buildAccountAvatarPath(userId: string) {
  return `${userId}/avatar/${crypto.randomUUID()}.webp`;
}

export function getAccountAvatarPublicUrl(input: {
  bucket?: string;
  path: string;
  supabaseUrl: string;
}) {
  const bucket = input.bucket ?? ACCOUNT_AVATAR_BUCKET;

  return `${input.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(
    bucket,
  )}/${encodeStoragePath(input.path)}`;
}

export function safeAccountAvatarUrl(value: string | null | undefined) {
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

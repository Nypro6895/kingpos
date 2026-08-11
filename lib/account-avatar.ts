export const ACCOUNT_AVATAR_BUCKET = "account-avatars";

export const ACCOUNT_AVATAR_ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const ACCOUNT_AVATAR_IMAGE_LIMIT = 8 * 1024 * 1024;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function hasUnsafePathSyntax(value: string) {
  return (
    value.startsWith("/") ||
    value.includes("://") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  );
}

export function normalizeAccountAvatarPath(value: string | null | undefined) {
  const path = value?.trim() ?? "";

  if (!path || hasUnsafePathSyntax(path)) {
    return null;
  }

  return path;
}

export function buildAccountAvatarPath(userId: string) {
  return `${userId}/avatar/${crypto.randomUUID()}.webp`;
}

export function parseAccountAvatarPath(value: string | null | undefined) {
  const path = normalizeAccountAvatarPath(value);

  if (!path) {
    return null;
  }

  const parts = path.split("/");

  if (
    parts.length !== 3 ||
    !UUID_PATTERN.test(parts[0] ?? "") ||
    parts[1] !== "avatar" ||
    !parts[2]?.endsWith(".webp")
  ) {
    return null;
  }

  return {
    userId: parts[0],
  };
}

export function isAccountAvatarPathForUser(input: {
  path: string | null | undefined;
  userId: string;
}) {
  const parsed = parseAccountAvatarPath(input.path);

  return Boolean(parsed && parsed.userId === input.userId);
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

export function getAccountAvatarPathFromPublicUrl(input: {
  supabaseUrl: string;
  url: string | null | undefined;
}) {
  if (!input.url) {
    return null;
  }

  try {
    const baseUrl = new URL(input.supabaseUrl);
    const url = new URL(input.url);
    const prefix = `/storage/v1/object/public/${ACCOUNT_AVATAR_BUCKET}/`;

    if (url.origin !== baseUrl.origin || !url.pathname.startsWith(prefix)) {
      return null;
    }

    const path = url.pathname
      .slice(prefix.length)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .join("/");

    return normalizeAccountAvatarPath(path);
  } catch {
    return null;
  }
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

export const BEAUTY_MEDIA_BUCKET = "beauty-profile-media";

export const BEAUTY_ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const BEAUTY_IMAGE_LIMIT = 15 * 1024 * 1024;

export const BEAUTY_UPLOAD_ROLES = ["image", "before", "after", "cover"] as const;
export const BEAUTY_POST_MEDIA_ROLES = ["image", "before", "after"] as const;

export type BeautyUploadRole = (typeof BEAUTY_UPLOAD_ROLES)[number];
export type BeautyPostMediaRole = (typeof BEAUTY_POST_MEDIA_ROLES)[number];

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

export function normalizeBeautyMediaPath(value: string | null | undefined) {
  const path = value?.trim() ?? "";

  if (!path || hasUnsafePathSyntax(path)) {
    return null;
  }

  return path;
}

export function buildBeautyMediaPath(input: {
  role: BeautyUploadRole;
  userId: string;
}) {
  if (!BEAUTY_UPLOAD_ROLES.includes(input.role)) {
    throw new Error("Beauty media role is not valid.");
  }

  return `${input.userId}/beauty/${input.role}/${crypto.randomUUID()}.webp`;
}

export function parseBeautyMediaPath(value: string | null | undefined) {
  const path = normalizeBeautyMediaPath(value);

  if (!path) {
    return null;
  }

  const parts = path.split("/");

  if (
    parts.length !== 4 ||
    !UUID_PATTERN.test(parts[0] ?? "") ||
    parts[1] !== "beauty" ||
    !BEAUTY_UPLOAD_ROLES.includes(parts[2] as BeautyUploadRole) ||
    !parts[3]?.endsWith(".webp")
  ) {
    return null;
  }

  return {
    role: parts[2] as BeautyUploadRole,
    userId: parts[0],
  };
}

export function isBeautyMediaPathForUser(input: {
  path: string | null | undefined;
  role?: BeautyUploadRole;
  userId: string;
}) {
  const parsed = parseBeautyMediaPath(input.path);

  if (!parsed || parsed.userId !== input.userId) {
    return false;
  }

  return input.role ? parsed.role === input.role : true;
}

export function getBeautyMediaPublicUrl(input: {
  bucket?: string;
  path: string | null | undefined;
  supabaseUrl: string;
}) {
  const path = normalizeBeautyMediaPath(input.path);

  if (!path) {
    return null;
  }

  const bucket = input.bucket ?? BEAUTY_MEDIA_BUCKET;

  return `${input.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(
    bucket,
  )}/${encodeStoragePath(path)}`;
}

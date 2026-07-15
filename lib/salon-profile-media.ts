export const SALON_PROFILE_MEDIA_BUCKET = "salon-profile-media";

export const SALON_PROFILE_ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const SALON_PROFILE_IMAGE_LIMITS = {
  cover: 15 * 1024 * 1024,
  logo: 8 * 1024 * 1024,
  look: 15 * 1024 * 1024,
  update: 15 * 1024 * 1024,
} as const;

export type SalonProfileMediaKind = keyof typeof SALON_PROFILE_IMAGE_LIMITS;

export type ParsedSalonProfileMediaPath = {
  kind: SalonProfileMediaKind | "legacy";
  salonId: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string | undefined) {
  return Boolean(value && UUID_PATTERN.test(value));
}

function hasUnsafePathSyntax(value: string) {
  return (
    value.startsWith("/") ||
    value.includes("://") ||
    value.includes("\\") ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  );
}

export function normalizeSalonProfileMediaPath(value: string | null | undefined) {
  const path = value?.trim() ?? "";

  if (!path || hasUnsafePathSyntax(path)) {
    return null;
  }

  return path;
}

export function buildSalonProfileMediaPath(input: {
  kind: SalonProfileMediaKind;
  salonId: string;
}) {
  const id = crypto.randomUUID();

  switch (input.kind) {
    case "logo":
      return `${input.salonId}/profile/logo/${id}.webp`;
    case "cover":
      return `${input.salonId}/profile/cover/${id}.webp`;
    case "look":
      return `${input.salonId}/looks/${id}/${crypto.randomUUID()}.webp`;
    case "update":
      return `${input.salonId}/updates/${id}.webp`;
  }
}

export function parseSalonProfileMediaPath(
  value: string | null | undefined,
): ParsedSalonProfileMediaPath | null {
  const path = normalizeSalonProfileMediaPath(value);

  if (!path) {
    return null;
  }

  const parts = path.split("/");

  if (!isUuid(parts[0])) {
    return null;
  }

  if (
    parts.length === 4 &&
    parts[1] === "profile" &&
    (parts[2] === "logo" || parts[2] === "cover") &&
    parts[3].endsWith(".webp")
  ) {
    return {
      kind: parts[2],
      salonId: parts[0],
    };
  }

  if (
    parts.length === 4 &&
    parts[1] === "looks" &&
    isUuid(parts[2]) &&
    parts[3].endsWith(".webp")
  ) {
    return {
      kind: "look",
      salonId: parts[0],
    };
  }

  if (parts.length === 3 && parts[1] === "updates" && parts[2].endsWith(".webp")) {
    return {
      kind: "update",
      salonId: parts[0],
    };
  }

  if (
    parts.length >= 4 &&
    isUuid(parts[1]) &&
    (parts[2] === "identity" || parts[2] === "looks")
  ) {
    return {
      kind: "legacy",
      salonId: parts[1],
    };
  }

  return null;
}

export function isSalonProfileMediaPathForSalon(input: {
  allowedKinds?: SalonProfileMediaKind[];
  path: string | null | undefined;
  salonId: string;
}) {
  const parsed = parseSalonProfileMediaPath(input.path);

  if (!parsed || parsed.salonId !== input.salonId) {
    return false;
  }

  if (!input.allowedKinds || parsed.kind === "legacy") {
    return true;
  }

  return input.allowedKinds.includes(parsed.kind);
}

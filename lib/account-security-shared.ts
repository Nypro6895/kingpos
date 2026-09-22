export const ACCOUNT_LOGIN_SESSION_COOKIE = "kingpos-login-session-id";

export type LoginDeviceType = "desktop" | "mobile" | "tablet" | "unknown";

export type LoginRequestSnapshot = {
  browserName: string;
  city: string | null;
  country: string | null;
  deviceLabel: string;
  deviceType: LoginDeviceType;
  ipAddress: string | null;
  locationLabel: string;
  osName: string;
  region: string | null;
  userAgent: string | null;
};

type HeaderReader = Pick<Headers, "get">;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readHeader(headers: HeaderReader, name: string) {
  const value = headers.get(name);

  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function cleanHeaderValue(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (!trimmed || trimmed.toLowerCase() === "unknown") {
    return null;
  }

  try {
    return decodeURIComponent(trimmed.replace(/\+/g, " "));
  } catch {
    return trimmed;
  }
}

function firstForwardedIp(value: string | null) {
  const first = value?.split(",")[0]?.trim();

  if (!first || first.toLowerCase() === "unknown") {
    return null;
  }

  return first;
}

function pickHeader(headers: HeaderReader, names: string[]) {
  for (const name of names) {
    const value = cleanHeaderValue(readHeader(headers, name));

    if (value) {
      return value;
    }
  }

  return null;
}

export function isAccountLoginSessionId(
  value: string | null | undefined,
): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

export function parseLoginUserAgent(userAgent: string | null | undefined) {
  const agent = userAgent ?? "";
  const lower = agent.toLowerCase();
  const deviceType: LoginDeviceType =
    /ipad|tablet/.test(lower)
      ? "tablet"
      : /mobile|iphone|android/.test(lower)
        ? "mobile"
        : agent
          ? "desktop"
          : "unknown";
  const osName = /windows nt/i.test(agent)
    ? "Windows"
    : /iphone|ipad|ipod/i.test(agent)
      ? "iOS"
      : /android/i.test(agent)
        ? "Android"
        : /mac os x|macintosh/i.test(agent)
          ? "macOS"
          : /linux/i.test(agent)
            ? "Linux"
            : "Unknown OS";
  const browserName = /edg\//i.test(agent)
    ? "Edge"
    : /opr\//i.test(agent)
      ? "Opera"
      : /firefox\//i.test(agent)
        ? "Firefox"
        : /samsungbrowser\//i.test(agent)
          ? "Samsung Internet"
          : /chrome\//i.test(agent) || /crios\//i.test(agent)
            ? "Chrome"
            : /safari\//i.test(agent)
              ? "Safari"
              : "Unknown browser";
  const deviceLabel =
    browserName === "Unknown browser" && osName === "Unknown OS"
      ? "Unknown device"
      : `${browserName} on ${osName}`;

  return {
    browserName,
    deviceLabel,
    deviceType,
    osName,
  };
}

export function getLoginLocationFromHeaders(headers: HeaderReader) {
  const city = pickHeader(headers, [
    "x-vercel-ip-city",
    "cf-ipcity",
    "x-geo-city",
    "x-appengine-city",
  ]);
  const region = pickHeader(headers, [
    "x-vercel-ip-country-region",
    "cf-region",
    "x-geo-region",
    "x-appengine-region",
  ]);
  const country = pickHeader(headers, [
    "x-vercel-ip-country",
    "cf-ipcountry",
    "x-geo-country",
    "x-appengine-country",
  ]);
  const parts = [city, region, country].filter(Boolean);

  return {
    city,
    country,
    locationLabel: parts.length > 0 ? parts.join(", ") : "Unknown location",
    region,
  };
}

export function getClientIpFromHeaders(headers: HeaderReader) {
  return (
    firstForwardedIp(readHeader(headers, "x-forwarded-for")) ??
    firstForwardedIp(readHeader(headers, "x-real-ip")) ??
    firstForwardedIp(readHeader(headers, "cf-connecting-ip"))
  );
}

export function getLoginRequestSnapshot(
  headers: HeaderReader,
): LoginRequestSnapshot {
  const userAgent = readHeader(headers, "user-agent");
  const device = parseLoginUserAgent(userAgent);
  const location = getLoginLocationFromHeaders(headers);

  return {
    ...device,
    ...location,
    ipAddress: getClientIpFromHeaders(headers),
    userAgent,
  };
}

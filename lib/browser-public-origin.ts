import { getPublicAppOrigin } from "./public-app-url";

/** QR links leave the installed app; ordinary web pages retain their own origin. */
export function browserPublicOrigin(): string {
  if (typeof location === "undefined") return getPublicAppOrigin();
  if (location.protocol === "reylumi-app:" && location.hostname === "bundle") return getPublicAppOrigin();
  return location.origin;
}

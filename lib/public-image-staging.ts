/** Only social post photos use this bucket. Business records and identity media do not. */
export const PUBLIC_IMAGE_QUARANTINE_BUCKET = "public-image-quarantine";
export type PublicPostImageBucket = "beauty-profile-media" | "salon-profile-media";

/** Older loaded clients submit session.path. Accept its quarantine prefix while
 * retaining all later ownership/purpose checks and storing only the final path. */
export function publicImageFinalPath(bucket: PublicPostImageBucket, path: string) {
  return typeof path === "string" && path.startsWith(`${bucket}/`) ? path.slice(bucket.length + 1) : path;
}

export function publicImageQuarantinePath(bucket: PublicPostImageBucket, objectPath: string) {
  if (!objectPath || objectPath.startsWith("/") || objectPath.includes("\\") ||
    objectPath.includes(":") || objectPath.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error("Photo path is not valid.");
  }
  return `${bucket}/${objectPath}`;
}

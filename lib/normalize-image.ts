import "server-only";
import sharp from "sharp";
import { IMAGE_POLICY, type ImageBounds } from "./image-policy";

/** Decode the actual bytes, auto-orient, strip metadata, and enforce an output byte ceiling. */
export async function normalizeImage(input: Uint8Array, bounds: ImageBounds = {}) {
  if (!input.byteLength || input.byteLength > IMAGE_POLICY.maxInputBytes)
    throw new Error("Choose an image under 10 MB.");
  const source = sharp(input, { animated: true, limitInputPixels: IMAGE_POLICY.maxInputPixels, failOn: "error" });
  const metadata = await source.metadata();
  if (!metadata.format || !["jpeg", "png", "webp", "gif"].includes(metadata.format))
    throw new Error("Choose a JPG, PNG, WebP or GIF image.");
  // Bound animation work; preserve movement instead of silently flattening the first frame.
  if ((metadata.pages ?? 1) > 100)
    throw new Error("This animation is too long. Choose an animation with at most 100 frames.");
  let width = Math.min(bounds.maxWidth ?? IMAGE_POLICY.maxEdge, IMAGE_POLICY.maxEdge);
  let height = Math.min(bounds.maxHeight ?? IMAGE_POLICY.maxEdge, IMAGE_POLICY.maxEdge);
  const target = Math.min(bounds.targetBytes ?? IMAGE_POLICY.targetBytes, IMAGE_POLICY.maxBytes);
  if (metadata.format === "webp" && input.byteLength <= target &&
    (metadata.width ?? Infinity) <= width && (metadata.pageHeight ?? metadata.height ?? Infinity) <= height &&
    !metadata.exif && !metadata.icc && !metadata.xmp)
    return { data: Buffer.from(input), width: metadata.width!, height: (metadata.pageHeight ?? metadata.height)!, bytes: input.byteLength, mimeType: "image/webp" as const };
  for (let size = 0; size < 9; size++) {
    for (const quality of [IMAGE_POLICY.quality, 72, IMAGE_POLICY.minQuality]) {
      const { data, info } = await source.clone().rotate()
        .resize(width, height, { fit: "inside", withoutEnlargement: true })
        .webp({ quality, effort: 4 }).toBuffer({ resolveWithObject: true });
      if (data.length <= target || (quality === IMAGE_POLICY.minQuality && data.length <= IMAGE_POLICY.maxBytes))
        return { data, width: info.width, height: info.pageHeight ?? info.height, bytes: data.length, mimeType: "image/webp" as const };
    }
    width = Math.max(1, Math.floor(width * .8));
    height = Math.max(1, Math.floor(height * .8));
  }
  throw new Error("This image could not be reduced safely. Please choose another image.");
}

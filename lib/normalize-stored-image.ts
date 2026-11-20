import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { IMAGE_POLICY } from "./image-policy";
import { normalizeImage } from "./normalize-image";

function normalizedName(bytes: Uint8Array) {
  // Existing cover constraints require a UUID-shaped filename. Keep that contract.
  const hash = createHash("sha256").update("normalized-v1:").update(bytes).digest("hex").slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}.webp`;
}

/** Call only after the existing ownership/path checks, using that user's RLS client. */
export async function normalizeStoredImage(client: SupabaseClient, bucket: string, path: string,
  beforeUpload?: (image: { path: string; bytes: number; width: number; height: number; mimeType: string }) => Promise<void>) {
  const storage = client.storage.from(bucket);
  const { data: file, error } = await storage.download(path);
  if (error || !file || file.size > IMAGE_POLICY.maxInputBytes) throw new Error("Uploaded image could not be processed.");
  const input = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(input, { limitInputPixels: IMAGE_POLICY.maxInputPixels }).metadata();
  if (metadata.format === "webp" &&
    input.length <= IMAGE_POLICY.maxBytes && (metadata.width ?? Infinity) <= IMAGE_POLICY.maxEdge &&
    (metadata.height ?? Infinity) <= IMAGE_POLICY.maxEdge && !metadata.exif && !metadata.icc && !metadata.xmp)
    return { path, bytes: input.length, width: metadata.width!, height: metadata.height!, mimeType: "image/webp" as const };
  const image = await normalizeImage(input);
  const output = path.slice(0, path.lastIndexOf("/") + 1) + normalizedName(image.data);
  // Salon staff storage policies require a matching authorized asset reservation first.
  await beforeUpload?.({ path: output, bytes: image.bytes, width: image.width, height: image.height, mimeType: image.mimeType });
  const { error: upload } = await storage.upload(output, image.data, { contentType: image.mimeType, upsert: false, cacheControl: "31536000" });
  if (upload && !/already exists|duplicate/i.test(upload.message)) throw new Error("Processed image could not be saved.");
  return { path: output, bytes: image.bytes, width: image.width, height: image.height, mimeType: image.mimeType };
}

import "server-only";
import { createHash } from "node:crypto";
import { advertisingClient } from "./explore-advertising";
import { normalizeImage } from "./normalize-image";
import { downloadPublicImage } from "./public-image-download";

/** Immutable content-addressed output. Existing originals remain available for rollback. */
export async function storeAdminCampaignImage(url: string, input?: Uint8Array) {
  const image = await normalizeImage(input ?? await downloadPublicImage(url));
  const hash = createHash("sha256").update(image.data).digest("hex");
  const path = `optimized/v1/${hash}.webp`;
  const storage = advertisingClient().storage.from("explore-advertising");
  const { error } = await storage.upload(path, image.data, {
    contentType: image.mimeType, cacheControl: "31536000", upsert: false,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) throw new Error("Image upload failed. Please try again.");
  const variants = [{ url: storage.getPublicUrl(path).data.publicUrl, width: image.width, height: image.height }];
  for (const edge of [480, 960]) {
    if (image.width <= edge) continue;
    const variant = await normalizeImage(image.data, { maxWidth: edge, maxHeight: edge, targetBytes: edge === 480 ? 80 * 1024 : 180 * 1024 });
    const variantPath = `optimized/v1/${hash}-w${edge}.webp`;
    const { error } = await storage.upload(variantPath, variant.data, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    if (error && !/already exists|duplicate/i.test(error.message)) throw new Error("Image variants could not be saved.");
    variants.push({ url: storage.getPublicUrl(variantPath).data.publicUrl, width: variant.width, height: variant.height });
  }
  return { ...variants[0], variants };
}

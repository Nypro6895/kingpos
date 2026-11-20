import "server-only";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { normalizeImage } from "./normalize-image";
import { IMAGE_POLICY } from "./image-policy";
import { PUBLIC_IMAGE_QUARANTINE_BUCKET, publicImageQuarantinePath, type PublicPostImageBucket } from "./public-image-staging";

const UNAVAILABLE = "Photo safety checks are temporarily unavailable. Your draft is kept. Please try again.";
export class PublicImageSafetyError extends Error {
  constructor(readonly code: "unavailable" | "rejected" | "invalid", message: string) {
    super(message);
    this.name = "PublicImageSafetyError";
  }
}

export type PublicImageSafetyVerdict = {
  allowed: boolean;
  provider: string;
  model: string;
  policyVersion: string;
};
export type PublicImageVerifier = (image: Buffer) => Promise<PublicImageSafetyVerdict>;
type Manifest = {
  bucket: string; object_path: string; quarantine_path: string;
  uploaded_by_user_id: string | null; salon_id: string | null; purpose: string;
  status: string; sha256: string | null; width: number | null; height: number | null; bytes: number | null;
};
const MANIFEST_SELECT = "bucket,object_path,quarantine_path,uploaded_by_user_id,salon_id,purpose,status,sha256,width,height,bytes";

export function publicImageServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new PublicImageSafetyError("unavailable", UNAVAILABLE);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) }) },
  });
}

/** RLS is retained and identity/scope are checked again before using a privileged writer. */
async function ownedManifest(client: SupabaseClient, input: { bucket: PublicPostImageBucket; path: string; userId: string; purpose?: string; salonId?: string | null }) {
  const { data, error } = await client.from("public_post_images").select(MANIFEST_SELECT)
    .eq("bucket", input.bucket).eq("object_path", input.path).maybeSingle<Manifest>();
  if (error || !data || data.bucket !== input.bucket || data.object_path !== input.path ||
    data.uploaded_by_user_id !== input.userId || (input.purpose && data.purpose !== input.purpose) ||
    (input.salonId !== undefined && data.salon_id !== input.salonId) ||
    data.quarantine_path !== publicImageQuarantinePath(input.bucket, input.path)) {
    throw new PublicImageSafetyError("invalid", "This photo could not be verified for your post.");
  }
  return data;
}

/** Full final bytes are checked, then the exact immutable public copy is attested in SQL. */
export async function preparePublicPostImage(input: {
  client: SupabaseClient; bucket: PublicPostImageBucket; path: string; userId: string;
  purpose: string; salonId?: string | null; verify?: PublicImageVerifier; service?: SupabaseClient;
}) {
  const manifest = await ownedManifest(input.client, input);
  if (manifest.status === "approved" || manifest.status === "legacy") {
    // Publication triggers remain the authority for the pinned Storage object/version.
    return { path: input.path, bytes: manifest.bytes, width: manifest.width, height: manifest.height, mimeType: "image/webp" as const };
  }
  if (manifest.status !== "staged") throw new PublicImageSafetyError("invalid", "Choose another photo for this post.");
  // There is deliberately no allow-on-error or development bypass. A provider is selected separately.
  if (!input.verify) throw new PublicImageSafetyError("unavailable", UNAVAILABLE);
  const { data: file, error } = await input.client.storage.from(PUBLIC_IMAGE_QUARANTINE_BUCKET).download(manifest.quarantine_path);
  if (error || !file || file.size > IMAGE_POLICY.maxInputBytes) throw new PublicImageSafetyError("invalid", "Uploaded photo could not be read. Please upload it again.");
  const source = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(source, { limitInputPixels: IMAGE_POLICY.maxInputPixels, failOn: "error" }).metadata();
  if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) throw new PublicImageSafetyError("invalid", "Choose a JPEG, PNG or WebP photo.");
  if ((metadata.pages ?? 1) !== 1) throw new PublicImageSafetyError("invalid", "Choose a still photo for this post.");
  const image = await normalizeImage(source);
  let verdict: PublicImageSafetyVerdict;
  try { verdict = await input.verify(image.data); }
  catch { throw new PublicImageSafetyError("unavailable", UNAVAILABLE); }
  if (!verdict || typeof verdict.allowed !== "boolean" || !verdict.provider || !verdict.model || !verdict.policyVersion) {
    throw new PublicImageSafetyError("unavailable", UNAVAILABLE);
  }
  if (!verdict.allowed) throw new PublicImageSafetyError("rejected", "This photo cannot be posted under our Community Guidelines. Choose another photo or contact Support if this seems wrong.");
  const sha256 = createHash("sha256").update(image.data).digest("hex");
  const service = input.service ?? publicImageServiceClient();
  const { error: uploadError } = await service.storage.from(input.bucket).upload(input.path, image.data, {
    contentType: image.mimeType, upsert: false, cacheControl: "31536000", metadata: { sha256 },
  });
  // A concurrent same-path retry may already have promoted the identical image. The SQL
  // attestation must reject a different hash/object; a duplicate response alone is not approval.
  if (uploadError && !/already exists|duplicate/i.test(uploadError.message)) throw new PublicImageSafetyError("unavailable", UNAVAILABLE);
  const { error: finishError, data: finished } = await service.rpc("finish_public_post_image", {
    p_bucket: input.bucket, p_path: input.path, p_sha256: sha256,
    p_width: image.width, p_height: image.height, p_bytes: image.bytes,
    p_provider: verdict.provider, p_model: verdict.model, p_policy_version: verdict.policyVersion,
  });
  if (finishError || !finished || finished.status !== "approved" || finished.bucket !== input.bucket ||
    finished.object_path !== input.path || finished.sha256 !== sha256 ||
    finished.width !== image.width || finished.height !== image.height || finished.bytes !== image.bytes ||
    typeof finished.object_id !== "string") throw new PublicImageSafetyError("unavailable", UNAVAILABLE);
  // The checked public copy is immutable and reusable; its private source is no
  // longer needed. Cleanup failure must not turn a confirmed approval into a new post.
  try { await service.storage.from(PUBLIC_IMAGE_QUARANTINE_BUCKET).remove([manifest.quarantine_path]); } catch { /* account erasure also collects the exact private path */ }
  return { path: input.path, bytes: image.bytes, width: image.width, height: image.height, mimeType: image.mimeType };
}

/** Explicit author cleanup only removes private staging bytes, never an uncertain public post. */
export async function removeOwnStagedPostImage(client: SupabaseClient, input: { bucket: PublicPostImageBucket; path: string; userId: string; salonId?: string | null }, options: { service?: SupabaseClient } = {}) {
  const manifest = await ownedManifest(client, input);
  const service = options.service ?? publicImageServiceClient();
  if (manifest.status !== "approved" && manifest.status !== "legacy") {
    const { data, error: cancelError } = await service.rpc("cancel_public_post_image", {
      p_bucket: input.bucket, p_path: input.path, p_user_id: input.userId,
    });
    if (cancelError || data !== true) throw new PublicImageSafetyError("unavailable", "The draft photo could not be removed. Please try again.");
  }
  const { error } = await service.storage.from(PUBLIC_IMAGE_QUARANTINE_BUCKET).remove([manifest.quarantine_path]);
  if (error) throw new PublicImageSafetyError("unavailable", "The draft photo could not be removed. Please try again.");
}

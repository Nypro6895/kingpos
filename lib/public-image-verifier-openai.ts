import "server-only";
import sharp from "sharp";
import { IMAGE_POLICY } from "./image-policy";
import type { PublicImageSafetyVerdict, PublicImageVerifier } from "./public-image-safety";

// Official standalone Moderations image contract, reviewed 2026-11-18.
export const OPENAI_PUBLIC_PHOTO_MODEL = "omni-moderation-latest";
export const OPENAI_PUBLIC_PHOTO_POLICY_VERSION = "reylumi-public-photo-openai-20261118-v1";
const ENDPOINT = "https://api.openai.com/v1/moderations";
const RETURNED_MODELS = new Set([OPENAI_PUBLIC_PHOTO_MODEL, "omni-moderation-2024-09-26"]);
const MAX_RESPONSE_BYTES = 32 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 12_000;
const UNAVAILABLE = "Photo safety checks are temporarily unavailable. Your draft is kept. Please try again.";
const IMAGE_CATEGORIES = ["sexual", "self-harm", "self-harm/intent", "self-harm/instructions", "violence", "violence/graphic"] as const;
const TEXT_ONLY_CATEGORIES = ["sexual/minors", "harassment", "harassment/threatening", "hate", "hate/threatening", "illicit", "illicit/violent"] as const;
const CATEGORIES = [...IMAGE_CATEGORIES, ...TEXT_ONLY_CATEGORIES];

type Options = { apiKey?: string; fetchImpl?: typeof fetch; timeoutMs?: number };
function unavailable() { return new Error(UNAVAILABLE); }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

async function normalizedStill(image: Buffer) {
  if (!Buffer.isBuffer(image) || image.length === 0 || image.length > IMAGE_POLICY.maxBytes ||
    image.toString("ascii", 0, 4) !== "RIFF" || image.toString("ascii", 8, 12) !== "WEBP") throw unavailable();
  // Reject trailing data and nonpixel RIFF chunks, not just metadata Sharp recognizes.
  if (image.length < 12 || image.readUInt32LE(4) + 8 !== image.length) throw unavailable();
  const chunks = new Set<string>();
  for (let offset = 12; offset < image.length;) {
    if (offset + 8 > image.length) throw unavailable();
    const kind = image.toString("ascii", offset, offset + 4), size = image.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size & 1);
    if (!["VP8 ", "VP8L", "VP8X", "ALPH"].includes(kind) || chunks.has(kind) || end > image.length ||
      ((size & 1) !== 0 && image[end - 1] !== 0)) throw unavailable();
    chunks.add(kind); offset = end;
  }
  if (Number(chunks.has("VP8 ")) + Number(chunks.has("VP8L")) !== 1) throw unavailable();
  const decoder = sharp(image, { limitInputPixels: IMAGE_POLICY.maxInputPixels, failOn: "error" });
  const metadata = await decoder.metadata();
  if (metadata.format !== "webp" || !metadata.width || !metadata.height ||
    metadata.width > IMAGE_POLICY.maxEdge || metadata.height > IMAGE_POLICY.maxEdge ||
    (metadata.pages ?? 1) !== 1 || metadata.exif || metadata.icc || metadata.xmp || metadata.iptc || metadata.orientation) throw unavailable();
  // Decode the complete still; a valid WebP header alone must not permit a corrupt payload.
  await decoder.stats();
}

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) throw unavailable();
  if (response.status !== 200 || response.redirected || (response.url && response.url !== ENDPOINT) ||
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw unavailable();
  const length = response.headers.get("content-length");
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw unavailable();
  if (!response.body) throw unavailable();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  let size = 0, completed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { completed = true; break; }
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw unavailable();
      chunks.push(value);
    }
    if (size === 0) throw unavailable();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!completed) cancel();
    reader.releaseLock();
  }
}

function verdict(value: unknown): PublicImageSafetyVerdict {
  if (!object(value) || !exactKeys(value, ["id", "model", "results"]) ||
    typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(value.id) ||
    typeof value.model !== "string" || !RETURNED_MODELS.has(value.model) ||
    !Array.isArray(value.results) || value.results.length !== 1) throw unavailable();
  const result: unknown = value.results[0];
  if (!object(result) || !exactKeys(result, ["flagged", "categories", "category_scores", "category_applied_input_types"]) ||
    typeof result.flagged !== "boolean" || !object(result.categories) || !object(result.category_scores) || !object(result.category_applied_input_types)) throw unavailable();
  const flags = result.categories, scores = result.category_scores, applied = result.category_applied_input_types;
  if (!exactKeys(flags, CATEGORIES) || !exactKeys(scores, CATEGORIES) || !exactKeys(applied, CATEGORIES)) throw unavailable();
  for (const category of CATEGORIES) {
    const score = scores[category], types = applied[category];
    if (typeof flags[category] !== "boolean" || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1 ||
      !Array.isArray(types)) throw unavailable();
    const imageSupported = (IMAGE_CATEGORIES as readonly string[]).includes(category);
    if (imageSupported ? types.length !== 1 || types[0] !== "image" : types.length !== 0) throw unavailable();
  }
  return {
    allowed: !result.flagged && !CATEGORIES.some(category => flags[category] === true),
    provider: "openai", model: value.model, policyVersion: OPENAI_PUBLIC_PHOTO_POLICY_VERSION,
  };
}

/** Only normalized final bytes; no remote URL, caption, user ID or Storage metadata is accepted. */
export function createOpenAIPublicPostVerifier(options: Options = {}): PublicImageVerifier {
  return async image => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      // Resolve on invocation, never module import/factory creation. No credential inspection or logging.
      const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
      if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 512 || /\s/.test(apiKey)) throw unavailable();
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw unavailable();
      await normalizedStill(image);
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeoutMs);
      });
      const request = async () => {
        const response = await (options.fetchImpl ?? fetch)(ENDPOINT, {
          method: "POST", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: OPENAI_PUBLIC_PHOTO_MODEL,
            input: [{ type: "image_url", image_url: { url: `data:image/webp;base64,${image.toString("base64")}` } }] }),
        });
        try { return verdict(await boundedJson(response, controller.signal)); }
        finally { if (!response.body?.locked) void response.body?.cancel().catch(() => {}); }
      };
      return await Promise.race([request(), expired]);
    } catch {
      // Never propagate provider bodies, headers, IDs, credentials or network/parser/image details.
      throw unavailable();
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  };
}

export const verifyOpenAIPublicPostImage: PublicImageVerifier = createOpenAIPublicPostVerifier();

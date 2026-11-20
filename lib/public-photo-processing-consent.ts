import type { PublicImageVerifier } from "./public-image-safety";

// Client-safe notice and server boundary; no provider/runtime/credential imports.
export const PUBLIC_PHOTO_PROCESSING_NOTICE_VERSION = "public-photo-openai-20261118-v1";
export const PUBLIC_PHOTO_PROCESSING_NOTICE = "To check the photos in this post before publication, Reylumi sends processed copies to OpenAI for an automated safety check. Photos can include people or personal information.";
export const PUBLIC_PHOTO_PROCESSING_CHECKBOX_LABEL = "I agree to send the photos in this post to OpenAI for this safety check.";
export const PUBLIC_PHOTO_PROCESSING_DECLINE_NOTICE = "Without agreement, keep your draft or leave without posting these photos.";
export const PUBLIC_PHOTO_PROCESSING_PRIVACY_HREF = "/privacy";

export type PublicPhotoProcessingConsent = {
  provider: "openai";
  noticeVersion: string;
  accepted: boolean;
};

/** A current, affirmative per-submission choice is required; stored generic consent is insufficient. */
export function assertPublicPhotoProcessingConsent(value: unknown): asserts value is PublicPhotoProcessingConsent {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== 3 ||
    !Object.hasOwn(value, "provider") || !Object.hasOwn(value, "noticeVersion") || !Object.hasOwn(value, "accepted") ||
    (value as PublicPhotoProcessingConsent).provider !== "openai" ||
    (value as PublicPhotoProcessingConsent).noticeVersion !== PUBLIC_PHOTO_PROCESSING_NOTICE_VERSION ||
    (value as PublicPhotoProcessingConsent).accepted !== true) {
    throw new Error("Please agree to the OpenAI photo safety check for this post, or keep your draft without posting these photos.");
  }
}

/** Evaluate before private preparation; accepted consent returns the original verifier unchanged. */
export function withPublicPhotoProcessingConsent(consent: unknown, verifier: PublicImageVerifier): PublicImageVerifier {
  assertPublicPhotoProcessingConsent(consent);
  return verifier;
}

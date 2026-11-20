import { isReylumiIOSClient } from "./ios-client";

export type PortableNativePlatform = "ios" | "android";

/** Presentation/admission expectation only; never authentication or a grant. */
export function portableNativePlatform(userAgent: string | null | undefined): PortableNativePlatform | null {
  if (isReylumiIOSClient(userAgent ?? null)) return "ios";
  const agent = userAgent ?? "";
  return /(?:^|\s)ReylumiAndroid\/\d+(?:\.\d+)*(?:\s|$)/.test(agent) &&
    /(?:^|\s)ReylumiAndroidPOS\/\d+(?:\.\d+)*(?:\s|$)/.test(agent) ? "android" : null;
}

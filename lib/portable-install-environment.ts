export type PortableInstallEnvironment = "hidden" | "ios" | "browser";

export function portableInstallEnvironment({
  userAgent,
  platform,
  maxTouchPoints,
  standalone,
  native,
}: {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
  native: boolean;
}): PortableInstallEnvironment {
  if (native || standalone || /ReylumiIOS\//i.test(userAgent)) return "hidden";
  // iPadOS Safari can identify itself as a Mac when requesting desktop sites.
  return /iPad|iPhone|iPod/i.test(userAgent) || platform === "MacIntel" && maxTouchPoints > 1
    ? "ios"
    : "browser";
}

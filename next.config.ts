import type { NextConfig } from "next";

const SUPABASE_PUBLIC_IMAGE_BUCKETS = [
  "account-avatars",
  "beauty-profile-media",
  "salon-profile-media",
] as const;

function supabaseImagePatterns(): NonNullable<
  NextConfig["images"]
>["remotePatterns"] {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

  if (!supabaseUrl) {
    return [];
  }

  try {
    const url = new URL(supabaseUrl);
    const protocol = url.protocol.replace(":", "");

    if (!url.hostname || (protocol !== "http" && protocol !== "https")) {
      return [];
    }

    return SUPABASE_PUBLIC_IMAGE_BUCKETS.map((bucket) => ({
      protocol,
      hostname: url.hostname,
      port: url.port,
      pathname: `/storage/v1/object/public/${bucket}/**`,
      search: "",
    }));
  } catch {
    return [];
  }
}

function deploymentIdentifier(): string | undefined {
  return [
    process.env.NEXT_DEPLOYMENT_ID,
    process.env.DEPLOYMENT_VERSION,
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GIT_SHA,
    process.env.GIT_HASH,
  ]
    .map((value) => value?.trim())
    .find(Boolean);
}

const deploymentId = deploymentIdentifier();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseImagePatterns(),
  },
  reactCompiler: true,
  deploymentId,
  generateBuildId: async () => deploymentId ?? null,
};

export default nextConfig;

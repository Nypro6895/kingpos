import type { NextConfig } from "next";

const SUPABASE_PUBLIC_IMAGE_BUCKETS = [
  "account-avatars",
  "beauty-profile-media",
  "salon-profile-media",
] as const;
const MAX_DEPLOYMENT_ID_LENGTH = 32;
const SHORT_GIT_SHA_LENGTH = 12;
const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

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

function normalizeDeploymentId(identifier: string | undefined): string | undefined {
  if (!identifier) {
    return undefined;
  }

  if (identifier.length <= MAX_DEPLOYMENT_ID_LENGTH) {
    return identifier;
  }

  if (FULL_GIT_SHA_PATTERN.test(identifier)) {
    return identifier.slice(0, SHORT_GIT_SHA_LENGTH);
  }

  return identifier.slice(0, MAX_DEPLOYMENT_ID_LENGTH);
}

const deploymentSourceId = deploymentIdentifier();
const deploymentId = normalizeDeploymentId(deploymentSourceId);

if (deploymentId) {
  // Next.js rereads this env var during build and uses it over config.deploymentId.
  process.env.NEXT_DEPLOYMENT_ID = deploymentId;
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseImagePatterns(),
  },
  reactCompiler: true,
  deploymentId,
  generateBuildId: async () => deploymentSourceId ?? null,
};

export default nextConfig;

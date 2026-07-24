import type { NextConfig } from "next";

function supabaseImagePatterns(): NonNullable<
  NextConfig["images"]
>["remotePatterns"] {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

  if (!supabaseUrl) {
    return [];
  }

  try {
    const url = new URL(supabaseUrl);

    return [
      {
        protocol: url.protocol.replace(":", "") as "http" | "https",
        hostname: url.hostname,
        pathname: "/storage/v1/object/public/salon-profile-media/**",
      },
    ];
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

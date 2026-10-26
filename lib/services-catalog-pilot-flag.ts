/** Deliberately unavailable in production builds, even if the opt-in is set. */
export function servicesCatalogPilotEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && env.REYLUMI_SERVICES_CACHE_PILOT === "1";
}

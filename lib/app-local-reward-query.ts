/** Exact read arguments shared by the installed adapter and its server reader.
 * This is transport validation; the original Reward routes still own eligibility.
 */
export const APP_LOCAL_REWARD_PUBLIC_READS = {
  "http.rewards.discover": { path: "/api/rewards/discover", argumentKeys: ["lat", "lon", "location", "category", "kind", "radius"] },
  "http.rewards.program": { path: "/api/rewards/program", argumentKeys: ["salonId"] },
} as const;

export function validateAppLocalRewardQuery(name: keyof typeof APP_LOCAL_REWARD_PUBLIC_READS, args: Record<string, unknown>) {
  const fail = (): never => { throw Object.assign(new Error("Unsupported reward request"), { status: 400 }); };
  const keys: readonly string[] = APP_LOCAL_REWARD_PUBLIC_READS[name].argumentKeys;
  if (!args || typeof args !== "object" || Array.isArray(args) || Object.entries(args).some(([key, value]) => !keys.includes(key) || typeof value !== "string" || value.length > 160)) fail();
  if (name === "http.rewards.program") {
    if (typeof args.salonId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(args.salonId)) fail();
    return;
  }
  if (args.category !== undefined && (args.category as string).length > 80) fail();
  if (args.kind !== undefined && !["all", "spend", "welcome", "before_after"].includes(args.kind as string)) fail();
  if (args.radius !== undefined && !["5", "10", "15"].includes(args.radius as string)) fail();
  if (args.lat !== undefined || args.lon !== undefined) {
    const latitude = typeof args.lat === "string" && args.lat.trim() ? Number(args.lat) : NaN;
    const longitude = typeof args.lon === "string" && args.lon.trim() ? Number(args.lon) : NaN;
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) fail();
  }
}

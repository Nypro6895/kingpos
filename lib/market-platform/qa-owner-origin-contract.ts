// PREPARATION ONLY. No runtime imports/integration or origin is enabled here.
const scope = "isolated-nonfinancial-market-qa";
const keys = ["schemaVersion", "approved", "scope", "marketOrigin", "qrOrigin", "marketProjectId", "qrProjectId", "productionProjectId", "reviewId", "sourceSha256", "reviewedAt", "expiresAt"];
const projectId = /^prj_[A-Za-z0-9]{8,80}$/;
const reviewId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const maxWindow = 72 * 60 * 60 * 1000;
function record(value: unknown, allowed: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const own = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(own).length === allowed.length && allowed.every(key => Object.hasOwn(own, key) && "value" in own[key]);
}
function origin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 261 || !/^https:\/\/[a-z0-9.-]+$/.test(value)) return false;
  const parsed = new URL(value), host = parsed.hostname, labels = host.split(".");
  if (parsed.origin !== value || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash || parsed.pathname !== "/") return false;
  if (labels.length < 2 || !/^[a-z]{2,63}$/.test(labels.at(-1)!)) return false;
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) || label.startsWith("xn--"))) return false;
  if (["localhost", "local", "internal", "invalid", "test", "example"].includes(labels.at(-1)!)) return false;
  // Negative namespace isolation only. Authorization below is full-string equality.
  return host !== "reylumi.com" && !host.endsWith(".reylumi.com");
}
function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isSafeInteger(at) && at > 0 && new Date(at).toISOString() === value ? at : null;
}
/** Pure candidate contract for a future approved integration. No env/network reads.
 * A review ID/hash is audit metadata, not proof of ownership or owner authorization.
 */
export function matchReviewedQaOwnerOrigin(config: unknown, candidate: unknown, runtime: unknown, nowMs: unknown): string | null {
  try {
    if (!record(config, keys) || config.schemaVersion !== 1 || config.approved !== true || config.scope !== scope) return null;
    if (!origin(config.marketOrigin) || !origin(config.qrOrigin) || config.marketOrigin === config.qrOrigin) return null;
    const ids = [config.marketProjectId, config.qrProjectId, config.productionProjectId];
    if (!ids.every(id => typeof id === "string" && projectId.test(id)) || new Set(ids).size !== 3) return null;
    if (typeof config.reviewId !== "string" || !reviewId.test(config.reviewId) || typeof config.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(config.sourceSha256) || /^0+$/.test(config.sourceSha256)) return null;
    const start = timestamp(config.reviewedAt), end = timestamp(config.expiresAt);
    if (start === null || end === null || end <= start || end - start > maxWindow || typeof nowMs !== "number" || !Number.isSafeInteger(nowMs) || nowMs < start || nowMs >= end) return null;
    if (!record(runtime, ["mode", "providerProjectId"]) || runtime.mode !== scope || runtime.providerProjectId !== config.marketProjectId) return null;
    // No suffix match, normalization, redirect path, optional candidate or fallback.
    return typeof candidate === "string" && candidate === config.marketOrigin ? config.marketOrigin : null;
  } catch { return null; }
}

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const ABUSE_DEVICE_COOKIE = "reylumi-device";
export const ABUSE_HEADER = "x-reylumi-safety";
export const ABUSE_SIGNATURE_HEADER = "x-reylumi-safety-signature";

export function abuseSigningKey() {
  const key = process.env.ANTISPAM_SIGNING_KEY?.trim();
  if (key) return key;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return serviceKey ? createHmac("sha256", serviceKey).update("reylumi:abuse-signing:v1").digest("hex") : null;
}
export function abuseHash(value: string) {
  const key = abuseSigningKey();
  if (!key) throw new Error("Security checks are temporarily unavailable. Please try again later.");
  return createHmac("sha256", key).update(value).digest("hex");
}
export function verifySignedValue(value: string, signature: string) {
  const key = abuseSigningKey();
  if (!key || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), createHmac("sha256", key).update(value).digest());
}
export function readDeviceToken(token?: string | null) {
  if (!token || token.length > 120) return null;
  const [id, signature, extra] = token.split(".");
  return !extra && /^[a-f0-9-]{36}$/.test(id) && verifySignedValue(`device:${id}`, signature ?? "") ? id : null;
}
export function newDeviceToken() {
  const id = randomUUID();
  return `${id}.${abuseHash(`device:${id}`)}`;
}
export function trustedNetworkSignals(headers: Pick<Headers, "get">) {
  // Only Vercel's overwritten forwarding headers are trusted on this deployment.
  const address = process.env.VERCEL === "1" ? headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() : null;
  const country = process.env.VERCEL === "1" ? headers.get("x-vercel-ip-country")?.toUpperCase() : null;
  return { ipHash: address && isIP(address) ? abuseHash(`ip:${address}`) : "", country: country && /^[A-Z]{2}$/.test(country) ? country : "" };
}
export function signSafetyContext(deviceToken: string, headers: Pick<Headers, "get">, now = Date.now()) {
  const id = readDeviceToken(deviceToken);
  if (!id) throw new Error("Please reload this page before continuing.");
  const deviceHash = abuseHash(`device-id:${id}`);
  const { ipHash, country } = trustedNetworkSignals(headers);
  const payload = `${deviceHash}|${ipHash}|${country}|${Math.floor(now / 1000)}`;
  return { deviceHash, ipHash, country, payload, signature: abuseHash(payload) };
}

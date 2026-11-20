import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { advertisingClient } from "@/lib/explore-advertising";
export const AD_ATTRIBUTION_COOKIE = "reylumi-ad-attribution";
export type AdAttribution = {
  id: string;
  session: string;
  device: "desktop" | "mobile";
  audience: string;
  path: string;
  at: number;
};
function secret() {
  const value =
    process.env.ADVERTISING_IP_HASH_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Advertising attribution unavailable.");
  return value;
}
export function signAdAttribution(value: AdAttribution) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return (
    payload +
    "." +
    createHmac("sha256", secret()).update(payload).digest("base64url")
  );
}
export function readAdAttribution(token: string): AdAttribution | null {
  try {
    if (token.length > 2048) return null;
    if(token.split(".").length!==2)return null;
    const [payload, signature] = token.split(".");
    const expected = createHmac("sha256", secret()).update(payload).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (
      expected.length !== supplied.length ||
      !timingSafeEqual(expected, supplied)
    )
      return null;
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (
      !Number.isFinite(value.at) ||
      value.at > Date.now() ||
      value.at < Date.now() - 7 * 86400000
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
export async function recordAdvertisingSignup(
  request: Request,
  user: { id: string; created_at: string; identities?: unknown[] } | null,
) {
  if (
    !user ||
    !user.identities?.length ||
    !Number.isFinite(Date.parse(user.created_at)) ||
    Math.abs(Date.now() - Date.parse(user.created_at)) > 300000
  )
    return;
  try {
    const token = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(AD_ATTRIBUTION_COOKIE + "="))
      ?.slice(AD_ATTRIBUTION_COOKIE.length + 1);
    const value = token ? readAdAttribution(decodeURIComponent(token)) : null;
    if (!value) return;
    await advertisingClient().rpc("record_advertising_event", {
      p_campaign: value.id,
      p_session: value.session,
      p_kind: "signup",
      p_device: value.device,
      p_audience: value.audience,
      p_path: value.path,
      p_user: user.id,
    });
  } catch {
    /* Analytics never prevent account creation. */
  }
}

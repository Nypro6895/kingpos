import "server-only";
import { headers, cookies } from "next/headers";
import { ABUSE_DEVICE_COOKIE, ABUSE_HEADER, ABUSE_SIGNATURE_HEADER, newDeviceToken, readDeviceToken, signSafetyContext, verifySignedValue } from "@/lib/abuse-signals";

export async function getSafetyContext() {
  const requestHeaders = await headers();
  const payload = requestHeaders.get(ABUSE_HEADER);
  const signature = requestHeaders.get(ABUSE_SIGNATURE_HEADER);
  if (payload && signature && verifySignedValue(payload, signature)) {
    const [deviceHash, ipHash, country, at] = payload.split("|");
    if (Math.abs(Date.now() / 1000 - Number(at)) < 120) return { deviceHash, ipHash, country, payload, signature };
  }
  const jar = await cookies();
  const existing = jar.get(ABUSE_DEVICE_COOKIE)?.value;
  const token = readDeviceToken(existing) ? existing! : newDeviceToken();
  return signSafetyContext(token, requestHeaders);
}
export async function safetyRequestHeaders(): Promise<Record<string, string>> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.ANTISPAM_SIGNING_KEY) return {};
  const context = await getSafetyContext();
  return { [ABUSE_HEADER]: context.payload, [ABUSE_SIGNATURE_HEADER]: context.signature };
}

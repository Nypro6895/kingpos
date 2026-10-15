import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
export type CampaignDeliveryTicket = { id: string; visitor: string; viewer: string | null; area: Record<string,string>; expires: number; nonce: string };
function secret() { const value = process.env.ADVERTISING_IP_HASH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY; if (!value) throw new Error("Campaign delivery is unavailable."); return value; }
export function campaignVisitorHash(visitor: string) { return createHmac("sha256", secret()).update(`owner-campaign:${visitor}`).digest("hex"); }
export function campaignVisitorIdentity(headers: Headers, cookie: string, viewer: string | null) {
  if (viewer) return `account:${viewer}`;
  const header = process.env.VERCEL ? "x-vercel-forwarded-for" : process.env.ADVERTISING_TRUSTED_IP_HEADER;
  // Only use an explicitly configured header overwritten by the hosting proxy.
  const ip = header && ["x-vercel-forwarded-for", "x-forwarded-for", "cf-connecting-ip"].includes(header) ? headers.get(header)?.split(",")[0]?.trim() : null;
  return ip ? `network:${ip}` : `browser:${cookie}`;
}
export function signCampaignTicket(ticket: CampaignDeliveryTicket) { const body = Buffer.from(JSON.stringify(ticket)).toString("base64url"); return `${body}.${createHmac("sha256",secret()).update(body).digest("base64url")}`; }
export function readCampaignTicket(value: string): CampaignDeliveryTicket | null {
  if (value.length > 4096) return null;
  const [body, signature, extra] = value.split(".");
  if (!body || !signature || extra) return null;
  const expected = createHmac("sha256",secret()).update(body).digest();
  const actual = Buffer.from(signature,"base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected,actual)) return null;
  try { const ticket = JSON.parse(Buffer.from(body,"base64url").toString()) as CampaignDeliveryTicket; return ticket.expires > Date.now() ? ticket : null; } catch { return null; }
}

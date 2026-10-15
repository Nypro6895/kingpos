import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { SUPPORT_EMAIL, escapeSupportHtml, supportEmail } from "@/lib/support-rules";
import { supportServiceClient } from "@/lib/support-server";

export type SupportEmailConfig = { apiKey: string; from: string; enabled: boolean; domainVerified: boolean };
export type SupportEmailOutcome = { status: "sent" | "failed" | "unknown"; providerId?: string; reason?: string };

function encryptionKey() {
  const key = Buffer.from(process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("Email settings cannot be saved until server encryption is configured.");
  return key;
}

export function encryptSupportEmail(config: SupportEmailConfig) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

function decryptSupportEmail(value: string): SupportEmailConfig {
  const [version, iv, tag, body] = value.split(".");
  if (version !== "v1") throw new Error("Email settings need to be reconnected.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8"));
}

export async function getSupportEmailConfig(): Promise<SupportEmailConfig> {
  const { data, error } = await supportServiceClient().from("platform_support_email_settings").select("encrypted_config").eq("id", true).maybeSingle();
  if (error) throw new Error("Support email settings are unavailable.");
  if (data) return decryptSupportEmail(data.encrypted_config);
  return { apiKey: process.env.RESEND_API_KEY?.trim() ?? "", from: process.env.SUPPORT_EMAIL_FROM?.trim() || SUPPORT_EMAIL, enabled: true, domainVerified: false };
}

export function supportEmailReady(config: SupportEmailConfig) { return Boolean(config.enabled && config.apiKey && config.from); }
export function publicSupportEmailConfig(config: SupportEmailConfig) {
  return { from: config.from, enabled: config.enabled, keyConfigured: Boolean(config.apiKey), domainVerified: config.domainVerified };
}

export async function verifySupportEmailDomain(config: SupportEmailConfig) {
  const domain = supportEmail(config.from).split("@")[1];
  const response = await fetch("https://api.resend.com/domains?limit=100", { headers: { Authorization: `Bearer ${config.apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("Unable to verify the email connection. Check the Resend API key and its domain access.");
  const result = await response.json() as { data?: Array<{ name: string; status: string }> };
  if (!result.data?.some(item => item.name.toLowerCase() === domain && item.status === "verified")) throw new Error(`Verify ${domain} in Resend before connecting this sender.`);
  return true;
}

export async function sendSupportEmail(config: SupportEmailConfig, reply: { id: string; to: string; subject: string; body: string; name: string }): Promise<SupportEmailOutcome> {
  if (!supportEmailReady(config)) return { status: "failed", reason: "Support email is not connected." };
  const text = `Hello ${reply.name},\n\n${reply.body}\n\nReylumi Support\n${config.from}`;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `support-reply/${reply.id}` },
      body: JSON.stringify({ from: `Reylumi Support <${supportEmail(config.from)}>`, to: [supportEmail(reply.to)], reply_to: config.from, subject: reply.subject, text, html: `<div style="font-family:Arial,sans-serif;line-height:1.6;white-space:pre-wrap">${escapeSupportHtml(text)}</div>` }),
    });
    if (!response.ok) return { status: response.status >= 500 || [408, 409].includes(response.status) ? "unknown" : "failed", reason: response.status === 429 ? "The email service is busy. Please try again later." : "The email service did not confirm this reply. Check the sender connection and provider delivery logs." };
    const result = await response.json() as { id?: string };
    if (!result.id) return { status: "unknown", reason: "The email service did not return a delivery reference." };
    return { status: "sent", providerId: result.id };
  } catch { return { status: "unknown", reason: "The connection ended before delivery was confirmed. Check the email service before sending again." }; }
}

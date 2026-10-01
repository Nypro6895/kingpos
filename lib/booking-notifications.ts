import "server-only";
import { createClient } from "@supabase/supabase-js";

type Message = { id: string; channel: "email" | "sms"; recipient: string; message: string };
export type BookingMessageResult = { state: "accepted" | "failed" | "unknown" | "unconfigured"; detail?: string; provider_id?: string };
const env = (...names: string[]) => names.map(name => process.env[name]?.trim()).find(Boolean);

export function bookingMessageReadiness() {
  return {
    email: Boolean(env("RESEND_API_KEY") && env("BOOKING_EMAIL_FROM", "RESEND_FROM_EMAIL", "STAFF_INVITE_EMAIL_FROM")),
    sms: Boolean(env("REYLUMI_TWILIO_ACCOUNT_SID", "TWILIO_ACCOUNT_SID") && env("REYLUMI_TWILIO_AUTH_TOKEN", "TWILIO_AUTH_TOKEN") && env("REYLUMI_TWILIO_MESSAGING_SERVICE_SID", "TWILIO_MESSAGING_SERVICE_SID", "REYLUMI_TWILIO_FROM", "TWILIO_FROM")),
  };
}

export async function sendBookingMessage(message: Message): Promise<BookingMessageResult> {
  if (!bookingMessageReadiness()[message.channel]) return { state: "unconfigured", detail: "Connect a messaging provider to send booking updates." };
  try {
    let response: Response;
    if (message.channel === "email") {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": `booking-${message.id}` },
        body: JSON.stringify({ from: env("BOOKING_EMAIL_FROM", "RESEND_FROM_EMAIL", "STAFF_INVITE_EMAIL_FROM"), to: message.recipient, subject: "Appointment update", text: message.message }),
      });
    } else {
      const phone = message.recipient.replace(/[\s().-]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) return { state: "failed", detail: "SMS requires a phone number with country code, for example +1." };
      const sid = env("REYLUMI_TWILIO_ACCOUNT_SID", "TWILIO_ACCOUNT_SID")!;
      const token = env("REYLUMI_TWILIO_AUTH_TOKEN", "TWILIO_AUTH_TOKEN")!;
      const service = env("REYLUMI_TWILIO_MESSAGING_SERVICE_SID", "TWILIO_MESSAGING_SERVICE_SID");
      const body = new URLSearchParams({ To: phone, Body: message.message });
      if (service) body.set("MessagingServiceSid", service); else body.set("From", env("REYLUMI_TWILIO_FROM", "TWILIO_FROM")!);
      response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST", signal: AbortSignal.timeout(15000), body,
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      });
    }
    if (!response.ok) return { state: response.status >= 500 ? "unknown" : "failed", detail: `Provider returned HTTP ${response.status}.` };
    const payload = await response.json() as { id?: string; sid?: string };
    return { state: "accepted", provider_id: payload.id ?? payload.sid };
  } catch {
    return { state: "unknown", detail: "Provider response was not received. Verify delivery before retrying." };
  }
}

export async function dispatchBookingMessages() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { configured: false, processed: 0 };
  const readiness = bookingMessageReadiness();
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.rpc("claim_booking_messages", { p_limit: 20, p_email_ready: readiness.email, p_sms_ready: readiness.sms });
  if (error) throw new Error("Unable to claim booking notifications.");
  for (const message of (data ?? []) as Message[]) {
    const result = await sendBookingMessage(message);
    const update = await client.from("booking_message_outbox").update({ ...result, updated_at: new Date().toISOString() }).eq("id", message.id).eq("state", "sending");
    if (update.error) throw new Error("Unable to save notification outcome; send remains locked for review.");
  }
  return { configured: true, processed: data?.length ?? 0 };
}

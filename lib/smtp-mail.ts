import "server-only";
import nodemailer from "nodemailer";

export type SmtpSettings = { host: string; port: number; username: string; password: string };
export type SmtpOutcome = { status: "sent" | "failed" | "unknown"; providerId?: string; reason?: string };

export function validateSmtp(settings: SmtpSettings) {
  if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(settings.host) || /[\r\n]/.test(settings.username) || !settings.username.trim() || !settings.password || ![465, 587].includes(settings.port)) {
    throw new Error("Enter an SMTP hostname, port 465 or 587, username and password.");
  }
}

function transport(settings: SmtpSettings) {
  validateSmtp(settings);
  return nodemailer.createTransport({
    host: settings.host, port: settings.port, secure: settings.port === 465,
    requireTLS: true, tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    auth: { user: settings.username, pass: settings.password },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    logger: false, debug: false,
  });
}

export async function verifySmtp(settings: SmtpSettings) {
  const client = transport(settings);
  try { await client.verify(); }
  catch { throw new Error("SMTP connection failed. Check the server, TLS port, username and password."); }
  finally { client.close(); }
}

export async function sendSmtp(settings: SmtpSettings, mail: { from: string; to: string; replyTo?: string; subject: string; text: string; html?: string; messageId?: string }): Promise<SmtpOutcome> {
  let client;
  try {
    client = transport(settings);
    const result = await client.sendMail({ ...mail, disableFileAccess: true, disableUrlAccess: true });
    if (!result.accepted?.length) return { status: "failed", reason: "The mail server did not accept the recipient." };
    return { status: "sent", providerId: result.messageId };
  } catch (error) {
    const failure = error as { code?: string; responseCode?: number; command?: string };
    const rejected = failure.code === "EAUTH" || failure.code === "EENVELOPE" || (failure.responseCode !== undefined && failure.responseCode >= 400);
    return { status: rejected ? "failed" : "unknown", reason: rejected ? "The mail server rejected this email. Check the account and sender settings." : "Delivery is unconfirmed. Check the mail server logs before retrying." };
  } finally { client?.close(); }
}

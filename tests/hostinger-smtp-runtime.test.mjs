import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFileSync } from "node:fs";

async function load(file, stubs = {}) {
  stubs = { "server-only": "export {};", nodemailer: "export default {createTransport: options => globalThis.smtpFixture(options)}", ...stubs };
  const result = await build({ entryPoints: [file], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "smtp-fixture", setup(api) {
    for (const name of Object.keys(stubs)) api.onResolve({ filter: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }, () => ({ path: name, namespace: "fixture" }));
    api.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: stubs[args.path], loader: "js" }));
  } }] });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}
const settings = { host: "smtp.hostinger.com", port: 465, username: "notifications@example.invalid", password: "fixture-secret" };
const mail = { from: settings.username, to: "recipient@example.invalid", subject: "Fixture", text: "Fixture" };

test("SMTP verifies TLS and authentication without sending and always closes", async () => {
  const smtp = await load("lib/smtp-mail.ts"); let sent = 0, closed = 0, options;
  globalThis.smtpFixture = input => { options = input; return { verify: async () => true, sendMail: async () => { sent++; }, close: () => closed++ }; };
  await smtp.verifySmtp(settings);
  assert.equal(sent, 0); assert.equal(closed, 1); assert.equal(options.secure, true); assert.equal(options.requireTLS, true); assert.equal(options.tls.rejectUnauthorized, true); assert.equal(options.logger, false);
  await smtp.verifySmtp({ ...settings, port: 587 }); assert.equal(options.secure, false); assert.equal(options.requireTLS, true);
  for (const port of [25, 80, 0]) assert.throws(() => smtp.validateSmtp({ ...settings, port }));
  assert.throws(() => smtp.validateSmtp({ ...settings, host: "127.0.0.1" }));
  globalThis.smtpFixture = () => ({ verify: async () => { throw new Error(settings.password); }, close() {} });
  await assert.rejects(smtp.verifySmtp(settings), error => !error.message.includes(settings.password));
});

test("SMTP preserves acceptance versus uncertainty and does not retry uncertain sends", async () => {
  const smtp = await load("lib/smtp-mail.ts"); let attempts = 0, captured;
  globalThis.smtpFixture = () => ({ sendMail: async data => { captured = data; attempts++; return { accepted: [mail.to], messageId: "smtp-fixture-id" }; }, close() {} });
  assert.deepEqual(await smtp.sendSmtp(settings, mail), { status: "sent", providerId: "smtp-fixture-id" });
  assert.equal(captured.disableFileAccess, true); assert.equal(captured.disableUrlAccess, true);
  for (const [failure, status] of [[{ code: "EAUTH" }, "failed"], [{ responseCode: 550 }, "failed"], [{ code: "ETIMEDOUT" }, "unknown"], [{ code: "ECONNECTION" }, "unknown"]]) {
    globalThis.smtpFixture = () => ({ sendMail: async () => { attempts++; throw Object.assign(new Error(settings.password), failure); }, close() {} });
    const before = attempts; const result = await smtp.sendSmtp(settings, mail); assert.equal(result.status, status); assert.equal(attempts, before + 1); assert.ok(!result.reason.includes(settings.password));
  }
});

test("encrypted SMTP config round-trips while public projection omits credentials", async () => {
  const email = await load("lib/support-email.ts", { "@/lib/support-server": "export function supportServiceClient(){return {rpc:async(name)=>({data:name==='claim_smtp_delivery'?{should_send:true}:null,error:null}),from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{encrypted_config:globalThis.encryptedFixture},error:null})})})})}}" });
  const previous = process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY;
  process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 42).toString("base64");
  try {
    const config = { apiKey: "", from: settings.username, enabled: true, provider: "smtp", smtp: settings, replyTo: "support@example.invalid", domainVerified: false, useForNotifications: true };
    globalThis.encryptedFixture = email.encryptSupportEmail(config);
    assert.ok(!globalThis.encryptedFixture.includes(settings.password)); assert.deepEqual(await email.getSupportEmailConfig(), config);
    assert.ok(!JSON.stringify(email.publicSupportEmailConfig(config)).includes(settings.password)); assert.equal(email.supportEmailReady(config), true);
    assert.deepEqual(await email.getNotificationEmailConfig(), config);
    globalThis.encryptedFixture = email.encryptSupportEmail({ ...config, useForNotifications: false }); assert.equal(await email.getNotificationEmailConfig(), null);
    let captured;
    globalThis.smtpFixture = () => ({ sendMail: async data => { captured = data; return { accepted: [mail.to], messageId: "case-id" }; }, close() {} });
    await email.sendSupportEmail(config, { id: "fixture-case", to: mail.to, subject: "Recovery", name: "Customer", body: "Details" });
    assert.equal(captured.replyTo, config.replyTo); assert.match(captured.messageId, /support-fixture-case/);
  } finally { if (previous === undefined) delete process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY; else process.env.PLATFORM_SETTINGS_ENCRYPTION_KEY = previous; }
});

test("SMTP settings retain owner authorization and the existing database public-field contract", () => {
  const action = readFileSync("app/(app)/admin/settings/support-email/actions.ts", "utf8");
  assert.match(action, /requirePlatformAdmin\(P.teamManage\)/); assert.match(action, /actor.roleSlug !== "platform_owner"/);
  assert.match(action, /await verifySmtp\(config.smtp!\)/); assert.match(action, /No email was sent and settings were not saved/);
  assert.match(action, /p_public: \{ from: visible.from, enabled: visible.enabled, keyConfigured: visible.keyConfigured, domainVerified: visible.domainVerified \}/);
});

test("staff email and booking dispatch use the configured SMTP connection and preserve uncertain delivery", async () => {
  const sharedStub = "export async function getNotificationEmailConfig(){return globalThis.sharedEmailFixture};export async function sendSupportEmail(){throw Error('unexpected Resend fallback')}";
  globalThis.sharedEmailFixture = { provider: "smtp", from: settings.username, smtp: settings, replyTo: "support@example.invalid" };
  let captured;
  globalThis.smtpFixture = () => ({ sendMail: async data => { captured = data; return { accepted: [mail.to], messageId: "notification-id" }; }, close() {} });
  const email = await load("lib/email.ts", { "@/lib/support-email": sharedStub });
  assert.equal(await email.isEmailProviderConfigured(), true);
  assert.equal((await email.sendEmail({ ...mail, html: "<b>Invitation</b>" })).status, "sent");
  assert.equal(captured.html, "<b>Invitation</b>"); assert.equal(captured.replyTo, "support@example.invalid");
  const booking = await load("lib/booking-notifications.ts", { "@/lib/support-email": sharedStub, "@/lib/booksms": "export async function bookSmsConfig(){return null}", "@supabase/supabase-js": "export function createClient(){throw Error('No database calls expected')}" });
  assert.equal((await booking.bookingMessageReadiness()).email, true);
  const message = { id: "message-id", channel: "email", recipient: mail.to, message: "Appointment details", salon_id: "salon", event_key: "confirmation" };
  assert.equal((await booking.sendBookingMessage(message)).state, "accepted"); assert.match(captured.messageId, /booking-message-id/);
  globalThis.smtpFixture = () => ({ sendMail: async () => { throw { code: "ETIMEDOUT" }; }, close() {} });
  assert.equal((await email.sendEmail({ ...mail, html: "Invitation" })).status, "unknown");
  assert.equal((await booking.sendBookingMessage(message)).state, "unknown");
});

test("durable SMTP claims suppress retries after acceptance, timeout or an interrupted send", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    await db.exec(readFileSync("supabase/migrations/20261110213000_smtp_delivery_receipts.sql", "utf8"));
    const claim = async key => (await db.query("select public.claim_smtp_delivery($1) as result", [key])).rows[0].result;
    assert.equal((await claim("accepted")).should_send, true);
    await db.query("select public.finish_smtp_delivery($1,$2,$3)", ["accepted", "sent", "receipt"]);
    assert.deepEqual(await claim("accepted"), { should_send: false, status: "sent" });
    for (const state of ["unknown", "sending"]) {
      await claim(state);
      if (state !== "sending") await db.query("select public.finish_smtp_delivery($1,$2,null)", [state, state]);
      assert.equal((await claim(state)).should_send, false);
    }
    await claim("rejected"); await db.query("select public.finish_smtp_delivery('rejected','failed',null)");
    assert.equal((await claim("rejected")).should_send, true);
    await assert.rejects(db.query("select public.finish_smtp_delivery('accepted','sent',null)"));
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select public.claim_smtp_delivery('untrusted')"));
    await assert.rejects(db.query("select * from public.smtp_delivery_receipts"));
  } finally { await db.close(); }
});

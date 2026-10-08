import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function load(path, stubs = {}) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, platform: "node", format: "esm", plugins: [{ name: "support-fixture", setup(api) {
    api.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "stub" }));
    for (const name of Object.keys(stubs)) api.onResolve({ filter: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }, () => ({ path: name, namespace: "stub" }));
    api.onLoad({ filter: /.*/, namespace: "stub" }, args => ({ contents: stubs[args.path] ?? "export {};", loader: "js" }));
  } }] });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}

test("support form validates all mandatory fields, lengths and email/header injection", async () => {
  const rules = await load("lib/support-rules.ts");
  const requestId = "10000000-0000-4000-8000-000000000001";
  assert.deepEqual(rules.validateSupportContact({ name: "  Customer  ", email: " A@Example.invalid ", message: " Help ", requestId }), { name: "Customer", email: "a@example.invalid", message: "Help", requestId });
  for (const field of ["name", "email", "message"]) assert.throws(() => rules.validateSupportContact({ name: "A", email: "a@example.invalid", message: "Help", requestId, [field]: " " }), /required/);
  assert.throws(() => rules.supportEmail("a@example.invalid\r\nBcc: victim@example.invalid"), /valid email/);
  assert.throws(() => rules.supportText("a".repeat(5001), "Message", 5000), /5000/);
  assert.equal(rules.escapeSupportHtml('<script>"x" & \'y\'</script>'), "&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;");
  assert.match(rules.supportMailto("a@example.invalid", "A&B"), /^mailto:a%40example.invalid\?subject=Reylumi%20support%20%C2%B7%20A%26B$/);
});

test("public support API bounds requests and enforces origin, honeypot, validation and durable throttling", async () => {
  let saved;
  globalThis.__supportRpc = async (_name, args) => { saved = args; return { data: { reference: "10000000" }, error: null }; };
  const api = await load("app/(legal)/api/contact-support/route.ts", {
    next: "", // Route only imports next/server.
    "next/server": "export const NextResponse={json:(data,init)=>Response.json(data,init)};",
    "@/lib/support-server": "export function supportNetworkHash(){return 'a'.repeat(64)};export function supportServiceClient(){return {rpc:(...args)=>globalThis.__supportRpc(...args)}}",
  });
  const payload = { name: "Customer", email: "a@example.invalid", message: "Help", requestId: "10000000-0000-4000-8000-000000000001" };
  const request = (body, headers = {}) => new Request("https://reylumi.com/api/contact-support", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://reylumi.com", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  assert.equal((await api.POST(request(payload))).status, 200);
  assert.equal(saved.p_email, payload.email);
  assert.equal(saved.p_network_hash, "a".repeat(64));
  saved = null;
  assert.equal((await api.POST(request({ ...payload, website: "bot" }))).status, 200);
  assert.equal(saved, null);
  assert.equal((await api.POST(request(payload, { origin: "https://evil.invalid" }))).status, 403);
  assert.equal((await api.POST(request({ ...payload, email: "invalid" }))).status, 400);
  assert.equal((await api.POST(request("x".repeat(25000)))).status, 400);
  globalThis.__supportRpc = async () => ({ error: { message: "Too many support messages." }, data: null });
  const limited = await api.POST(request(payload));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("Retry-After"), "3600");
});

test("support email fixes sender and recipient, escapes customer content, deduplicates and distinguishes uncertain delivery", async () => {
  const email = await load("lib/support-email.ts", { "@/lib/support-server": "export function supportServiceClient(){return {from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})})}}" });
  const previousFetch = globalThis.fetch;
  const config = { apiKey: "re_fake_support_test_key", from: "support@reylumi.com", enabled: true, domainVerified: true };
  const reply = { id: "10000000-0000-4000-8000-000000000001", name: "<Customer>", to: "a@example.invalid", subject: "Reylumi support", body: "<script>unsafe</script>" };
  try {
    globalThis.fetch = async (_url, options) => {
      const data = JSON.parse(options.body);
      assert.equal(data.from, "Reylumi Support <support@reylumi.com>");
      assert.deepEqual(data.to, ["a@example.invalid"]);
      assert.equal(data.reply_to, "support@reylumi.com");
      assert.match(data.html, /&lt;script&gt;/);
      assert.equal(options.headers["Idempotency-Key"], "support-reply/" + reply.id);
      return Response.json({ id: "qa-provider-id" });
    };
    assert.deepEqual(await email.sendSupportEmail(config, reply), { status: "sent", providerId: "qa-provider-id" });
    globalThis.fetch = async () => new Response("", { status: 422 });
    assert.equal((await email.sendSupportEmail(config, reply)).status, "failed");
    globalThis.fetch = async () => new Response("", { status: 503 });
    assert.equal((await email.sendSupportEmail(config, reply)).status, "unknown");
    globalThis.fetch = async () => { throw new Error("Connection lost"); };
    assert.equal((await email.sendSupportEmail(config, reply)).status, "unknown");
    assert.equal((await email.sendSupportEmail({ ...config, apiKey: "" }, reply)).status, "failed");
    globalThis.fetch = async () => Response.json({ data: [{ name: "reylumi.com", status: "verified" }] });
    assert.equal(await email.verifySupportEmailDomain(config), true);
    globalThis.fetch = async () => Response.json({ data: [{ name: "reylumi.com", status: "pending" }] });
    await assert.rejects(email.verifySupportEmailDomain(config), /Verify reylumi.com/);
  } finally { globalThis.fetch = previousFetch; }
});

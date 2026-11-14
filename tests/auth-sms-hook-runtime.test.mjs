import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const compile = path => ts.transpileModule(
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const signatureCode = compile("lib/auth-sms-hook.ts");
const routeCode = compile("app/api/auth/sms-hook/route.ts");
const key = Buffer.alloc(32, 0x5a); // Synthetic fixture key; never reads machine credentials.

function fixture({ providerFails = false, reserveFails = false, acceptWriteFails = false } = {}) {
  const rows = new Map();
  const sends = [];
  const storage = [];
  const signature = {};
  vm.runInNewContext(signatureCode, {
    exports: signature, Buffer,
    require: name => {
      assert.equal(name, "node:crypto");
      return require(name);
    },
  });
  const client = {
    from(table) {
      assert.equal(table, "auth_sms_hook_deliveries");
      return {
        async insert({ id }) {
          storage.push(["insert", id]);
          if (reserveFails) return { error: { code: "unavailable" } };
          if (rows.has(id)) return { error: { code: "23505" } };
          rows.set(id, "sending");
          return { error: null };
        },
        select(column) {
          assert.equal(column, "state");
          return { eq: (column, id) => {
            assert.equal(column, "id");
            return { async single() {
              storage.push(["select", id]);
              return { data: { state: rows.get(id) }, error: null };
            } };
          } };
        },
        update({ state }) {
          return { async eq(column, id) {
            assert.equal(column, "id");
            storage.push(["update", id, state]);
            if (acceptWriteFails && state === "accepted") return { error: { code: "unavailable" } };
            rows.set(id, state);
            return { error: null };
          } };
        },
      };
    },
  };
  const route = {};
  const dependencies = {
    "@/lib/auth-sms-hook": signature,
    "@/lib/system-sms": { async sendSystemSms(purpose, phone, message) {
      sends.push({ purpose, phone, message });
      if (providerFails) throw new Error("Synthetic provider failure");
    } },
    "@/lib/twilio-settings": { twilioSettingsClient: () => client },
  };
  vm.runInNewContext(routeCode, {
    exports: route, Response,
    process: { env: { SUPABASE_SEND_SMS_HOOK_SECRET: `v1,whsec_${key.toString("base64")}` } },
    require: name => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  });
  function request(payload, { id = "fixture-delivery", unsigned = false, tampered = false, stale = false } = {}) {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000) - (stale ? 600 : 0));
    const digest = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
    const headers = unsigned ? {} : {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${digest}`,
    };
    return new Request("https://example.invalid/api/auth/sms-hook", {
      method: "POST", headers,
      body: tampered ? `${body} ` : body,
    });
  }
  return { rows, sends, storage, run: (payload, options) => route.POST(request(payload, options)) };
}

const payload = () => ({
  user: { phone: "", new_phone: "15555550123" },
  sms: { phone: "15555550123", otp: "123456" },
});

test("first phone verification sends to the signed SMS destination when user.phone is empty", async () => {
  const hook = fixture();
  assert.equal((await hook.run(payload())).status, 200);
  assert.deepEqual(hook.sends, [{
    purpose: "authSms", phone: "+15555550123",
    message: "Your Reylumi verification code is 123456. Do not share this code.",
  }]);
  assert.equal(hook.rows.get("fixture-delivery"), "accepted");
});

test("phone changes use sms.phone instead of the current or pending user phone", async () => {
  const hook = fixture();
  const event = payload();
  event.user = { phone: "15555550100", new_phone: "15555550199" };
  event.sms.phone = "+15555550123";
  assert.equal((await hook.run(event)).status, 200);
  assert.equal(hook.sends[0].phone, "+15555550123");
});

test("a new signed resend delivery reaches the same target with its new code", async () => {
  const hook = fixture();
  assert.equal((await hook.run(payload(), { id: "initial" })).status, 200);
  const resend = payload();
  resend.sms.otp = "654321";
  assert.equal((await hook.run(resend, { id: "resend" })).status, 200);
  assert.deepEqual(hook.sends.map(send => send.phone), ["+15555550123", "+15555550123"]);
  assert.match(hook.sends[1].message, /654321/);
});

test("legacy payloads without sms.phone retain the existing user.phone destination", async () => {
  for (const phone of ["15555550100", "+15555550100"]) {
    const hook = fixture();
    const event = { user: { phone, new_phone: "15555550199" }, sms: { otp: "123456" } };
    assert.equal((await hook.run(event)).status, 200);
    assert.equal(hook.sends[0].phone, "+15555550100");
  }
});

test("an explicit invalid sms.phone never falls back to a valid user.phone", async () => {
  for (const phone of ["", " ", null, 15555550123, {}, [], "1234567", "0123456789", "+0123456789", "1555555012345678", "+1 (555) 555-0123", "++15555550123"]) {
    const hook = fixture();
    const event = payload();
    event.user.phone = "15555550100";
    event.sms.phone = phone;
    const response = await hook.run(event);
    assert.equal(response.status, 400, `Invalid target: ${JSON.stringify(phone)}`);
    assert.equal((await response.json()).error.message, "Invalid SMS hook payload.");
    assert.equal(hook.storage.length, 0);
    assert.equal(hook.sends.length, 0);
  }
});

test("missing or malformed legacy targets are rejected before storage or delivery", async () => {
  for (const phone of [undefined, "", null, 15555550123, "+1555"]) {
    const hook = fixture();
    assert.equal((await hook.run({ user: { phone }, sms: { otp: "123456" } })).status, 400);
    assert.equal(hook.storage.length, 0);
    assert.equal(hook.sends.length, 0);
  }
});

test("unsigned, modified, and stale hook requests fail real signature verification", async () => {
  for (const options of [{ unsigned: true }, { tampered: true }, { stale: true }]) {
    const hook = fixture();
    assert.equal((await hook.run(payload(), options)).status, 401);
    assert.equal(hook.storage.length, 0);
    assert.equal(hook.sends.length, 0);
  }
});

test("invalid or non-string OTP values are rejected before storage or delivery", async () => {
  for (const otp of [undefined, "", "123", "12345678901", "12345x", " 123456", 123456, null, {}, []]) {
    const hook = fixture();
    const event = payload();
    event.sms.otp = otp;
    assert.equal((await hook.run(event)).status, 400, `Invalid OTP: ${JSON.stringify(otp)}`);
    assert.equal(hook.storage.length, 0);
    assert.equal(hook.sends.length, 0);
  }
});

test("an accepted webhook replay succeeds without sending the code again", async () => {
  const hook = fixture();
  assert.equal((await hook.run(payload())).status, 200);
  assert.equal((await hook.run(payload())).status, 200);
  assert.equal(hook.sends.length, 1);
  assert.equal(hook.rows.get("fixture-delivery"), "accepted");
});

test("an uncertain or in-progress delivery cannot be replayed", async () => {
  for (const state of ["unknown", "sending"]) {
    const hook = fixture();
    hook.rows.set("fixture-delivery", state);
    assert.equal((await hook.run(payload())).status, 503);
    assert.equal(hook.sends.length, 0);
    assert.equal(hook.rows.get("fixture-delivery"), state);
  }
});

test("a provider failure records an uncertain outcome and never resends on replay", async () => {
  const hook = fixture({ providerFails: true });
  assert.equal((await hook.run(payload())).status, 503);
  assert.equal(hook.rows.get("fixture-delivery"), "unknown");
  assert.equal((await hook.run(payload())).status, 503);
  assert.equal(hook.sends.length, 1);
});

test("failure to reserve delivery prevents the provider request", async () => {
  const hook = fixture({ reserveFails: true });
  assert.equal((await hook.run(payload())).status, 503);
  assert.equal(hook.sends.length, 0);
});

test("failure to persist an accepted delivery prevents an unsafe replay", async () => {
  const hook = fixture({ acceptWriteFails: true });
  assert.equal((await hook.run(payload())).status, 503);
  assert.equal(hook.rows.get("fixture-delivery"), "unknown");
  assert.equal((await hook.run(payload())).status, 503);
  assert.equal(hook.sends.length, 1);
});

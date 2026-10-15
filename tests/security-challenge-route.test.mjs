import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function fixture({ allowed = true, valid = true } = {}) {
  const calls = [], renders = [];
  const exports = {};
  const dependencies = {
    "node:crypto": { randomInt: () => 0, randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    "@/lib/security-challenge-image": {
      SECURITY_CHALLENGE_ALPHABET: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
      createSecurityChallengeImage: async answer => { renders.push(answer); return Buffer.from("raster-only"); },
    },
    "@/lib/abuse-context": { getSafetyContext: async () => ({ deviceHash: "device", ipHash: "ip" }) },
    "@/lib/abuse-signals": { abuseHash: value => "hashed:" + value },
    "@/lib/abuse-server": { abuseServiceClient: () => ({ rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: name === "create_abuse_challenge" ? allowed : valid, error: null };
    } }) },
  };
  const code = ts.transpileModule(readFileSync("app/(app)/api/security/challenge/route.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Buffer, Response, URL, require: name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  } });
  return { ...exports, calls, renders };
}

test("challenge response contains only ID and raster; denied requests never render", async () => {
  const f = fixture();
  const response = await f.GET(), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(body).sort(), ["id", "image"]);
  assert.equal(body.image, "data:image/png;base64," + Buffer.from("raster-only").toString("base64"));
  assert.equal(f.renders[0], "AAAAAA");
  assert.equal(f.calls[0].args.p_device, "device");
  assert.equal(f.calls[0].args.p_ip, "ip");
  assert.equal(f.calls[0].args.p_answer_hash, "hashed:challenge:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:AAAAAA");
  const denied = fixture({ allowed: false });
  assert.equal((await denied.GET()).status, 429);
  assert.equal(denied.renders.length, 0);
});

test("verification retains server device/IP binding, case-insensitivity and wrong-answer rejection", async () => {
  const make = (answer, origin = "https://reylumi.test") => new Request("https://reylumi.test/api/security/challenge", {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", answer, device: "forged", ip: "forged" }),
  });
  const f = fixture();
  assert.deepEqual(await (await f.POST(make(" abc234 "))).json(), { ok: true });
  assert.equal(f.calls[0].args.p_device, "device");
  assert.equal(f.calls[0].args.p_ip, "ip");
  assert.ok(f.calls[0].args.p_answer_hash.endsWith(":ABC234"));
  assert.equal((await f.POST(make("abc234", "https://external.test"))).status, 403);
  assert.equal((await f.POST(make("abc"))).status, 400);
  assert.equal(f.calls.length, 1, "untrusted origin and malformed answer cannot reach verifier");
  const wrong = fixture({ valid: false });
  assert.equal((await wrong.POST(make("ABC234"))).status, 400);
});

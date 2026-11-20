import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { transform } from "esbuild";

const compiled = await transform(fs.readFileSync("lib/abuse-signals.ts", "utf8"), { loader: "ts", format: "esm", target: "node20" });
const signals = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
process.env.ANTISPAM_SIGNING_KEY = "test-signing-key-is-at-least-32-characters";

test("signed device identity rejects tampering and cannot be forged by supplying an ID", () => {
  const token = signals.newDeviceToken();
  assert.ok(signals.readDeviceToken(token));
  assert.equal(signals.readDeviceToken(token.replace(/^./, token[0] === "a" ? "b" : "a")), null);
  assert.equal(signals.readDeviceToken(`${token.split(".")[0]}.${"0".repeat(64)}`), null);
  assert.equal(signals.readDeviceToken(`${token}.extra`), null);
  const ctx = signals.signSafetyContext(token, new Headers(), 1700000000000);
  assert.ok(signals.verifySignedValue(ctx.payload, ctx.signature));
  assert.equal(signals.verifySignedValue(ctx.payload.replace("1700000000", "1700000001"), ctx.signature), false);
  assert.ok(!ctx.payload.includes(token.split(".")[0]));
});

test("network identity trusts Vercel only and ignores spoofable generic forwarding headers", () => {
  const prior = process.env.VERCEL;
  try {
    delete process.env.VERCEL;
    const forged = new Headers({ "x-vercel-forwarded-for": "203.0.113.10", "x-forwarded-for": "198.51.100.1", "x-vercel-ip-country": "US" });
    assert.deepEqual(signals.trustedNetworkSignals(forged), { ipHash: "", country: "" });
    process.env.VERCEL = "1";
    assert.equal(signals.trustedNetworkSignals(forged).ipHash, signals.abuseHash("ip:203.0.113.10"));
    assert.equal(signals.trustedNetworkSignals(new Headers({ "x-forwarded-for": "198.51.100.1" })).ipHash, "");
    assert.deepEqual(signals.trustedNetworkSignals(new Headers({ "x-vercel-forwarded-for": "not-an-ip", "x-vercel-ip-country": "bad country" })), { ipHash: "", country: "" });
  } finally { if (prior === undefined) delete process.env.VERCEL; else process.env.VERCEL = prior; }
});

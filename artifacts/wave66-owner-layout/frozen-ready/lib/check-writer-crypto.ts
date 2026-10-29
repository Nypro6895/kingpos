import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
function keyId() {
  return process.env.CHECK_WRITER_ACTIVE_KEY_ID || "v1";
}
function key(id = keyId()) {
  if (!/^[a-zA-Z\d_-]{1,32}$/.test(id))
    throw Error("Invalid Check Writer key version.");
  let keys: Record<string, string> = {};
  try {
    const configured = process.env.CHECK_WRITER_ENCRYPTION_KEYS;
    if (configured) {
      const parsed = JSON.parse(configured);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw Error();
      keys = parsed;
    }
  } catch {
    throw Error("Check Writer encryption is not configured.");
  }
  const value =
    keys[id] ||
    (id === "v1" ? process.env.CHECK_WRITER_ENCRYPTION_KEY : undefined);
  if (!value || !/^[a-f\d]{64}$/i.test(value))
    throw Error("Check Writer encryption is not configured.");
  return Buffer.from(value, "hex");
}
// Versioned authenticated encryption, bound to salon and purpose. Never reuse
// bank ciphertext for another tenant; keys never leave the application server.
export function encryptBank(salon: string, value: unknown) {
  const version = keyId();
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(version), iv);
  cipher.setAAD(Buffer.from("check-writer:bank:" + version + ":" + salon));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [
    version,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(".");
}
export function checkWriterCryptoReady() {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}
export function decryptBank<T>(salon: string, value: string): T {
  const [v, iv, tag, data] = value.split(".");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(v),
    Buffer.from(iv, "base64url"),
  );
  cipher.setAAD(Buffer.from("check-writer:bank:" + v + ":" + salon));
  cipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(data, "base64url")),
      cipher.final(),
    ]).toString("utf8"),
  ) as T;
}
export function unlockToken(binding: string, expires = Date.now() + 300000) {
  const payload = String(expires),
    mac = createHmac("sha256", key())
      .update("unlock:" + binding + ":" + payload)
      .digest("hex");
  return payload + "." + mac;
}
export function validUnlock(binding: string, token = "") {
  const [expires, mac = ""] = token.split(".");
  if (
    !/^\d+$/.test(expires) ||
    Number(expires) <= Date.now() ||
    Number(expires) > Date.now() + 300000 ||
    !/^[a-f\d]{64}$/.test(mac)
  )
    return false;
  const expected = unlockToken(binding, Number(expires)).split(".")[1];
  return timingSafeEqual(Buffer.from(expected), Buffer.from(mac));
}

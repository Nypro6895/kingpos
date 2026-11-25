import { ed25519 } from "@noble/curves/ed25519.js";

// RFC 8410 Ed25519 SubjectPublicKeyInfo: absent parameters, zero unused bits,
// followed by the 32-byte public key. This is the exact server export format.
const ED25519_SPKI_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
const nativeKeys = new Map<string, Promise<CryptoKey>>();
let nativeEd25519Unsupported = false;

function decode(value: string, maximumLength: number) {
  if (typeof value !== "string" || !value || value.length > maximumLength || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  try {
    return Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), character => character.charCodeAt(0));
  } catch { return null; }
}

function unsupported(error: unknown): boolean {
  return !!error && typeof error === "object" && "name" in error && error.name === "NotSupportedError";
}

/** Verify the same server signature on engines without native Ed25519 support. */
export async function verifyPortableWorkstationSignature(publicKey: string, signature: string, body: string): Promise<boolean> {
  const spki = decode(publicKey, 64);
  const signed = decode(signature, 88);
  if (!spki || spki.length !== ED25519_SPKI_PREFIX.length + 32 ||
      ED25519_SPKI_PREFIX.some((byte, index) => spki[index] !== byte) || !signed || signed.length !== 64) return false;
  // A missing secure-context crypto implementation is not an algorithm mismatch.
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return false;
  const message = new TextEncoder().encode(body);
  if (!nativeEd25519Unsupported) {
    try {
      let imported = nativeKeys.get(publicKey);
      if (!imported) {
        imported = subtle.importKey("spki", spki, { name: "Ed25519" }, false, ["verify"]);
        nativeKeys.set(publicKey, imported);
        if (nativeKeys.size > 32) nativeKeys.delete(nativeKeys.keys().next().value!);
      }
      const key = await imported;
      return await subtle.verify({ name: "Ed25519" }, key, signed, message);
    } catch (error) {
      // Invalid keys/signatures and unexpected crypto failures remain rejected.
      // Only lack of algorithm support selects the maintained JS verifier.
      if (!unsupported(error)) return false;
      nativeEd25519Unsupported = true;
      nativeKeys.clear();
    }
  }
  try {
    return ed25519.verify(signed, message, spki.slice(ED25519_SPKI_PREFIX.length), { zip215: false });
  } catch { return false; }
}

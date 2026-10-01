"use client";

import { desktopDevice, portableDeviceStorage } from "./portable-device-storage";
const storage = () => desktopDevice()?.offline ? portableDeviceStorage : localStorage;

type Bundle = { scope: string; salonId: string; expiresAt: number; publicKey: string;
  staff: { id: string; salt: string; verifierSalt: string; verifier: string }[] };
const prefix = "kingpos:offline-staff:";
const pending = new Map<string, Promise<Bundle | null>>();
const bytes = (value: string) => new TextEncoder().encode(value);
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), b => b.toString(16).padStart(2, "0")).join("");
function cached(scope: string): Bundle | null {
  try {
    const value = JSON.parse(storage().getItem(prefix + scope) ?? "null") as Bundle | null;
    return value?.scope === scope && (!!desktopDevice()?.offline || value.expiresAt > Date.now()) ? value : null;
  } catch { return null; }
}
export async function prepareOfflineStaff(scope: string, refresh = false): Promise<Bundle | null> {
  const existing = cached(scope);
  if (existing && !refresh) return existing;
  if (!navigator.onLine) return existing;
  if (pending.has(scope)) return pending.get(scope)!;
  const request = (async () => {
    try {
      const response = await fetch("/api/pos/portable/offline-staff", { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) return existing;
      const value = await response.json() as Bundle;
      if (value.scope !== scope || !Array.isArray(value.staff)) return existing;
      storage().setItem(prefix + scope, JSON.stringify(value));
      return value;
    } catch { return existing; }
    finally { pending.delete(scope); }
  })();
  pending.set(scope, request);
  return request;
}
export async function verifyAndSealStaffPasscode(scope: string, staffId: string, passcode: string) {
  const bundle = await prepareOfflineStaff(scope);
  const staff = bundle?.staff.find(row => row.id === staffId);
  if (!bundle || !staff) throw new Error("Connect once to prepare staff check-in.");
  const attemptKey = prefix + scope + ":attempts:" + staffId;
  const attempts = JSON.parse(storage().getItem(attemptKey) ?? '{"count":0,"until":0}');
  if (attempts.until > Date.now()) throw new Error("Too many attempts. Try again in a few minutes.");
  const digest = hex(await crypto.subtle.digest("SHA-256", bytes(`${bundle.salonId}:${staffId}:${passcode}:${staff.salt}`)));
  const material = await crypto.subtle.importKey("raw", bytes(digest), "PBKDF2", false, ["deriveBits"]);
  const verifier = hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: bytes(staff.verifierSalt), iterations: 100000 }, material, 256));
  if (verifier !== staff.verifier) {
    const count = attempts.until ? 1 : attempts.count + 1;
    storage().setItem(attemptKey, JSON.stringify({ count, until: count >= 5 ? Date.now() + 300000 : 0 }));
    throw new Error("Incorrect staff PIN.");
  }
  storage().removeItem(attemptKey);
  const key = await crypto.subtle.importKey("spki", Uint8Array.from(atob(bundle.publicKey), c => c.charCodeAt(0)),
    { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, bytes(passcode));
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

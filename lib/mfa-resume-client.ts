"use client";
import { fetchWithDeadline } from "./bounded-get";
import { readAuthResponse } from "./auth-response";

const pending = new Map<string, ReturnType<typeof load>>();
async function load(continuationId: string) {
  const response = await fetchWithDeadline("/api/auth/mfa/challenge", { method: "POST", headers: { Accept: "application/json", "X-Reylumi-Mfa-Continuation": continuationId } }, { timeoutMs: 30_000, totalTimeoutMs: 30_000, maxAttempts: 1 });
  return { ok: response.ok, status: response.status, result: await readAuthResponse(response, "Unable to continue two-factor verification.") };
}
/** Shared only while in flight. Unmounting one consumer must not abort and
 * resend an SMS; completed identities are never cached in client memory. */
export async function resumePendingMfa() {
  const response = await fetchWithDeadline("/api/auth/mfa/challenge", { method: "GET", cache: "no-store", headers: { Accept: "application/json" } }, { timeoutMs: 10_000, totalTimeoutMs: 10_000, maxAttempts: 1 });
  if (!response.ok) return { ok: false, status: response.status, result: await readAuthResponse(response, "Unable to continue two-factor verification.") };
  const data = await response.json() as { continuationId?: unknown };
  if (typeof data.continuationId !== "string" || !/^[a-f0-9]{64}$/.test(data.continuationId)) throw new Error("Invalid sign-in continuation");
  const key = data.continuationId;
  let operation = pending.get(key);
  if (!operation) {
    operation = load(key);
    pending.set(key, operation);
    const active = operation;
    void operation.finally(() => { if (pending.get(key) === active) pending.delete(key); }).catch(() => {});
  }
  return operation;
}

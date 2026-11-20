type ReceiptStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PublicPostReceipt<Input extends object> = { requestId: string; input: Input };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unavailable = "Your saved post status is unavailable. Restore browser storage before retrying this post.";
const invalid = "Your saved post status could not be read safely. Keep this draft and contact support before creating another copy.";
const forbidden = /^(?:file|blob|previewUrl|signedUrl|accessToken|refreshToken|anonKey|apiKey|password|authorization|supabaseUrl)$/i;

function key(scope: string) {
  if (!/^[A-Za-z0-9:._-]{1,250}$/.test(scope)) throw new Error(invalid);
  return `reylumi:public-post:v1:${scope}`;
}
function storage(value?: ReceiptStorage): ReceiptStorage {
  if (value) return value;
  try { if (typeof window !== "undefined") return window.sessionStorage; } catch { /* fail closed */ }
  throw new Error(unavailable);
}
function safeJson(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || value === undefined || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 20000;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 32 && value.every(item => safeJson(item, depth + 1));
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const entries = Object.entries(value);
  return entries.length <= 80 && entries.every(([name, item]) => !forbidden.test(name) && safeJson(item, depth + 1));
}
function parse<Input extends object>(raw: string): PublicPostReceipt<Input> {
  try {
    if (new TextEncoder().encode(raw).length > 32768) throw new Error();
    const record = JSON.parse(raw);
    if (record.version !== 1 || record.status !== "unconfirmed" || !uuid.test(record.requestId) ||
        !record.input || typeof record.input !== "object" || Array.isArray(record.input) ||
        record.input.requestId !== record.requestId || !safeJson(record.input)) throw new Error();
    return { requestId: record.requestId, input: record.input as Input };
  } catch { throw new Error(invalid); }
}

/** Only a missing receipt returns null. A damaged/unreadable receipt must not
 * silently authorize a second request while the first result is uncertain.
 */
export function readPublicPostReceipt<Input extends object>(scope: string, value?: ReceiptStorage): PublicPostReceipt<Input> | null {
  if (!value && typeof window === "undefined") return null;
  let raw: string | null;
  try { raw = storage(value).getItem(key(scope)); } catch { throw new Error(unavailable); }
  return raw === null ? null : parse<Input>(raw);
}

/** Persist BEFORE invoking the create action. Files, previews and credentials
 * never belong in this receipt; the server remains the owner/identity authority.
 */
export function writePublicPostReceipt<Input extends object>(scope: string, receipt: PublicPostReceipt<Input>, value?: ReceiptStorage): void {
  if (!safeJson(receipt.input)) throw new Error(invalid);
  const raw = JSON.stringify({ version: 1, status: "unconfirmed", ...receipt });
  const next = parse<Input>(raw);
  const target = storage(value), name = key(scope);
  try {
    const previous = target.getItem(name);
    if (previous !== null) {
      const prior = parse<Input>(previous);
      if (prior.requestId !== receipt.requestId || JSON.stringify(prior.input) !== JSON.stringify(next.input)) throw new Error(invalid);
    }
    target.setItem(name, raw);
    if (target.getItem(name) !== raw) throw new Error();
  } catch (error) { throw new Error(error instanceof Error && error.message === invalid ? invalid : unavailable); }
}

/** A late response may clear only its own receipt, never a newer request. */
export function clearPublicPostReceipt(scope: string, requestId: string, value?: ReceiptStorage): void {
  const target = storage(value), name = key(scope);
  try {
    const raw = target.getItem(name);
    if (raw === null || parse<object>(raw).requestId !== requestId) return;
    target.removeItem(name);
    if (target.getItem(name) !== null) throw new Error();
  } catch { throw new Error(unavailable); }
}

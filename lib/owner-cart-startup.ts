type CartStorage = Pick<Storage, "getItem" | "setItem">;
type StartupStage = "checkpoint" | "storage-read" | "parse" | "validate" | "create" | "storage-write";
const failureCodes = {
  AbortError: "aborted", ConstraintError: "constraint", DataError: "invalid-data", InvalidStateError: "invalid-state",
  NotAllowedError: "not-allowed", NotFoundError: "not-found", QuotaExceededError: "quota", ReadOnlyError: "read-only",
  SecurityError: "security", SyntaxError: "invalid-json", TimeoutError: "timeout", TransactionInactiveError: "inactive-transaction",
  TypeError: "unsupported", UnknownError: "unavailable", VersionError: "version",
} as const;
type StartupCode = typeof failureCodes[keyof typeof failureCodes] | "unknown" | "invalid";
function failureCode(error: unknown): StartupCode {
  const name = error && typeof error === "object" && "name" in error ? error.name : undefined;
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(failureCodes, name) ? failureCodes[name as keyof typeof failureCodes] : "unknown";
}
export class OwnerCartStartupError extends Error {
  constructor(readonly stage: StartupStage, readonly code: StartupCode, cause?: unknown) {
    super("Saved work could not be opened.", { cause });
    this.name = "OwnerCartStartupError";
  }
}
/** Only fixed stage/code values can leave the error object; never its cause. */
export function ownerCartStartupDiagnostic(error: unknown): string {
  return error instanceof OwnerCartStartupError ? `${error.stage}:${error.code}` : "startup:unknown";
}

function cancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Cancelled", "AbortError");
}

/** A ticket cannot reopen before its durable submission checkpoint is known. */
export async function openOwnerCart<T>({ key, scope, storage, checkpoint, create, isCart, signal, timeoutMs = 8_000 }: {
  key: string;
  scope: string;
  storage: CartStorage;
  checkpoint: (scope: string, key: string) => Promise<number>;
  create: () => T;
  isCart: (value: unknown) => value is T;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<T> {
  cancelled(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let stage: StartupStage = "checkpoint";
  const stopped = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OwnerCartStartupError("checkpoint", "timeout")), timeoutMs);
    abort = () => reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    const savedThrough = await Promise.race([Promise.resolve().then(() => checkpoint(scope, key)), stopped]);
    cancelled(signal);
    if (!Number.isFinite(savedThrough) || savedThrough < 0) throw new OwnerCartStartupError("checkpoint", "invalid");
    // Read after the checkpoint resolves. A cancelled/older attempt never
    // writes a captured snapshot over a newer ticket or a different workspace.
    stage = "storage-read";
    const text = storage.getItem(key);
    let next: T;
    if (text === null) { stage = "create"; next = create(); }
    else {
      stage = "parse";
      const saved: unknown = JSON.parse(text);
      stage = "validate";
      if (!saved || typeof saved !== "object" || !("savedAt" in saved) || typeof saved.savedAt !== "number" || !Number.isFinite(saved.savedAt) || saved.savedAt <= 0 || !("cart" in saved) || !isCart(saved.cart)) throw new OwnerCartStartupError("validate", "invalid");
      if (saved.savedAt > savedThrough) next = saved.cart;
      else { stage = "create"; next = create(); }
    }
    cancelled(signal);
    stage = "storage-write";
    storage.setItem(key, JSON.stringify({ savedAt: Date.now(), cart: next }));
    return next;
  } catch (error) {
    if (signal?.aborted || error instanceof OwnerCartStartupError) throw error;
    throw new OwnerCartStartupError(stage, failureCode(error), error);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

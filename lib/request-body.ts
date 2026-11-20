/** A request body failure that is safe to return before calling any provider. */
export class RequestBodyError extends Error {
  constructor(readonly status: 400 | 408 | 413, message: string) {
    super(message);
    this.name = "RequestBodyError";
  }
}

/** Read raw UTF-8 without reserializing signed payloads; bound actual streamed bytes. */
export async function readBoundedRequestText(
  request: Request,
  maximumBytes: number,
  deadlineMs = 10_000,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 ||
      !Number.isSafeInteger(deadlineMs) || deadlineMs < 1) {
    throw new RangeError("Invalid request body budget");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new RequestBodyError(400, "Invalid content length");
  }
  if (declared !== null && Number(declared) > maximumBytes) {
    void request.body?.cancel().catch(() => {});
    throw new RequestBodyError(413, "Payload too large");
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      void reader.cancel().catch(() => {});
      reject(new RequestBodyError(408, "Request body timed out"));
    }, deadlineMs);
  });
  try {
    for (;;) {
      const part = await Promise.race([reader.read(), timeout]);
      if (timedOut) throw new RequestBodyError(408, "Request body timed out");
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximumBytes) {
        void reader.cancel().catch(() => {});
        throw new RequestBodyError(413, "Payload too large");
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new RequestBodyError(400, "Invalid UTF-8 payload");
    }
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    throw new RequestBodyError(400, "Unreadable request body");
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
}

export function requestBodyFailure(error: unknown): Response {
  const status = error instanceof RequestBodyError ? error.status : 400;
  return Response.json({ error: status === 413 ? "Payload too large" : "Invalid request body" }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}

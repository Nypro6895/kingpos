/** Bound raw bytes before parsing, including chunked requests without Content-Length. */
export async function readCheckBody(request: Request, maximum = 65536) {
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw Error("Expected a JSON request.");
  if (Number(request.headers.get("content-length") ?? 0) > maximum)
    throw Error("Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw Error("Missing request body.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maximum) {
        await reader.cancel();
        throw Error("Request too large.");
      }
      chunks.push(part.value);
    }
    const buffer = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(buffer),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Invalid request.");
    return value;
  } catch (error) {
    if (error instanceof SyntaxError) throw Error("Invalid JSON request.");
    throw error;
  } finally {
    reader.releaseLock();
  }
}

import "server-only";

import { createHash } from "node:crypto";
import type { LiveResourceResponse, LiveResourceSnapshot } from "./experience-live-resource";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");

export function createLiveResourceSnapshot<T extends object>(
  data: T,
  volatileKeys: Array<keyof T> = [],
): LiveResourceSnapshot<T> {
  const sections: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!volatileKeys.includes(key as keyof T)) sections[key] = hash(value);
  }
  return { data, sections, revision: hash(sections), updatedAt: new Date().toISOString() };
}

export function liveResourceResponse<T extends object>(
  request: Request,
  snapshot: LiveResourceSnapshot<T>,
): Response {
  const etag = `"${snapshot.revision}"`;
  const headers = { "Cache-Control": "private, no-store", ETag: etag, Vary: "Cookie" };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  const raw = new URL(request.url).searchParams.get("sections");
  let previous: Record<string, unknown> | null = null;
  if (raw && raw.length <= 8192) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) previous = parsed as Record<string, unknown>;
    } catch { /* Invalid revisions request a complete authorized snapshot. */ }
  }
  const data: Partial<T> = previous ? {} : snapshot.data;
  if (previous) {
    for (const [key, value] of Object.entries(snapshot.data)) {
      // Volatile display fields travel only alongside an actual changed snapshot.
      if (!snapshot.sections[key] || previous[key] !== snapshot.sections[key]) {
        Object.assign(data, { [key]: value });
      }
    }
  }
  const response: LiveResourceResponse<T> = { ...snapshot, data, partial: previous !== null };
  return Response.json(response, { headers });
}

import "server-only";
import { createHash } from "node:crypto";
import type { ReadRequestTiming } from "./read-request-timing";

// Call only AFTER current authentication, grants and requested scope are checked.
// Conditional reads save transfer; they never bypass the authorized database read.
export function workspaceResourceResponse(request: Request, data: object, timing?: ReadRequestTiming) {
  const serialize = () => {
    const body = JSON.stringify(data);
    return { body, etag: `"${createHash("sha256").update(body).digest("hex")}"` };
  };
  const { body, etag } = timing ? timing.measureSync("serialize", serialize) : serialize();
  const headers = { "Cache-Control": "private, no-store", ETag: etag, Vary: "Cookie" };
  const response = request.headers.get("if-none-match") === etag
    ? new Response(null, { status: 304, headers })
    : new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
  return timing ? timing.finish(response) : response;
}

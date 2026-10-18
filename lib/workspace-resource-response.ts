import "server-only";
import { createHash } from "node:crypto";

// Call only AFTER current authentication, grants and requested scope are checked.
// Conditional reads save transfer; they never bypass the authorized database read.
export function workspaceResourceResponse(request: Request, data: object) {
  const body = JSON.stringify(data);
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  const headers = { "Cache-Control": "private, no-store", ETag: etag, Vary: "Cookie" };
  return request.headers.get("if-none-match") === etag
    ? new Response(null, { status: 304, headers })
    : new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
}

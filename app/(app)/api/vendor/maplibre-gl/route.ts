import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const filePath = path.join(
    process.cwd(),
    "node_modules",
    "maplibre-gl",
    "dist",
    "maplibre-gl.js",
  );
  const body = await readFile(filePath);

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": "text/javascript; charset=utf-8",
    },
  });
}

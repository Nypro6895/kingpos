import { IMAGE_POLICY } from "@/lib/image-policy";
import { normalizeImage } from "@/lib/normalize-image";
import { getSupabaseAuthUser } from "@/lib/supabase/server";

const headers = { "Cache-Control": "private, no-store" };
const failure = (status: number) => Response.json({ error: "Image could not be processed." }, { status, headers });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") return failure(403);
  try {
    if (!await getSupabaseAuthUser()) return failure(401);
  } catch { return failure(503); }
  if (!["image/png", "image/jpeg"].includes(request.headers.get("content-type") ?? "")) return failure(415);
  if (Number(request.headers.get("content-length")) > IMAGE_POLICY.maxInputBytes) return failure(413);
  // Bound the body while streaming, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return failure(400);
  try {
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > IMAGE_POLICY.maxInputBytes) { await reader.cancel(); return failure(413); }
      chunks.push(value);
    }
    const image = await normalizeImage(Buffer.concat(chunks));
    return new Response(new Uint8Array(image.data), { headers: {
      ...headers, "Content-Type": image.mimeType,
      "X-Image-Width": String(image.width), "X-Image-Height": String(image.height),
    } });
  } catch { return failure(400); }
}

import { getWindowsPosRelease } from "@/lib/windows-pos-release";

export async function GET() {
  const release = await getWindowsPosRelease();
  if (!release) return new Response("Windows installer is not available yet.", { status: 503 });
  return new Response(null, {
    status: 307,
    headers: { Location: release.href, "Cache-Control": "no-store" },
  });
}

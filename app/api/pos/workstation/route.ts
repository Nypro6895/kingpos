import { NextResponse } from "next/server";
import { isSameOriginMutation } from "@/lib/request-origin";
import { getPortableWorkstationSession, handlePortableWorkstationRequest, PortableWorkstationError } from "@/lib/portable-workstation-server";

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof PortableWorkstationError ? error.message : "Workstation connection is temporarily unavailable." }, {
    status: error instanceof PortableWorkstationError ? error.status : 503, headers: { "Cache-Control": "no-store" },
  });
}
export async function GET(request: Request) {
  try { return NextResponse.json(await getPortableWorkstationSession(request), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 128_000) return NextResponse.json({ error: "Workstation request is too large." }, { status: 413 });
  let input: unknown;
  try { input = JSON.parse(raw); }
  catch { return NextResponse.json({ error: "Invalid workstation request." }, { status: 400 }); }
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return NextResponse.json({ error: "Invalid workstation request." }, { status: 400 });
    return NextResponse.json(await handlePortableWorkstationRequest(request, input as Record<string, unknown>), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

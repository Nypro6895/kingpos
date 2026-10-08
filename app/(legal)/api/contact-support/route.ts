import { NextResponse } from "next/server";
import { supportNetworkHash, supportServiceClient } from "@/lib/support-server";
import { validateSupportContact } from "@/lib/support-rules";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Submit the form from this website." }, { status: 403 });
  let input: Record<string, unknown>;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Empty request.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 24000) { await reader.cancel(); throw new Error("Message is too large."); }
      chunks.push(part.value);
    }
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid request.");
  } catch {
    return NextResponse.json({ error: "Unable to read this message. Check the form and try again." }, { status: 400 });
  }
  try {
    const contact = validateSupportContact(input);
    if (input.website) return NextResponse.json({ ok: true, reference: contact.requestId.slice(0, 8).toUpperCase() });
    const network = request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { data, error } = await supportServiceClient().rpc("submit_support_contact", {
      p_request_id: contact.requestId, p_name: contact.name, p_email: contact.email, p_message: contact.message, p_network_hash: supportNetworkHash(network),
    });
    if (error) {
      if (error.message.includes("Too many")) return NextResponse.json({ error: "Too many messages. Please try again in an hour." }, { status: 429, headers: { "Retry-After": "3600" } });
      console.error("Support contact submission failed", { code: error.code });
      return NextResponse.json({ error: "Your message could not be saved. Please try again later." }, { status: 503 });
    }
    return NextResponse.json({ ok: true, reference: data.reference }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to submit this message." }, { status: 400 });
  }
}

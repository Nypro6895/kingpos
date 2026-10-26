import { NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/platform-admin/auth";
import { supportRpc, signSupportAttachments, type SupportConversation } from "@/lib/support-cases";
import { createHash } from "node:crypto";

export async function GET(request: NextRequest) {
  await requirePlatformAdmin();
  const headers = { "Cache-Control": "private, no-store" };
  const id = request.nextUrl.searchParams.get("case");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Invalid request." }, { status: 400, headers });
  try {
    const conversation = await supportRpc<SupportConversation>("get_support_conversation", { p_report_id: id }, false);
    if (!conversation) throw Error("Unavailable");
    const etag = `"${createHash("sha256").update(JSON.stringify(conversation)).digest("hex")}"`;
    if(request.headers.get("if-none-match")===etag)return new Response(null,{status:304,headers:{...headers,ETag:etag}});
    await signSupportAttachments(conversation);
    return Response.json(conversation, { headers: {...headers,ETag:etag} });
  } catch { return Response.json({ error: "Conversation unavailable or access denied." }, { status: 404, headers }); }
}

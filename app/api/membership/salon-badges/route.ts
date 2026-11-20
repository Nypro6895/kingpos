import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createAuthenticatedSupabaseServerClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentPlatformAdminContext } from "@/lib/platform-admin/auth";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = {"Cache-Control": "private, no-store", "Vary": "Cookie"};
type Rpc = (name: string, args: Record<string, unknown>) => Promise<{data: unknown; error: unknown}>;
export async function POST(request: NextRequest) {
 try {
  if (Number(request.headers.get("content-length")) > 10000) return NextResponse.json({badges: []}, {status: 400, headers});
  const text = await request.text(); if (text.length > 10000) throw Error("Invalid size");
  const body = JSON.parse(text);
  if (!Array.isArray(body.ids) || body.ids.length > 100 || body.ids.some((id: unknown) => typeof id !== "string" || !UUID.test(id))) throw Error("Invalid IDs");
  const ids = [...new Set(body.ids as string[])];
  const reference = body.reference;
  if (reference && (!['display','entry','visit','invitation','claim'].includes(reference.kind) || typeof reference.value !== 'string' || reference.value.length < 1 || reference.value.length > 256)) throw Error("Invalid reference");
  const authenticated = await createAuthenticatedSupabaseServerClient();
  const client = authenticated ?? createSupabaseServerClient();
  if (!client) return NextResponse.json({badges: []}, {status: 503, headers});
  const rpc = client.rpc.bind(client) as unknown as Rpc;
  let result: {data: unknown; error: unknown};
  if (reference) result = await rpc('reylumi_membership_reference_badge', {p_kind: reference.kind, p_reference: reference.value});
  else if (authenticated) {
   const admin = await getCurrentPlatformAdminContext();
   result = await rpc('reylumi_membership_scoped_badges', {p_ids: ids, p_admin: Boolean(admin)});
  } else result = await rpc('reylumi_membership_salon_badges', {p_salon_ids: ids});
  if (result.error) return NextResponse.json({badges: []}, {status: 503, headers});
  let rows = Array.isArray(result.data) ? result.data : [];
  if (!reference && ids.length) {
   const jar = await cookies(), key = jar.get('kingpos-portable-pos-key-id')?.value, signature = jar.get('kingpos-portable-pos-session')?.value;
   if (jar.get('kingpos-portable-local-lock')?.value !== '1' && key && UUID.test(key) && signature && signature.length <= 512) {
    const portable = await rpc('reylumi_membership_portable_badges', {p_ids: ids, p_key: key, p_signature: signature});
    if (!portable.error && Array.isArray(portable.data)) rows = [...rows, ...portable.data];
   }
  }
  const badges = rows.filter((row: {salon_id?: unknown;valid_until?: unknown}) => typeof row.salon_id === 'string' && UUID.test(row.salon_id) && typeof row.valid_until === 'string' && (!ids.length || ids.includes(row.salon_id))).map((row: {salon_id: string;valid_until: string}) => ({salon_id: row.salon_id, valid_until: row.valid_until}));
  return NextResponse.json({badges}, {headers});
 } catch { return NextResponse.json({badges: []}, {status: 400, headers}); }
}

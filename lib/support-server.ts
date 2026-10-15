import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

export function supportServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Support is temporarily unavailable. Please try again later.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function supportNetworkHash(address: string) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Support is temporarily unavailable. Please try again later.");
  return createHmac("sha256", key).update(`support-network:${address}`).digest("hex");
}

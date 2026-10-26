import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export const EXPLORE_VISITOR_COOKIE = "reylumi-explore-visitor";

export async function getExploreVisitorKey() {
  const client = await createAuthenticatedSupabaseServerClient();
  const identity = client ? await client.rpc("current_public_user_id") : null;
  if (client && identity?.error) throw new Error("Discovery identity could not be verified. Please try again.");
  if (client) {
    if (typeof identity?.data !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(identity.data)) {
      throw new Error("Discovery identity is temporarily unavailable.");
    }
    return `user:${identity.data}`;
  }
  const jar = await cookies();
  let visitor = jar.get(EXPLORE_VISITOR_COOKIE)?.value ?? "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(visitor)) {
    visitor = randomUUID();
    jar.set(EXPLORE_VISITOR_COOKIE, visitor, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
      path: "/", maxAge: 60 * 60 * 24 * 30,
    });
  }
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Discovery is temporarily unavailable.");
  return `guest:${createHmac("sha256", secret).update(visitor).digest("hex")}`;
}

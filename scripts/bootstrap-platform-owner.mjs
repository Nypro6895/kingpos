#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const CONFIRM_FLAG = "--confirm-bootstrap-platform-owner";

function readArgValue(name) {
  const index = process.argv.indexOf(name);

  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/bootstrap-platform-owner.mjs --user-id <public-users-id> --reason <reason> --confirm-bootstrap-platform-owner",
      "  node scripts/bootstrap-platform-owner.mjs --email <user-email> --reason <reason> --confirm-bootstrap-platform-owner",
      "",
      "Required environment:",
      "  NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL",
      "  SUPABASE_SERVICE_ROLE_KEY",
    ].join("\n"),
  );
}

const userId = readArgValue("--user-id");
const email = readArgValue("--email")?.trim().toLowerCase() ?? null;
const reason = readArgValue("--reason") ?? "Initial platform owner bootstrap";
const supabaseUrl =
  process.env.SUPABASE_URL?.trim() ?? process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if ((!userId && !email) || (userId && !uuidPattern.test(userId)) || !hasFlag(CONFIRM_FLAG)) {
  usage();
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing Supabase URL or service-role key environment.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

let targetUserId = userId;

if (!targetUserId && email) {
  const { data: userRow, error: userLookupError } = await supabase
    .from("users")
    .select("id, status")
    .eq("email", email)
    .maybeSingle();

  if (userLookupError) {
    console.error("Platform owner user lookup failed:", userLookupError.message);
    process.exit(1);
  }

  if (!userRow?.id) {
    console.error("No public.users row exists for that email.");
    process.exit(1);
  }

  if (userRow.status === "suspended" || userRow.status === "deleted") {
    console.error("That user is suspended or deleted and cannot be bootstrapped.");
    process.exit(1);
  }

  targetUserId = userRow.id;
}

const { data, error } = await supabase.rpc("bootstrap_platform_owner", {
  bootstrap_reason: reason,
  target_user_id: targetUserId,
});

if (error) {
  console.error("Platform owner bootstrap failed:", error.message);
  process.exit(1);
}

console.log("Platform owner bootstrap complete.");
console.log(`Membership ID: ${data}`);

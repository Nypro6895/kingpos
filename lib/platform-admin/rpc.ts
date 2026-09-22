import "server-only";

import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

type RpcArgs = Record<string, unknown>;

function adminSafeErrorMessage(message: string) {
  if (
    message.includes("permission denied") ||
    message.includes("Permission denied") ||
    message.includes("access denied") ||
    message.includes("Authentication is required") ||
    message.includes("Platform admin")
  ) {
    return "You do not have permission to perform that admin action.";
  }

  if (message.includes("not found") || message.includes("not exist")) {
    return "The requested admin record could not be found.";
  }

  if (
    message.includes("Invalid") ||
    message.includes("required") ||
    message.includes("must be") ||
    message.includes("cannot")
  ) {
    return message;
  }

  return "Unable to complete the admin request.";
}

export async function callPlatformAdminRpc<TResult>(
  functionName: string,
  args: RpcArgs = {},
) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Admin data service is unavailable.");
  }

  const { data, error } = await supabase.rpc(functionName, args);

  if (error) {
    console.error("Platform admin RPC failed", {
      code: error.code,
      details: error.details,
      functionName,
      hint: error.hint,
      message: error.message,
    });
    throw new Error(adminSafeErrorMessage(error.message));
  }

  return data as TResult;
}

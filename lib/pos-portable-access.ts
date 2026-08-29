import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import {
  DEFAULT_PORTABLE_POS_CAPABILITIES,
  PORTABLE_POS_CAPABILITIES,
  type PortablePosCapability,
} from "@/lib/pos-portable-capabilities";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export const POS_PORTABLE_ACCESS_SELECT =
  "id, salon_id, access_id, label, capabilities, is_active, last_used_at, last_login_at, last_logout_at, last_user_agent, created_at, updated_at";

export type PortablePosAccessKey = {
  access_id: string;
  capabilities: PortablePosCapability[];
  created_at: string;
  id: string;
  is_active: boolean;
  label: string | null;
  last_login_at: string | null;
  last_logout_at: string | null;
  last_used_at: string | null;
  last_user_agent: string | null;
  salon_id: string;
  updated_at: string;
};

export type PortablePosAccessState = {
  keys: PortablePosAccessKey[];
  schemaReady: boolean;
  setupMessage: string | null;
};

export const PORTABLE_POS_ACCESS_SETUP_MESSAGE =
  "Portable POS database setup is not applied yet. Apply the Portable POS access migrations through 202607250001_portable_shell_views.sql before creating POS IDs.";

function isMissingPortablePosAccessSchemaError(error: {
  code?: string | null;
  message?: string | null;
}) {
  const message = error.message ?? "";

  return (
    (error.code === "PGRST205" &&
      message.includes("pos_portable_access_keys")) ||
    (error.code === "42P01" &&
      message.includes("pos_portable_access_keys")) ||
    (error.code === "42703" &&
      message.includes("pos_portable_access_keys"))
  );
}

function requirePortableAccessContext(context: CurrentBusinessContext) {
  if (!context.user || !isSalonManageContext(context) || !context.currentSalon) {
    throw new Error("Choose an owner salon workspace first.");
  }

  return {
    salon: context.currentSalon,
  };
}

function normalizePortableCapabilities(value: unknown): PortablePosCapability[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_PORTABLE_POS_CAPABILITIES];
  }

  const allowed = new Set<string>(Object.values(PORTABLE_POS_CAPABILITIES));
  const capabilities = value.filter(
    (item): item is PortablePosCapability =>
      typeof item === "string" && allowed.has(item),
  );

  return [...new Set(capabilities)];
}

export async function getCurrentSalonPortablePosAccessKeys(
  context?: CurrentBusinessContext,
) {
  return (await getCurrentSalonPortablePosAccessState(context)).keys;
}

export async function getCurrentSalonPortablePosAccessState(
  context?: CurrentBusinessContext,
): Promise<PortablePosAccessState> {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
  const { salon } = requirePortableAccessContext(resolvedContext);

  if (!(await hasPermission("salon_settings.view", resolvedContext))) {
    return {
      keys: [],
      schemaReady: true,
      setupMessage: null,
    };
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("pos_portable_access_keys")
    .select(POS_PORTABLE_ACCESS_SELECT)
    .eq("salon_id", salon.id)
    .order("created_at", { ascending: false })
    .returns<PortablePosAccessKey[]>();

  if (error) {
    if (isMissingPortablePosAccessSchemaError(error)) {
      console.warn("Portable POS access schema is not applied.", {
        code: error.code,
        message: error.message,
        salonId: salon.id,
      });

      return {
        keys: [],
        schemaReady: false,
        setupMessage: PORTABLE_POS_ACCESS_SETUP_MESSAGE,
      };
    }

    console.error("Supabase load Portable POS access keys failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: salon.id,
    });
    throw new Error(error.message);
  }

  return {
    keys: (data ?? []).map((key) => ({
      ...key,
      capabilities: normalizePortableCapabilities(key.capabilities),
    })),
    schemaReady: true,
    setupMessage: null,
  };
}

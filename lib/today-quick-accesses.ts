import "server-only";

import {
  ROLE_MORE_ITEMS,
  type NavigationIcon,
} from "@/app/role-navigation";
import {
  isOwnerMembership,
  isSalonManageContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

export const TODAY_QUICK_ACCESS_MAX_SELECTED = 8;

export type TodayQuickAccessId =
  | "customers"
  | "daily_log"
  | "members_roles"
  | "payroll"
  | "permissions"
  | "pos"
  | "reports"
  | "services"
  | "settings"
  | "staff"
  | "tax";

export type TodayQuickAccess = {
  description: string;
  href: string;
  icon: NavigationIcon;
  id: TodayQuickAccessId;
  label: string;
};

export type TodayQuickAccessConfiguration = {
  available: TodayQuickAccess[];
  canCustomize: boolean;
  loadError: string | null;
  maxSelected: number;
  selected: TodayQuickAccess[];
};

type TodayQuickAccessDefinition = TodayQuickAccess & {
  ownerOnly?: boolean;
  permissionCodes?: readonly string[];
};

type TodayQuickAccessSource = {
  description?: string;
  href?: string;
  icon?: NavigationIcon;
  id: TodayQuickAccessId;
  label?: string;
  ownerOnly?: boolean;
  permissionCodes?: readonly string[];
  roleMoreItemId?: string;
};

type PreferenceReadResult =
  | { error: null; exists: boolean; ids: string[] }
  | { error: string; exists: false; ids: [] };

const QUICK_ACCESS_SOURCES: readonly TodayQuickAccessSource[] = [
  {
    id: "payroll",
    permissionCodes: ["payroll.view", "payroll.manage"],
    roleMoreItemId: "owner-payroll",
  },
  {
    description: "Company tax payroll view for the current salon.",
    href: "/payroll/tax-company",
    icon: "cash",
    id: "tax",
    label: "Tax",
    permissionCodes: ["payroll.tax_company", "payroll.view", "payroll.manage"],
  },
  {
    id: "daily_log",
    label: "Daily Log",
    permissionCodes: ["tickets.view", "tickets.manage"],
    roleMoreItemId: "owner-ticket",
  },
  {
    id: "reports",
    permissionCodes: ["reports.view"],
    roleMoreItemId: "owner-report",
  },
  {
    id: "staff",
    permissionCodes: ["staff.view"],
    roleMoreItemId: "owner-staff",
  },
  {
    id: "services",
    permissionCodes: ["services.view"],
    roleMoreItemId: "owner-services",
  },
  {
    id: "customers",
    label: "Clients",
    permissionCodes: ["customers.view"],
    roleMoreItemId: "owner-customers",
  },
  {
    id: "pos",
    permissionCodes: ["tickets.manage"],
    roleMoreItemId: "owner-pos",
  },
  {
    id: "settings",
    label: "Settings",
    permissionCodes: ["salon_settings.view"],
    roleMoreItemId: "owner-setting",
  },
  {
    description: "Account permission catalog and role permission matrix.",
    href: "/permissions",
    icon: "gear",
    id: "permissions",
    label: "Permissions",
    ownerOnly: true,
  },
  {
    description: "Account members and role assignments.",
    href: "/roles",
    icon: "people",
    id: "members_roles",
    label: "Members",
    ownerOnly: true,
  },
];

const DEFAULT_QUICK_ACCESS_IDS: readonly TodayQuickAccessId[] = [
  "payroll",
  "daily_log",
  "tax",
  "staff",
];

const OWNER_MORE_ITEM_BY_ID = new Map(
  ROLE_MORE_ITEMS.owner.map((item) => [item.id, item]),
);

function resolveDefinition(
  source: TodayQuickAccessSource,
): TodayQuickAccessDefinition {
  const roleItem = source.roleMoreItemId
    ? OWNER_MORE_ITEM_BY_ID.get(source.roleMoreItemId)
    : null;
  const href = source.href ?? roleItem?.href;

  if (!href) {
    throw new Error(`Missing Today quick access route for ${source.id}.`);
  }

  return {
    description:
      source.description ?? roleItem?.description ?? source.label ?? source.id,
    href,
    icon: source.icon ?? roleItem?.navigationIcon ?? "grid",
    id: source.id,
    label: source.label ?? roleItem?.label ?? source.id,
    ownerOnly: source.ownerOnly,
    permissionCodes: source.permissionCodes,
  };
}

export const TODAY_QUICK_ACCESS_DEFINITIONS: readonly TodayQuickAccessDefinition[] =
  QUICK_ACCESS_SOURCES.map(resolveDefinition);

function hasContextPermission(
  context: CurrentBusinessContext,
  permissionCode: string,
) {
  return (
    context.permissionCodes.includes("*") ||
    context.permissionCodes.includes(permissionCode)
  );
}

function canUseQuickAccessDefinition(
  context: CurrentBusinessContext,
  definition: TodayQuickAccessDefinition,
) {
  const isOwner = isOwnerMembership(context.currentMembership);

  if (definition.ownerOnly) {
    return isOwner;
  }

  if (isOwner) {
    return true;
  }

  if (!definition.permissionCodes || definition.permissionCodes.length === 0) {
    return true;
  }

  return definition.permissionCodes.some((permissionCode) =>
    hasContextPermission(context, permissionCode),
  );
}

function getAuthorizedDefinitions(context: CurrentBusinessContext) {
  return TODAY_QUICK_ACCESS_DEFINITIONS.filter((definition) =>
    canUseQuickAccessDefinition(context, definition),
  );
}

function asQuickAccess(
  definition: TodayQuickAccessDefinition,
): TodayQuickAccess {
  return {
    description: definition.description,
    href: definition.href,
    icon: definition.icon,
    id: definition.id,
    label: definition.label,
  };
}

function uniqueKnownIds(ids: string[]) {
  const knownIds = new Set(TODAY_QUICK_ACCESS_DEFINITIONS.map((item) => item.id));
  const seen = new Set<string>();
  const normalized: TodayQuickAccessId[] = [];

  for (const id of ids) {
    if (!knownIds.has(id as TodayQuickAccessId) || seen.has(id)) {
      continue;
    }

    normalized.push(id as TodayQuickAccessId);
    seen.add(id);
  }

  return normalized;
}

function filterAuthorizedIds(
  ids: string[],
  authorizedDefinitions: TodayQuickAccessDefinition[],
) {
  const authorizedIds = new Set(authorizedDefinitions.map((item) => item.id));

  return uniqueKnownIds(ids)
    .filter((id) => authorizedIds.has(id))
    .slice(0, TODAY_QUICK_ACCESS_MAX_SELECTED);
}

function defaultSelectedIds(
  authorizedDefinitions: TodayQuickAccessDefinition[],
) {
  const authorizedIds = new Set(authorizedDefinitions.map((item) => item.id));
  const selected = DEFAULT_QUICK_ACCESS_IDS.filter((id) =>
    authorizedIds.has(id),
  );

  for (const definition of authorizedDefinitions) {
    if (selected.length >= 4) {
      break;
    }

    if (!selected.includes(definition.id)) {
      selected.push(definition.id);
    }
  }

  return selected.slice(0, TODAY_QUICK_ACCESS_MAX_SELECTED);
}

function validateAuthorizedIds(
  ids: string[],
  authorizedDefinitions: TodayQuickAccessDefinition[],
) {
  const knownIds = new Set(TODAY_QUICK_ACCESS_DEFINITIONS.map((item) => item.id));
  const authorizedIds = new Set(authorizedDefinitions.map((item) => item.id));
  const seen = new Set<string>();
  const normalized: TodayQuickAccessId[] = [];

  if (ids.length > TODAY_QUICK_ACCESS_MAX_SELECTED) {
    throw new Error("Too many quick access shortcuts.");
  }

  for (const id of ids) {
    if (!knownIds.has(id as TodayQuickAccessId)) {
      throw new Error("That shortcut is not recognized.");
    }

    if (!authorizedIds.has(id as TodayQuickAccessId)) {
      throw new Error("You do not have permission to save that shortcut.");
    }

    if (seen.has(id)) {
      throw new Error("Duplicate shortcuts are not allowed.");
    }

    normalized.push(id as TodayQuickAccessId);
    seen.add(id);
  }

  return normalized;
}

async function readStoredQuickAccessIds(input: {
  salonId: string;
  userId: string;
}): Promise<PreferenceReadResult> {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return {
      error: "Saved shortcuts are unavailable because Supabase is not configured.",
      exists: false,
      ids: [],
    };
  }

  const { data, error } = await supabase
    .from("today_quick_access_preferences")
    .select("shortcut_ids")
    .eq("salon_id", input.salonId)
    .eq("user_id", input.userId)
    .maybeSingle<{ shortcut_ids: string[] | null }>();

  if (error) {
    console.error("Supabase load Today quick accesses failed", {
      code: error.code,
      details: error.details,
      hasAuthenticatedUserContext: Boolean(input.userId),
      hasSalonContext: Boolean(input.salonId),
      hint: error.hint,
      message: error.message,
      operation:
        "select today_quick_access_preferences shortcut_ids by user_id and salon_id",
    });

    return {
      error:
        error.code === "42P01" ||
        error.code === "42501" ||
        error.code === "PGRST205"
          ? "Saved shortcuts table is unavailable; showing defaults."
          : "Saved shortcuts could not load; showing defaults.",
      exists: false,
      ids: [],
    };
  }

  return {
    error: null,
    exists: Boolean(data),
    ids: Array.isArray(data?.shortcut_ids) ? data.shortcut_ids : [],
  };
}

function requireQuickAccessContext(context: CurrentBusinessContext) {
  if (!context.user) {
    throw new Error("You must be logged in to customize Today.");
  }

  if (!isSalonManageContext(context) || !context.currentSalon) {
    throw new Error("Open Today from a salon management workspace.");
  }

  return {
    salonId: context.currentSalon.id,
    userId: context.user.id,
  };
}

export async function getTodayQuickAccessConfiguration(
  context: CurrentBusinessContext,
): Promise<TodayQuickAccessConfiguration> {
  const authorizedDefinitions = getAuthorizedDefinitions(context);
  const identity =
    context.user && context.currentSalon
      ? { salonId: context.currentSalon.id, userId: context.user.id }
      : null;
  const readResult = identity
    ? await readStoredQuickAccessIds(identity)
    : { error: null, exists: false, ids: [] as string[] };
  const selectedIds = readResult.exists
    ? filterAuthorizedIds(readResult.ids, authorizedDefinitions)
    : defaultSelectedIds(authorizedDefinitions);
  const selectedIdSet = new Set(selectedIds);
  const selectedDefinitions = selectedIds
    .map((id) => authorizedDefinitions.find((definition) => definition.id === id))
    .filter((definition): definition is TodayQuickAccessDefinition =>
      Boolean(definition),
    );
  const availableDefinitions = authorizedDefinitions.filter(
    (definition) => !selectedIdSet.has(definition.id),
  );

  return {
    available: availableDefinitions.map(asQuickAccess),
    canCustomize: authorizedDefinitions.length > 0,
    loadError: readResult.error,
    maxSelected: TODAY_QUICK_ACCESS_MAX_SELECTED,
    selected: selectedDefinitions.map(asQuickAccess),
  };
}

async function persistTodayQuickAccessIds(
  context: CurrentBusinessContext,
  ids: string[],
) {
  const identity = requireQuickAccessContext(context);
  const authorizedDefinitions = getAuthorizedDefinitions(context);
  const shortcutIds = validateAuthorizedIds(ids, authorizedDefinitions);
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { error } = await supabase.from("today_quick_access_preferences").upsert(
    {
      salon_id: identity.salonId,
      shortcut_ids: shortcutIds,
      user_id: identity.userId,
    },
    { onConflict: "user_id,salon_id" },
  );

  if (error) {
    console.error("Supabase save Today quick accesses failed", {
      code: error.code,
      details: error.details,
      hasAuthenticatedUserContext: Boolean(identity.userId),
      hasSalonContext: Boolean(identity.salonId),
      hint: error.hint,
      message: error.message,
      operation:
        "upsert today_quick_access_preferences shortcut_ids by user_id and salon_id",
    });
    throw new Error(error.message);
  }
}

export async function saveTodayQuickAccesses(
  context: CurrentBusinessContext,
  ids: string[],
) {
  await persistTodayQuickAccessIds(context, ids);
}

function getSelectedIds(configuration: TodayQuickAccessConfiguration) {
  return configuration.selected.map((shortcut) => shortcut.id);
}

export async function addTodayQuickAccess(
  context: CurrentBusinessContext,
  shortcutId: string,
) {
  const configuration = await getTodayQuickAccessConfiguration(context);
  const selectedIds = getSelectedIds(configuration);

  if (selectedIds.includes(shortcutId as TodayQuickAccessId)) {
    return;
  }

  if (selectedIds.length >= TODAY_QUICK_ACCESS_MAX_SELECTED) {
    throw new Error("Remove a shortcut before adding another one.");
  }

  if (!configuration.available.some((shortcut) => shortcut.id === shortcutId)) {
    throw new Error("That shortcut is not available.");
  }

  await persistTodayQuickAccessIds(context, [...selectedIds, shortcutId]);
}

export async function removeTodayQuickAccess(
  context: CurrentBusinessContext,
  shortcutId: string,
) {
  const configuration = await getTodayQuickAccessConfiguration(context);
  const selectedIds = getSelectedIds(configuration);

  if (!TODAY_QUICK_ACCESS_DEFINITIONS.some((item) => item.id === shortcutId)) {
    throw new Error("That shortcut is not recognized.");
  }

  if (!selectedIds.includes(shortcutId as TodayQuickAccessId)) {
    throw new Error("That shortcut is not selected.");
  }

  await persistTodayQuickAccessIds(
    context,
    selectedIds.filter((id) => id !== shortcutId),
  );
}

export async function moveTodayQuickAccess(
  context: CurrentBusinessContext,
  shortcutId: string,
  direction: "down" | "up",
) {
  const configuration = await getTodayQuickAccessConfiguration(context);
  const selectedIds = getSelectedIds(configuration);
  const fromIndex = selectedIds.indexOf(shortcutId as TodayQuickAccessId);

  if (fromIndex === -1) {
    throw new Error("That shortcut is not selected.");
  }

  const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;

  if (toIndex < 0 || toIndex >= selectedIds.length) {
    return;
  }

  const nextIds = [...selectedIds];
  const [shortcut] = nextIds.splice(fromIndex, 1);
  nextIds.splice(toIndex, 0, shortcut);

  await persistTodayQuickAccessIds(context, nextIds);
}

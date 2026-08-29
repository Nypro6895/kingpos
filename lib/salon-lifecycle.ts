import "server-only";

import {
  canPerformSalonOperation,
  getSalonLifecycleDenialMessage,
  normalizeSalonLifecycleStatus,
  type SalonLifecycleStatus,
  type SalonOperation,
} from "@/lib/salon-lifecycle-rules";
import {
  getCurrentBusinessContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import type { Location } from "@/types/location";
import type { KingUser } from "@/types/user";

const SALON_LIFECYCLE_SELECT =
  "id, account_id, name, status, disabled_at, disabled_by, disabled_reason, reactivated_at, reactivated_by, reactivation_reason, closed_at, closed_by, closure_reason, created_at, updated_at";

type SalonLifecycleRow = Pick<
  Location,
  "account_id" | "created_at" | "id" | "name" | "status" | "updated_at"
> & {
  closed_at: string | null;
  closed_by: string | null;
  closure_reason: string | null;
  disabled_at: string | null;
  disabled_by: string | null;
  disabled_reason: string | null;
  reactivated_at: string | null;
  reactivated_by: string | null;
  reactivation_reason: string | null;
};

export type SalonLifecycleState = SalonLifecycleRow & {
  lifecycleStatus: SalonLifecycleStatus;
};

export type AccountDeletionState = {
  deletedAt: string | null;
  deletionFinalizationError: string | null;
  deletionFinalizationFailedAt: string | null;
  deletionFinalizationStartedAt: string | null;
  deletionFinalizedAt: string | null;
  deletionFinalizationAttempts: number;
  deletionRequestedAt: string | null;
  deletionScheduledFor: string | null;
  isDeleted: boolean;
  isPendingDeletion: boolean;
  status: KingUser["status"] | "pending_deletion" | string;
  userId: string;
};

export type SalonClosureReview = {
  blockingRecords: Array<{
    count: number;
    description: string;
    id: "future_bookings" | "open_pos_tickets" | "pending_bookings";
    label: string;
  }>;
  canClose: boolean;
  checkedAt: string;
  counts: {
    futureBookings: number;
    openPosTickets: number;
    pendingBookings: number;
  };
  salonId: string;
};

export type SalonBackupSection = {
  count: number;
  id:
    | "bookings"
    | "customers"
    | "payroll"
    | "pos_tickets"
    | "services"
    | "staff";
  included: boolean;
  label: string;
  permissionCode: string;
};

export type SalonLifecycleBackup = {
  generatedAt: string;
  note: string;
  sections: SalonBackupSection[];
  salon: {
    accountId: string | null;
    closedAt: string | null;
    disabledAt: string | null;
    id: string;
    lifecycleStatus: SalonLifecycleStatus;
    name: string;
    status: string;
  };
  version: 1;
};

type CountQueryError = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message: string;
};

type CountQueryResult = {
  count: number | null;
  error: CountQueryError | null;
};

type CountQuery = PromiseLike<CountQueryResult> & {
  eq(column: string, value: unknown): CountQuery;
  gte(column: string, value: string): CountQuery;
  in(column: string, values: readonly unknown[]): CountQuery;
};

function lifecycleStateFromRow(row: SalonLifecycleRow): SalonLifecycleState {
  return {
    ...row,
    lifecycleStatus: normalizeSalonLifecycleStatus(row.status),
  };
}

function contextCanAccessSalon(
  context: CurrentBusinessContext,
  salonId: string,
) {
  return (
    context.availableManageSalons.some((salon) => salon.id === salonId) ||
    context.availableStaffSalons.some((salon) => salon.id === salonId)
  );
}

export function canPerformSalonOperationForSalon(input: {
  operation: SalonOperation;
  salon: Pick<Location, "status"> | null | undefined;
}) {
  return canPerformSalonOperation({
    operation: input.operation,
    status: input.salon?.status,
  });
}

export function assertCanPerformSalonOperationForSalon(input: {
  operation: SalonOperation;
  salon: Pick<Location, "name" | "status"> | null | undefined;
}) {
  if (
    canPerformSalonOperation({
      operation: input.operation,
      status: input.salon?.status,
    })
  ) {
    return;
  }

  throw new Error(
    getSalonLifecycleDenialMessage({
      operation: input.operation,
      salonName: input.salon?.name,
      status: input.salon?.status,
    }),
  );
}

export async function getSalonLifecycle(
  salonId: string,
): Promise<SalonLifecycleState | null> {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("locations")
    .select(SALON_LIFECYCLE_SELECT)
    .eq("id", salonId)
    .returns<SalonLifecycleRow[]>()
    .maybeSingle();

  if (error) {
    console.error("Supabase load salon lifecycle failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId,
    });
    throw new Error(error.message);
  }

  return data ? lifecycleStateFromRow(data) : null;
}

export async function assertSalonOperationAllowed(input: {
  context?: CurrentBusinessContext;
  operation: SalonOperation;
  salonId?: string | null;
}) {
  const context = input.context ?? (await getCurrentBusinessContext());
  const salonId = input.salonId ?? context.currentSalon?.id ?? null;

  if (!context.user) {
    throw new Error("Sign in before using this salon workspace.");
  }

  if (!salonId) {
    throw new Error("Choose a salon workspace first.");
  }

  if (!contextCanAccessSalon(context, salonId)) {
    throw new Error("You can only use a salon connected to your account.");
  }

  const salon =
    context.availableManageSalons.find((item) => item.id === salonId) ??
    context.availableStaffSalons.find((item) => item.id === salonId) ??
    null;

  assertCanPerformSalonOperationForSalon({
    operation: input.operation,
    salon,
  });

  return {
    context,
    salon,
  };
}

async function countTableRows(input: {
  apply: (query: CountQuery) => CountQuery;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  table: string;
}) {
  const query = input.supabase.from(input.table).select("id", {
    count: "exact",
    head: true,
  }) as unknown as CountQuery;
  const { count, error } = await input.apply(query);

  if (error) {
    console.error("Supabase lifecycle count failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      table: input.table,
    });
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function getSalonClosureReview(input: {
  context?: CurrentBusinessContext;
  salonId?: string | null;
} = {}): Promise<SalonClosureReview> {
  const { context, salon } = await assertSalonOperationAllowed({
    context: input.context,
    operation: "MANAGE_SALON",
    salonId: input.salonId,
  });
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const salonId = salon?.id ?? input.salonId ?? context.currentSalon?.id;

  if (!salonId) {
    throw new Error("Choose a salon workspace first.");
  }

  if (!(await hasPermission("salon_settings.manage", context))) {
    throw new Error("You do not have permission to review salon closure.");
  }

  const now = new Date().toISOString();
  const [futureBookings, pendingBookings, openPosTickets] = await Promise.all([
    countTableRows({
      apply: (query) =>
        query
          .eq("salon_id", salonId)
          .gte("start_at", now)
          .in("status", ["pending", "confirmed", "checked_in", "in_service", "scheduled"]),
      supabase,
      table: "bookings",
    }),
    countTableRows({
      apply: (query) =>
        query
          .eq("salon_id", salonId)
          .in("status", ["pending", "checked_in", "in_service"]),
      supabase,
      table: "bookings",
    }),
    countTableRows({
      apply: (query) => query.eq("salon_id", salonId).eq("status", "open"),
      supabase,
      table: "pos_tickets",
    }),
  ]);
  const blockingRecords: SalonClosureReview["blockingRecords"] = [];

  if (futureBookings > 0) {
    blockingRecords.push({
      count: futureBookings,
      description: "Upcoming bookings need to be completed, cancelled, or otherwise resolved first.",
      id: "future_bookings",
      label: "Future bookings",
    });
  }

  if (pendingBookings > 0) {
    blockingRecords.push({
      count: pendingBookings,
      description: "Pending or in-progress appointments need an existing booking outcome before closing.",
      id: "pending_bookings",
      label: "Pending appointments",
    });
  }

  if (openPosTickets > 0) {
    blockingRecords.push({
      count: openPosTickets,
      description: "Open POS tickets need to be closed, cancelled, or voided first.",
      id: "open_pos_tickets",
      label: "Open POS tickets",
    });
  }

  return {
    blockingRecords,
    canClose: blockingRecords.length === 0,
    checkedAt: now,
    counts: {
      futureBookings,
      openPosTickets,
      pendingBookings,
    },
    salonId,
  };
}

async function countPermittedSalonRows(input: {
  context: CurrentBusinessContext;
  permissionCode: string;
  salonColumn?: string;
  salonId: string;
  supabase: NonNullable<Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>>;
  table: string;
}) {
  const included = await hasPermission(input.permissionCode, input.context);

  if (!included) {
    return { count: 0, included: false };
  }

  const count = await countTableRows({
    apply: (query) => query.eq(input.salonColumn ?? "salon_id", input.salonId),
    supabase: input.supabase,
    table: input.table,
  });

  return { count, included: true };
}

export async function generateSalonLifecycleBackup(input: {
  context?: CurrentBusinessContext;
  salonId?: string | null;
} = {}): Promise<SalonLifecycleBackup> {
  const { context, salon } = await assertSalonOperationAllowed({
    context: input.context,
    operation: "EXPORT_DATA",
    salonId: input.salonId,
  });
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const salonId = salon?.id ?? input.salonId ?? context.currentSalon?.id;

  if (!salonId) {
    throw new Error("Choose a salon workspace first.");
  }

  const state = await getSalonLifecycle(salonId);

  if (!state) {
    throw new Error("Salon was not found.");
  }

  const sectionInputs = [
    {
      id: "bookings" as const,
      label: "Booking history",
      permissionCode: "booking.view",
      table: "bookings",
    },
    {
      id: "pos_tickets" as const,
      label: "POS ticket history",
      permissionCode: "tickets.view",
      table: "pos_tickets",
    },
    {
      id: "customers" as const,
      label: "Customer records",
      permissionCode: "customers.view",
      salonColumn: "location_id",
      table: "customers",
    },
    {
      id: "staff" as const,
      label: "Staff records",
      permissionCode: "staff.view",
      table: "staff",
    },
    {
      id: "services" as const,
      label: "Service catalog",
      permissionCode: "services.view",
      table: "services",
    },
    {
      id: "payroll" as const,
      label: "Payroll runs",
      permissionCode: "payroll.view",
      table: "payroll_runs",
    },
  ];
  const sections = await Promise.all(
    sectionInputs.map(async (section) => {
      const result = await countPermittedSalonRows({
        context,
        permissionCode: section.permissionCode,
        salonColumn: section.salonColumn,
        salonId,
        supabase,
        table: section.table,
      });

      return {
        count: result.count,
        id: section.id,
        included: result.included,
        label: section.label,
        permissionCode: section.permissionCode,
      };
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    note: "Lightweight lifecycle summary. Full private archives are generated through the lifecycle export service.",
    salon: {
      accountId: state.account_id ?? null,
      closedAt: state.closed_at,
      disabledAt: state.disabled_at,
      id: state.id,
      lifecycleStatus: state.lifecycleStatus,
      name: state.name,
      status: state.status,
    },
    sections,
    version: 1,
  };
}

async function callSalonLifecycleRpc(input: {
  reason?: string | null;
  rpcName:
    | "close_salon_permanently"
    | "disable_salon"
    | "reactivate_salon";
  salonId: string;
}) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase.rpc(input.rpcName, {
    p_reason: input.reason ?? null,
    p_salon_id: input.salonId,
  });

  if (error) {
    console.error("Supabase salon lifecycle transition failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      rpcName: input.rpcName,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  return data;
}

export async function disableSalon(input: {
  reason?: string | null;
  salonId: string;
}) {
  return callSalonLifecycleRpc({
    reason: input.reason,
    rpcName: "disable_salon",
    salonId: input.salonId,
  });
}

export async function closeSalonPermanently(input: {
  reason?: string | null;
  salonId: string;
}) {
  return callSalonLifecycleRpc({
    reason: input.reason,
    rpcName: "close_salon_permanently",
    salonId: input.salonId,
  });
}

export async function canReactivateSalon(input: {
  context?: CurrentBusinessContext;
  salonId: string;
}) {
  const state = await getSalonLifecycle(input.salonId);

  if (!state || state.lifecycleStatus === "permanently_closed") {
    return false;
  }

  const context = input.context ?? (await getCurrentBusinessContext());
  return contextCanAccessSalon(context, input.salonId);
}

export async function reactivateSalon(input: {
  reason?: string | null;
  salonId: string;
}) {
  return callSalonLifecycleRpc({
    reason: input.reason,
    rpcName: "reactivate_salon",
    salonId: input.salonId,
  });
}

export async function recoverPermanentlyClosedSalon(input: {
  claimantUserId: string;
  reason: string;
  salonId: string;
}) {
  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase.rpc(
    "recover_permanently_closed_salon",
    {
      p_claimant_user_id: input.claimantUserId,
      p_reason: input.reason,
      p_salon_id: input.salonId,
    },
  );

  if (error) {
    console.error("Supabase privileged salon recovery failed", {
      claimantUserId: input.claimantUserId,
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: input.salonId,
    });
    throw new Error(error.message);
  }

  return data;
}

export function getAccountDeletionState(
  user: Pick<
    KingUser,
    | "deleted_at"
    | "deletion_finalization_attempts"
    | "deletion_finalization_error"
    | "deletion_finalization_failed_at"
    | "deletion_finalization_started_at"
    | "deletion_finalized_at"
    | "deletion_requested_at"
    | "deletion_scheduled_for"
    | "id"
    | "status"
  >,
): AccountDeletionState {
  return {
    deletedAt: user.deleted_at ?? null,
    deletionFinalizationAttempts: user.deletion_finalization_attempts ?? 0,
    deletionFinalizationError: user.deletion_finalization_error ?? null,
    deletionFinalizationFailedAt: user.deletion_finalization_failed_at ?? null,
    deletionFinalizationStartedAt:
      user.deletion_finalization_started_at ?? null,
    deletionFinalizedAt: user.deletion_finalized_at ?? null,
    deletionRequestedAt: user.deletion_requested_at ?? null,
    deletionScheduledFor: user.deletion_scheduled_for ?? null,
    isDeleted: user.status === "deleted" || Boolean(user.deleted_at),
    isPendingDeletion: user.status === "pending_deletion",
    status: user.status,
    userId: user.id,
  };
}

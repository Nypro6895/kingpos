import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RpcRunner = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{
  data: unknown;
  error: {
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    message?: unknown;
  } | null;
}>;

type BeautyPostBookingCountRow = {
  post_id: string | null;
  verified_booking_count: number | string | null;
};

function cleanUuid(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  return UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function readCount(value: number | string | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }

  return 0;
}

function diagnosticString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function loadBeautyPostVerifiedBookingCounts(input: {
  postIds: string[];
  rpc?: RpcRunner;
}) {
  const postIds = Array.from(
    new Set(
      input.postIds
        .map((postId) => cleanUuid(postId))
        .filter((postId): postId is string => Boolean(postId)),
    ),
  );

  if (postIds.length === 0) {
    return new Map<string, number>();
  }

  const supabase = input.rpc ? null : createSupabaseServerClient();
  const rpc =
    input.rpc ??
    (supabase?.rpc.bind(supabase) as unknown as RpcRunner | undefined);

  if (!rpc) {
    return new Map<string, number>();
  }

  const { data, error } = await rpc(
    "get_public_beauty_post_booking_counts",
    {
      p_post_ids: postIds,
    },
  );

  if (error) {
    console.error("Beauty post booking counts failed", {
      code: diagnosticString(error.code),
      details: diagnosticString(error.details),
      hint: diagnosticString(error.hint),
      message: diagnosticString(error.message),
      postIds,
    });
    return new Map<string, number>();
  }

  const counts = new Map<string, number>();

  for (const row of Array.isArray(data)
    ? (data as BeautyPostBookingCountRow[])
    : []) {
    const postId = cleanUuid(row.post_id);

    if (postId) {
      counts.set(postId, readCount(row.verified_booking_count));
    }
  }

  return counts;
}

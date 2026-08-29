import "server-only";

import { getBeautyMediaPublicUrl } from "@/lib/beauty-media";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import {
  createAuthenticatedSupabaseServerClient,
  getSupabaseConfig,
} from "@/lib/supabase/server";
import type {
  BeautySalonPublicationStatus,
  BeautyVerificationState,
} from "@/types/beauty";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BEAUTY_SALON_PUBLICATION_PERMISSION = "salon_profile.content.manage";

type BeautyPublicationMediaRow = {
  displayOrder?: number | string | null;
  height?: number | string | null;
  id?: string | null;
  mimeType?: string | null;
  objectPath?: string | null;
  role?: string | null;
  width?: number | string | null;
};

type BeautySalonPublicationRequestRow = {
  author_avatar_url: string | null;
  author_display_name: string | null;
  caption: string | null;
  media: unknown;
  post_created_at: string;
  post_id: string;
  publication_id: string;
  requested_at: string;
  responded_at: string | null;
  salon_id: string;
  staff_id: string | null;
  staff_name: string | null;
  status: string;
  verification_state: string | null;
};

type BeautySalonPublicationResponse = {
  idempotent: boolean;
  postId: string;
  publicationId: string;
  salonId: string;
  status: BeautySalonPublicationStatus;
};

export type BeautySalonPublicationMedia = {
  displayOrder: number;
  height: number | null;
  id: string;
  mimeType: string | null;
  objectPath: string;
  role: "after" | "before" | "image";
  url: string | null;
  width: number | null;
};

export type BeautySalonPublicationRequest = {
  authorAvatarUrl: string | null;
  authorDisplayName: string;
  caption: string | null;
  media: BeautySalonPublicationMedia[];
  postCreatedAt: string;
  postId: string;
  publicationId: string;
  requestedAt: string;
  respondedAt: string | null;
  salonId: string;
  staffId: string | null;
  staffName: string | null;
  status: BeautySalonPublicationStatus;
  verificationState: BeautyVerificationState | null;
};

function cleanString(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function cleanUuid(value: string | null | undefined) {
  const trimmed = cleanString(value);

  return trimmed && UUID_PATTERN.test(trimmed) ? trimmed : null;
}

function readNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readInteger(value: number | string | null | undefined) {
  const parsed = readNumber(value);

  return parsed === null ? null : Math.max(0, Math.round(parsed));
}

function publicationStatus(value: string | null | undefined) {
  return value === "approved" || value === "declined" || value === "pending"
    ? value
    : null;
}

function verificationState(value: string | null | undefined) {
  if (
    value === "pending" ||
    value === "rejected" ||
    value === "unverified" ||
    value === "verified"
  ) {
    return value;
  }

  return null;
}

function mediaRole(value: string | null | undefined) {
  return value === "after" || value === "before" || value === "image"
    ? value
    : null;
}

function safeHttpUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function mapMedia(
  row: BeautyPublicationMediaRow,
  supabaseUrl: string,
): BeautySalonPublicationMedia | null {
  const id = cleanUuid(row.id);
  const objectPath = cleanString(row.objectPath);
  const role = mediaRole(row.role);

  if (!id || !objectPath || !role) {
    return null;
  }

  return {
    displayOrder: readInteger(row.displayOrder) ?? 0,
    height: readInteger(row.height),
    id,
    mimeType: cleanString(row.mimeType),
    objectPath,
    role,
    url: getBeautyMediaPublicUrl({ path: objectPath, supabaseUrl }),
    width: readInteger(row.width),
  };
}

function mapRequestRow(
  row: BeautySalonPublicationRequestRow,
  supabaseUrl: string,
): BeautySalonPublicationRequest | null {
  const publicationId = cleanUuid(row.publication_id);
  const postId = cleanUuid(row.post_id);
  const salonId = cleanUuid(row.salon_id);
  const status = publicationStatus(row.status);
  const authorDisplayName = cleanString(row.author_display_name);

  if (
    !publicationId ||
    !postId ||
    !salonId ||
    !status ||
    !authorDisplayName
  ) {
    return null;
  }

  const mediaRows = Array.isArray(row.media)
    ? (row.media as BeautyPublicationMediaRow[])
    : [];

  return {
    authorAvatarUrl: safeHttpUrl(row.author_avatar_url),
    authorDisplayName,
    caption: cleanString(row.caption),
    media: mediaRows
      .map((item) => mapMedia(item, supabaseUrl))
      .filter((item): item is BeautySalonPublicationMedia => Boolean(item)),
    postCreatedAt: row.post_created_at,
    postId,
    publicationId,
    requestedAt: row.requested_at,
    respondedAt: row.responded_at,
    salonId,
    staffId: cleanUuid(row.staff_id),
    staffName: cleanString(row.staff_name),
    status,
    verificationState: verificationState(row.verification_state),
  };
}

async function requireSalonPublicationReviewContext(
  context?: CurrentBusinessContext,
) {
  const resolvedContext = context ?? (await getCurrentBusinessContext());

  if (!resolvedContext.user) {
    throw new Error("Sign in before reviewing Beauty transformations.");
  }

  if (!isSalonManageContext(resolvedContext) || !resolvedContext.currentSalon) {
    throw new Error("Open a salon management workspace to review transformations.");
  }

  if (
    !(await hasPermission(BEAUTY_SALON_PUBLICATION_PERMISSION, resolvedContext))
  ) {
    throw new Error("Missing required permission: salon_profile.content.manage");
  }

  return resolvedContext;
}

export async function listBeautySalonPublicationRequests(
  context?: CurrentBusinessContext,
) {
  const resolvedContext = await requireSalonPublicationReviewContext(context);
  const salon = resolvedContext.currentSalon;
  const user = resolvedContext.user;
  const supabase = await createAuthenticatedSupabaseServerClient();
  const config = getSupabaseConfig();

  if (!supabase || !config || !salon || !user) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .rpc("list_my_beauty_salon_publication_requests", {
      p_limit: 24,
      target_salon_id: salon.id,
    })
    .returns<BeautySalonPublicationRequestRow[]>();

  if (error) {
    console.error("Supabase list Beauty salon publication requests failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: salon.id,
      userId: user.id,
    });
    throw new Error("Beauty transformation requests could not be loaded.");
  }

  const rows = Array.isArray(data)
    ? (data as BeautySalonPublicationRequestRow[])
    : [];

  return {
    requests: rows
      .map((row) => mapRequestRow(row, config.supabaseUrl))
      .filter((item): item is BeautySalonPublicationRequest => Boolean(item)),
    salonId: salon.id,
    salonName: salon.name,
  };
}

export async function countPendingBeautySalonPublicationRequests(
  context: CurrentBusinessContext,
) {
  if (!context.user || !isSalonManageContext(context) || !context.currentSalon) {
    return 0;
  }

  const allowed = await hasPermission(
    BEAUTY_SALON_PUBLICATION_PERMISSION,
    context,
  );

  if (!allowed) {
    return 0;
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    return 0;
  }

  const { data, error } = await supabase.rpc(
    "count_my_beauty_salon_publication_requests",
    {
      target_salon_id: context.currentSalon.id,
    },
  );

  if (error) {
    return 0;
  }

  const count = Number(data);

  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

export async function respondToBeautySalonPublicationRequest(input: {
  publicationId: string;
  response: Exclude<BeautySalonPublicationStatus, "pending">;
}): Promise<BeautySalonPublicationResponse> {
  const publicationId = cleanUuid(input.publicationId);

  if (!publicationId) {
    throw new Error("Choose a Beauty transformation request.");
  }

  await requireSalonPublicationReviewContext();

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase.rpc(
    "respond_to_beauty_salon_publication_request",
    {
      p_publication_id: publicationId,
      p_response: input.response,
    },
  );

  if (error) {
    console.error("Supabase respond Beauty salon publication request failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      publicationId,
    });
    throw new Error("Beauty transformation request could not be updated.");
  }

  const payload =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};

  if (payload.ok !== true) {
    const code = cleanString(
      typeof payload.code === "string" ? payload.code : null,
    );

    if (code === "forbidden") {
      throw new Error("You do not have permission to review this request.");
    }

    if (code === "not_found") {
      throw new Error("Beauty transformation request was not found.");
    }

    throw new Error("Beauty transformation request could not be updated.");
  }

  const status =
    typeof payload.status === "string" ? publicationStatus(payload.status) : null;
  const postId =
    typeof payload.postId === "string" ? cleanUuid(payload.postId) : null;
  const salonId =
    typeof payload.salonId === "string" ? cleanUuid(payload.salonId) : null;
  const responsePublicationId =
    typeof payload.publicationId === "string"
      ? cleanUuid(payload.publicationId)
      : null;

  if (!status || !postId || !salonId || !responsePublicationId) {
    throw new Error("Beauty transformation request returned an invalid response.");
  }

  return {
    idempotent: payload.idempotent === true,
    postId,
    publicationId: responsePublicationId,
    salonId,
    status,
  };
}

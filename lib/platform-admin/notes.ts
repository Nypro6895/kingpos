import "server-only";

import { callPlatformAdminRpc } from "@/lib/platform-admin/rpc";
import { assertUuid } from "@/lib/platform-admin/validation";
import type {
  PlatformAdminNoteItem,
  PlatformAdminPageResult,
} from "@/types/platform-admin";

export type PlatformAdminNoteTargetType =
  | "business"
  | "location"
  | "report"
  | "team_membership"
  | "user";

function assertNoteTargetType(value: string): PlatformAdminNoteTargetType {
  if (
    value !== "business" &&
    value !== "location" &&
    value !== "report" &&
    value !== "team_membership" &&
    value !== "user"
  ) {
    throw new Error("Invalid note target type.");
  }

  return value;
}

export async function listPlatformAdminNotes(input: {
  page?: number;
  pageSize?: number;
  targetId: string;
  targetType: PlatformAdminNoteTargetType;
}) {
  return callPlatformAdminRpc<PlatformAdminPageResult<PlatformAdminNoteItem>>(
    "list_platform_admin_notes",
    {
      p_page: input.page ?? 1,
      p_page_size: input.pageSize ?? 25,
      p_target_id: assertUuid(input.targetId, "Note target ID"),
      p_target_type: assertNoteTargetType(input.targetType),
    },
  );
}

export async function createPlatformAdminNote(input: {
  body: string;
  reason: string | null;
  targetId: string;
  targetType: PlatformAdminNoteTargetType;
}) {
  return callPlatformAdminRpc<{ created_at: string; note_id: string }>(
    "create_platform_admin_note",
    {
      p_body: input.body,
      p_reason: input.reason,
      p_target_id: assertUuid(input.targetId, "Note target ID"),
      p_target_type: assertNoteTargetType(input.targetType),
    },
  );
}

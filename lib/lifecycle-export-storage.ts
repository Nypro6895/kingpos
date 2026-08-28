import "server-only";

import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentKingUser } from "@/lib/users/current-user";
import { randomUUID } from "crypto";

export const LIFECYCLE_EXPORT_BUCKET = "lifecycle-exports";
export const LIFECYCLE_EXPORT_SIGNED_URL_SECONDS = 15 * 60;

export type LifecycleExportType =
  | "account_data"
  | "account_deletion"
  | "salon_lifecycle";

export type LifecycleExportRecord = {
  account_id: string | null;
  content_type: string;
  created_at: string;
  expires_at: string;
  export_type: LifecycleExportType;
  id: string;
  manifest: Record<string, unknown>;
  requested_by_user_id: string | null;
  salon_id: string | null;
  status: "created" | "expired" | "failed" | "stored";
  storage_bucket: string;
  storage_path: string;
  subject_user_id: string | null;
  updated_at: string;
};

export type StoredLifecycleExport = {
  contentType: string;
  expiresAt: string;
  filename: string;
  manifest: Record<string, unknown>;
  record: LifecycleExportRecord;
  signedUrl: string;
};

const LIFECYCLE_EXPORT_SELECT =
  "id, export_type, account_id, salon_id, subject_user_id, requested_by_user_id, status, storage_bucket, storage_path, content_type, manifest, expires_at, created_at, updated_at";

function safeExportFilename(value: string) {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || "lifecycle-export.json";
}

function signedUrlErrorMessage(error: { message?: string } | null) {
  return error?.message ?? "Export link could not be created.";
}

export async function createStoredLifecycleExport(input: {
  accountId?: string | null;
  exportType: LifecycleExportType;
  filename: string;
  manifest: Record<string, unknown>;
  payload: unknown;
  salonId?: string | null;
  subjectUserId?: string | null;
}): Promise<StoredLifecycleExport> {
  const [supabase, user] = await Promise.all([
    createAuthenticatedSupabaseServerClient(),
    getCurrentKingUser(),
  ]);

  if (!supabase || !user) {
    throw new Error("Sign in before creating an export.");
  }

  const exportId = randomUUID();
  const filename = safeExportFilename(input.filename);
  const storagePath = `${user.id}/${exportId}/${filename}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const content = JSON.stringify(input.payload, null, 2);

  const { data: record, error: insertError } = await supabase
    .from("lifecycle_exports")
    .insert({
      account_id: input.accountId ?? null,
      content_type: "application/json",
      expires_at: expiresAt,
      export_type: input.exportType,
      id: exportId,
      manifest: input.manifest,
      requested_by_user_id: user.id,
      salon_id: input.salonId ?? null,
      status: "created",
      storage_bucket: LIFECYCLE_EXPORT_BUCKET,
      storage_path: storagePath,
      subject_user_id: input.subjectUserId ?? null,
    })
    .select(LIFECYCLE_EXPORT_SELECT)
    .single<LifecycleExportRecord>();

  if (insertError) {
    console.error("Supabase lifecycle export record insert failed", {
      code: insertError.code,
      details: insertError.details,
      hint: insertError.hint,
      message: insertError.message,
    });
    throw new Error(insertError.message);
  }

  const uploadResult = await supabase.storage
    .from(LIFECYCLE_EXPORT_BUCKET)
    .upload(
      storagePath,
      new Blob([content], { type: "application/json" }),
      {
        contentType: "application/json",
        upsert: false,
      },
    );

  if (uploadResult.error) {
    await supabase
      .from("lifecycle_exports")
      .update({ status: "failed" })
      .eq("id", exportId);

    console.error("Supabase lifecycle export upload failed", {
      exportId,
      message: uploadResult.error.message,
      storagePath,
    });
    throw new Error(uploadResult.error.message);
  }

  const { data: storedRecord, error: updateError } = await supabase
    .from("lifecycle_exports")
    .update({ status: "stored" })
    .eq("id", exportId)
    .select(LIFECYCLE_EXPORT_SELECT)
    .single<LifecycleExportRecord>();

  if (updateError) {
    console.error("Supabase lifecycle export record update failed", {
      code: updateError.code,
      details: updateError.details,
      exportId,
      hint: updateError.hint,
      message: updateError.message,
    });
    throw new Error(updateError.message);
  }

  const signedUrlResult = await supabase.storage
    .from(LIFECYCLE_EXPORT_BUCKET)
    .createSignedUrl(storagePath, LIFECYCLE_EXPORT_SIGNED_URL_SECONDS);

  if (signedUrlResult.error || !signedUrlResult.data?.signedUrl) {
    throw new Error(signedUrlErrorMessage(signedUrlResult.error));
  }

  return {
    contentType: "application/json",
    expiresAt,
    filename,
    manifest: input.manifest,
    record: storedRecord ?? record,
    signedUrl: signedUrlResult.data.signedUrl,
  };
}

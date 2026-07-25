"use server";

import { createHash, randomBytes, randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCurrentBusinessContext,
  isSalonManageContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import {
  PORTABLE_POS_ACCESS_SETUP_MESSAGE,
} from "@/lib/pos-portable-access";
import {
  DEFAULT_PORTABLE_POS_CAPABILITIES,
  PORTABLE_POS_CAPABILITIES,
  type PortablePosCapability,
} from "@/lib/pos-portable-capabilities";
import { POS_DISPLAY_MEDIA_BUCKET, POS_SETTING_DEFAULTS } from "@/lib/pos-settings";
import { POS_TICKET_PERMISSIONS } from "@/lib/pos-tickets";
import { createAuthenticatedSupabaseServerClient } from "@/lib/supabase/server";

const POS_DISPLAY_IMAGE_LIMIT = 15 * 1024 * 1024;
const POS_DISPLAY_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function readRequiredString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readOptionalString(formData: FormData, key: string) {
  return readRequiredString(formData, key) || null;
}

function readBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function readNumber(formData: FormData, key: string, fallback: number) {
  const value = Number(readRequiredString(formData, key));
  return Number.isFinite(value) ? value : fallback;
}

function readPortableCapabilities(formData: FormData) {
  const allowed = new Set<string>(Object.values(PORTABLE_POS_CAPABILITIES));
  const selected = formData
    .getAll("capabilities")
    .filter(
      (value): value is PortablePosCapability =>
        typeof value === "string" && allowed.has(value),
    );

  if (selected.length === 0) {
    return [...DEFAULT_PORTABLE_POS_CAPABILITIES];
  }

  const capabilities = new Set<PortablePosCapability>([
    PORTABLE_POS_CAPABILITIES.posUse,
    ...selected,
  ]);

  if (
    capabilities.has(PORTABLE_POS_CAPABILITIES.bookCreate) ||
    capabilities.has(PORTABLE_POS_CAPABILITIES.bookCancel)
  ) {
    capabilities.add(PORTABLE_POS_CAPABILITIES.bookView);
  }

  return [...capabilities];
}

function redirectWithPosSettingsError(message: string): never {
  redirect(`/pos/settings?error=${encodeURIComponent(message)}`);
}

function redirectWithPortableAccessError(message: string): never {
  redirect(`/pos/settings?error=${encodeURIComponent(message)}#portable-access`);
}

function revalidatePortablePosSurfaces() {
  revalidatePath("/pos/portable");
  revalidatePath("/pos/portable/book");
  revalidatePath("/pos/portable/report");
  revalidatePath("/pos/portable/ticket");
}

function normalizePortableAccessId(value: string) {
  return value.replace(/\s+/g, "-").trim();
}

function digestPortablePasscode(input: {
  accessId: string;
  passcode: string;
  salt: string;
}) {
  return createHash("sha256")
    .update(`${input.accessId.toLowerCase()}:${input.passcode}:${input.salt}`)
    .digest("hex");
}

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

async function requirePosSettingsMutationContext(errorTarget: "access" | "settings") {
  const context = await getCurrentBusinessContext();
  const redirectWithError =
    errorTarget === "access"
      ? redirectWithPortableAccessError
      : redirectWithPosSettingsError;

  const user = context.user;
  const salon = context.currentSalon;

  if (!user || !isSalonManageContext(context) || !salon) {
    redirectWithError("Choose an owner salon workspace first.");
  }

  if (!(await hasPermission(POS_TICKET_PERMISSIONS.manage, context))) {
    redirectWithError("You do not have permission to manage POS settings.");
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    redirectWithError("Supabase environment variables are missing.");
  }

  return {
    context,
    salon: salon!,
    supabase: supabase!,
    user: user!,
  };
}

function readTipSuggestions(formData: FormData) {
  const values = [1, 2, 3, 4].map((index) =>
    readNumber(
      formData,
      `tip_suggestion_${index}`,
      POS_SETTING_DEFAULTS.tipSuggestions[index - 1] ?? 0,
    ),
  );

  return values.map((value) => Math.max(0, Math.round(value * 100) / 100));
}

function getUploadedFile(formData: FormData, key: string) {
  const value = formData.get(key);

  if (typeof File === "undefined" || !(value instanceof File) || value.size <= 0) {
    return null;
  }

  return value;
}

async function uploadPosDisplayImage(input: {
  file: File | null;
  kind: "background" | "left-ad" | "right-ad";
  salonId: string;
  supabase: NonNullable<
    Awaited<ReturnType<typeof createAuthenticatedSupabaseServerClient>>
  >;
}) {
  if (!input.file) {
    return null;
  }

  const extension = POS_DISPLAY_IMAGE_TYPES.get(input.file.type);

  if (!extension) {
    throw new Error("Use a JPEG, PNG, or WebP image.");
  }

  if (input.file.size > POS_DISPLAY_IMAGE_LIMIT) {
    throw new Error("POS display images must be 15 MB or smaller.");
  }

  const path = `${input.salonId}/${input.kind}/${randomUUID()}.${extension}`;
  const { error } = await input.supabase.storage
    .from(POS_DISPLAY_MEDIA_BUCKET)
    .upload(path, Buffer.from(await input.file.arrayBuffer()), {
      contentType: input.file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  return path;
}

function getNextImagePath(input: {
  currentPath: string | null;
  remove: boolean;
  uploadedPath: string | null;
}) {
  if (input.remove) {
    return null;
  }

  return input.uploadedPath ?? input.currentPath;
}

export async function createPortablePosAccessAction(formData: FormData) {
  const accessId = normalizePortableAccessId(
    readRequiredString(formData, "access_id"),
  );
  const label = readOptionalString(formData, "label");
  const passcode = readRequiredString(formData, "passcode");
  const capabilities = readPortableCapabilities(formData);

  if (!accessId) {
    redirectWithPortableAccessError("POS ID is required.");
  }

  if (!/^[a-zA-Z0-9._-]{3,48}$/.test(accessId)) {
    redirectWithPortableAccessError(
      "POS ID must be 3-48 characters and use letters, numbers, dots, dashes, or underscores.",
    );
  }

  if (passcode.length < 4 || passcode.length > 32) {
    redirectWithPortableAccessError("Passcode must be 4-32 characters.");
  }

  const { salon, supabase, user } =
    await requirePosSettingsMutationContext("access");
  const salt = randomBytes(16).toString("hex");
  const passcodeDigest = digestPortablePasscode({
    accessId,
    passcode,
    salt,
  });

  const { error } = await supabase.from("pos_portable_access_keys").insert({
    access_id: accessId,
    created_by: user.id,
    is_active: true,
    label,
    capabilities,
    passcode_digest: passcodeDigest,
    passcode_salt: salt,
    salon_id: salon.id,
  });

  if (error) {
    if (isMissingPortablePosAccessSchemaError(error)) {
      redirectWithPortableAccessError(PORTABLE_POS_ACCESS_SETUP_MESSAGE);
    }

    if (error.code === "23505") {
      redirectWithPortableAccessError("That POS ID is already in use.");
    }

    console.error("Supabase create Portable POS access failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: salon.id,
      userId: user.id,
    });
    redirectWithPortableAccessError(error.message);
  }

  revalidatePath("/pos/settings");
  revalidatePortablePosSurfaces();
  redirect("/pos/settings?saved=portable-create#portable-access");
}

export async function updatePortablePosAccessCapabilitiesAction(
  formData: FormData,
) {
  const keyId = readRequiredString(formData, "key_id");
  const capabilities = readPortableCapabilities(formData);

  if (!keyId) {
    redirectWithPortableAccessError("Portable POS access key is required.");
  }

  const { salon, supabase, user } =
    await requirePosSettingsMutationContext("access");
  const { error } = await supabase
    .from("pos_portable_access_keys")
    .update({ capabilities })
    .eq("id", keyId)
    .eq("salon_id", salon.id);

  if (error) {
    if (isMissingPortablePosAccessSchemaError(error)) {
      redirectWithPortableAccessError(PORTABLE_POS_ACCESS_SETUP_MESSAGE);
    }

    console.error("Supabase update Portable POS capabilities failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      keyId,
      message: error.message,
      salonId: salon.id,
      userId: user.id,
    });
    redirectWithPortableAccessError(error.message);
  }

  revalidatePath("/pos/settings");
  revalidatePortablePosSurfaces();
  redirect(
    `/pos/settings?saved=${encodeURIComponent(`portable-capabilities-${keyId}`)}#portable-access`,
  );
}

export async function updatePortablePosAccessStatusAction(formData: FormData) {
  const keyId = readRequiredString(formData, "key_id");
  const nextActive = readRequiredString(formData, "next_active") === "true";

  if (!keyId) {
    redirectWithPortableAccessError("Portable POS access key is required.");
  }

  const { salon, supabase, user } =
    await requirePosSettingsMutationContext("access");
  const { error } = await supabase
    .from("pos_portable_access_keys")
    .update({ is_active: nextActive })
    .eq("id", keyId)
    .eq("salon_id", salon.id);

  if (error) {
    if (isMissingPortablePosAccessSchemaError(error)) {
      redirectWithPortableAccessError(PORTABLE_POS_ACCESS_SETUP_MESSAGE);
    }

    console.error("Supabase update Portable POS access status failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: salon.id,
      keyId,
      userId: user.id,
    });
    redirectWithPortableAccessError(error.message);
  }

  revalidatePath("/pos/settings");
  revalidatePortablePosSurfaces();
  redirect(
    `/pos/settings?saved=${encodeURIComponent(`portable-status-${keyId}`)}#portable-access`,
  );
}

export async function updatePosSettingsAction(formData: FormData) {
  const { salon, supabase } = await requirePosSettingsMutationContext("settings");

  try {
    const [backgroundPath, leftAdPath, rightAdPath] = await Promise.all([
      uploadPosDisplayImage({
        file: getUploadedFile(formData, "customer_background_image_file"),
        kind: "background",
        salonId: salon.id,
        supabase,
      }),
      uploadPosDisplayImage({
        file: getUploadedFile(formData, "customer_left_ad_image_file"),
        kind: "left-ad",
        salonId: salon.id,
        supabase,
      }),
      uploadPosDisplayImage({
        file: getUploadedFile(formData, "customer_right_ad_image_file"),
        kind: "right-ad",
        salonId: salon.id,
        supabase,
      }),
    ]);
    const appDownloadUrl =
      readOptionalString(formData, "app_download_url") ??
      POS_SETTING_DEFAULTS.appDownloadUrl;

    const { error } = await supabase.from("pos_settings").upsert(
      {
        app_download_url: appDownloadUrl,
        customer_background_image_path: getNextImagePath({
          currentPath: readOptionalString(
            formData,
            "current_customer_background_image_path",
          ),
          remove: readBoolean(formData, "remove_customer_background_image"),
          uploadedPath: backgroundPath,
        }),
        customer_left_ad_image_path: getNextImagePath({
          currentPath: readOptionalString(
            formData,
            "current_customer_left_ad_image_path",
          ),
          remove: readBoolean(formData, "remove_customer_left_ad_image"),
          uploadedPath: leftAdPath,
        }),
        customer_left_ad_text:
          readOptionalString(formData, "customer_left_ad_text") ??
          POS_SETTING_DEFAULTS.customerLeftAdText,
        customer_promo_body:
          readOptionalString(formData, "customer_promo_body") ??
          POS_SETTING_DEFAULTS.customerPromoBody,
        customer_promo_title:
          readOptionalString(formData, "customer_promo_title") ??
          POS_SETTING_DEFAULTS.customerPromoTitle,
        customer_right_ad_image_path: getNextImagePath({
          currentPath: readOptionalString(
            formData,
            "current_customer_right_ad_image_path",
          ),
          remove: readBoolean(formData, "remove_customer_right_ad_image"),
          uploadedPath: rightAdPath,
        }),
        customer_right_ad_text:
          readOptionalString(formData, "customer_right_ad_text") ??
          POS_SETTING_DEFAULTS.customerRightAdText,
        customer_show_barcode: readBoolean(formData, "customer_show_barcode"),
        customer_show_customer_name: readBoolean(
          formData,
          "customer_show_customer_name",
        ),
        customer_show_receipt_status: readBoolean(
          formData,
          "customer_show_receipt_status",
        ),
        customer_show_salon_name: readBoolean(
          formData,
          "customer_show_salon_name",
        ),
        customer_show_service_name: readBoolean(
          formData,
          "customer_show_service_name",
        ),
        customer_show_staff_name: readBoolean(
          formData,
          "customer_show_staff_name",
        ),
        large_turn_threshold: Math.max(
          1,
          readNumber(
            formData,
            "large_turn_threshold",
            POS_SETTING_DEFAULTS.largeTurnThreshold,
          ),
        ),
        salon_id: salon.id,
        tip_suggestions: readTipSuggestions(formData),
      },
      { onConflict: "salon_id" },
    );

    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    redirectWithPosSettingsError(
      error instanceof Error ? error.message : "POS settings could not be saved.",
    );
  }

  revalidatePath("/pos/settings");
  revalidatePath("/pos");
  revalidatePortablePosSurfaces();
  revalidatePath("/pos/customer-display");
  redirect("/pos/settings?saved=pos-settings");
}

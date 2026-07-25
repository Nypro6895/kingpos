import "server-only";

import {
  getCurrentBusinessContext,
  isSalonManageContext,
  type CurrentBusinessContext,
} from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { POS_TICKET_PERMISSIONS } from "@/lib/pos-tickets";
import {
  SALON_PROFILE_MEDIA_BUCKET,
  normalizeSalonProfileMediaPath,
} from "@/lib/salon-profile-media";
import {
  createAuthenticatedSupabaseServerClient,
  createSupabaseServerClient,
  getSupabaseConfig,
} from "@/lib/supabase/server";

export const POS_DISPLAY_MEDIA_BUCKET = "pos-display-media";

export const POS_TIP_SUGGESTION_DEFAULTS = [5, 10, 15, 20] as const;

export const POS_SETTING_DEFAULTS = {
  adsFooter: "",
  appDownloadUrl: "https://reylumi.com",
  customerBackgroundImagePath: null,
  customerBackgroundImageUrl: null,
  customerLeftAdImagePath: null,
  customerLeftAdImageUrl: null,
  customerLeftAdText: "Stay connected with our beauty community",
  customerPromoBody: "Thank you for choosing us today!",
  customerPromoTitle: "Welcome back,",
  customerRightAdImagePath: null,
  customerRightAdImageUrl: null,
  customerRightAdText:
    "Earn points & rewards. Exclusive member offers. Easy booking & reminders. Track your favorite services.",
  customerShowBarcode: true,
  customerShowCustomerName: true,
  customerShowReceiptStatus: true,
  customerShowSalonName: true,
  customerShowServiceName: true,
  customerShowStaffName: true,
  largeTurnThreshold: 25,
  salonLogoPath: null,
  salonLogoUrl: null,
  salonName: null,
  showServiceName: true,
  showStaffName: true,
  taxEnabled: false,
  tipSuggestions: [...POS_TIP_SUGGESTION_DEFAULTS],
} as const;

export type PosCustomerDisplaySettings = {
  appDownloadUrl: string;
  customerBackgroundImagePath: string | null;
  customerBackgroundImageUrl: string | null;
  customerLeftAdImagePath: string | null;
  customerLeftAdImageUrl: string | null;
  customerLeftAdText: string;
  customerPromoBody: string;
  customerPromoTitle: string;
  customerRightAdImagePath: string | null;
  customerRightAdImageUrl: string | null;
  customerRightAdText: string;
  customerShowBarcode: boolean;
  customerShowCustomerName: boolean;
  customerShowReceiptStatus: boolean;
  customerShowSalonName: boolean;
  customerShowServiceName: boolean;
  customerShowStaffName: boolean;
  salonLogoPath: string | null;
  salonLogoUrl: string | null;
  salonName: string | null;
};

export type PosDeskDefaults = {
  adsFooter: string;
  largeTurnThreshold: number;
  showServiceName: boolean;
  showStaffName: boolean;
  taxEnabled: boolean;
  tipSuggestions: number[];
};

export type PosSettingsView = PosDeskDefaults & PosCustomerDisplaySettings;

type PosSettingsRow = {
  app_download_url: string | null;
  customer_background_image_path: string | null;
  customer_left_ad_image_path: string | null;
  customer_left_ad_text: string | null;
  customer_promo_body: string | null;
  customer_promo_title: string | null;
  customer_right_ad_image_path: string | null;
  customer_right_ad_text: string | null;
  customer_show_barcode: boolean | null;
  customer_show_customer_name: boolean | null;
  customer_show_receipt_status: boolean | null;
  customer_show_salon_name: boolean | null;
  customer_show_service_name: boolean | null;
  customer_show_staff_name: boolean | null;
  large_turn_threshold: number | null;
  salon_id: string;
  tip_suggestions: number[] | null;
};

const POS_SETTINGS_SELECT =
  "salon_id, large_turn_threshold, tip_suggestions, customer_background_image_path, customer_left_ad_image_path, customer_right_ad_image_path, customer_left_ad_text, customer_right_ad_text, customer_promo_title, customer_promo_body, customer_show_customer_name, customer_show_receipt_status, customer_show_salon_name, customer_show_service_name, customer_show_staff_name, customer_show_barcode, app_download_url";

function cleanText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cleanOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTipSuggestions(value: unknown) {
  const source = Array.isArray(value) ? value : POS_TIP_SUGGESTION_DEFAULTS;
  const suggestions = source
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item >= 0)
    .slice(0, 4);

  while (suggestions.length < 4) {
    suggestions.push(POS_TIP_SUGGESTION_DEFAULTS[suggestions.length] ?? 0);
  }

  return suggestions.map((item) => Math.round(item * 100) / 100);
}

function encodeStoragePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function getPosDisplayMediaUrl(path: string | null | undefined) {
  const normalizedPath = cleanOptionalText(path);

  if (!normalizedPath) {
    return null;
  }

  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  return `${config.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(
    POS_DISPLAY_MEDIA_BUCKET,
  )}/${encodeStoragePath(normalizedPath)}`;
}

export function getPosDisplaySalonLogoUrl(path: string | null | undefined) {
  const normalizedPath = normalizeSalonProfileMediaPath(path);

  if (!normalizedPath) {
    return null;
  }

  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  return `${config.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${encodeURIComponent(
    SALON_PROFILE_MEDIA_BUCKET,
  )}/${encodeStoragePath(normalizedPath)}`;
}

export function normalizePosSettingsPayload(value: unknown): PosSettingsView {
  const payload = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const backgroundPath = cleanOptionalText(payload.customerBackgroundImagePath);
  const leftAdPath = cleanOptionalText(payload.customerLeftAdImagePath);
  const rightAdPath = cleanOptionalText(payload.customerRightAdImagePath);
  const salonLogoPath = normalizeSalonProfileMediaPath(
    cleanOptionalText(payload.salonLogoPath),
  );

  return {
    ...POS_SETTING_DEFAULTS,
    appDownloadUrl: cleanText(payload.appDownloadUrl, POS_SETTING_DEFAULTS.appDownloadUrl),
    customerBackgroundImagePath: backgroundPath,
    customerBackgroundImageUrl: getPosDisplayMediaUrl(backgroundPath),
    customerLeftAdImagePath: leftAdPath,
    customerLeftAdImageUrl: getPosDisplayMediaUrl(leftAdPath),
    customerLeftAdText: cleanText(
      payload.customerLeftAdText,
      POS_SETTING_DEFAULTS.customerLeftAdText,
    ),
    customerPromoBody: cleanText(
      payload.customerPromoBody,
      POS_SETTING_DEFAULTS.customerPromoBody,
    ),
    customerPromoTitle: cleanText(
      payload.customerPromoTitle,
      POS_SETTING_DEFAULTS.customerPromoTitle,
    ),
    customerRightAdImagePath: rightAdPath,
    customerRightAdImageUrl: getPosDisplayMediaUrl(rightAdPath),
    customerRightAdText: cleanText(
      payload.customerRightAdText,
      POS_SETTING_DEFAULTS.customerRightAdText,
    ),
    customerShowBarcode:
      typeof payload.customerShowBarcode === "boolean"
        ? payload.customerShowBarcode
        : POS_SETTING_DEFAULTS.customerShowBarcode,
    customerShowCustomerName:
      typeof payload.customerShowCustomerName === "boolean"
        ? payload.customerShowCustomerName
        : POS_SETTING_DEFAULTS.customerShowCustomerName,
    customerShowReceiptStatus:
      typeof payload.customerShowReceiptStatus === "boolean"
        ? payload.customerShowReceiptStatus
        : POS_SETTING_DEFAULTS.customerShowReceiptStatus,
    customerShowSalonName:
      typeof payload.customerShowSalonName === "boolean"
        ? payload.customerShowSalonName
        : POS_SETTING_DEFAULTS.customerShowSalonName,
    customerShowServiceName:
      typeof payload.customerShowServiceName === "boolean"
        ? payload.customerShowServiceName
        : POS_SETTING_DEFAULTS.customerShowServiceName,
    customerShowStaffName:
      typeof payload.customerShowStaffName === "boolean"
        ? payload.customerShowStaffName
        : POS_SETTING_DEFAULTS.customerShowStaffName,
    largeTurnThreshold:
      Number.isFinite(Number(payload.largeTurnThreshold)) &&
      Number(payload.largeTurnThreshold) > 0
        ? Number(payload.largeTurnThreshold)
        : POS_SETTING_DEFAULTS.largeTurnThreshold,
    salonLogoPath,
    salonLogoUrl: getPosDisplaySalonLogoUrl(salonLogoPath),
    salonName: cleanOptionalText(payload.salonName),
    tipSuggestions: normalizeTipSuggestions(payload.tipSuggestions),
  };
}

function rowToPosSettings(row: PosSettingsRow | null): PosSettingsView {
  if (!row) {
    return normalizePosSettingsPayload(null);
  }

  return normalizePosSettingsPayload({
    appDownloadUrl: row.app_download_url,
    customerBackgroundImagePath: row.customer_background_image_path,
    customerLeftAdImagePath: row.customer_left_ad_image_path,
    customerLeftAdText: row.customer_left_ad_text,
    customerPromoBody: row.customer_promo_body,
    customerPromoTitle: row.customer_promo_title,
    customerRightAdImagePath: row.customer_right_ad_image_path,
    customerRightAdText: row.customer_right_ad_text,
    customerShowBarcode: row.customer_show_barcode,
    customerShowCustomerName: row.customer_show_customer_name,
    customerShowReceiptStatus: row.customer_show_receipt_status,
    customerShowSalonName: row.customer_show_salon_name,
    customerShowServiceName: row.customer_show_service_name,
    customerShowStaffName: row.customer_show_staff_name,
    largeTurnThreshold: row.large_turn_threshold,
    tipSuggestions: row.tip_suggestions,
  });
}

function requirePosSettingsContext(context: CurrentBusinessContext) {
  if (!context.user || !isSalonManageContext(context) || !context.currentSalon) {
    throw new Error("Choose an owner salon workspace first.");
  }

  return {
    salon: context.currentSalon,
  };
}

export function getPosDeskDefaults(settings: PosSettingsView): PosDeskDefaults {
  return {
    adsFooter: settings.adsFooter,
    largeTurnThreshold: settings.largeTurnThreshold,
    showServiceName: settings.showServiceName,
    showStaffName: settings.showStaffName,
    taxEnabled: settings.taxEnabled,
    tipSuggestions: settings.tipSuggestions,
  };
}

export async function getCurrentSalonPosSettings(
  context?: CurrentBusinessContext,
): Promise<PosSettingsView> {
  const resolvedContext = context ?? (await getCurrentBusinessContext());
  const { salon } = requirePosSettingsContext(resolvedContext);
  const canView =
    (await hasPermission(POS_TICKET_PERMISSIONS.view, resolvedContext)) ||
    (await hasPermission(POS_TICKET_PERMISSIONS.manage, resolvedContext));

  if (!canView) {
    return normalizePosSettingsPayload(null);
  }

  const supabase = await createAuthenticatedSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase environment variables are missing.");
  }

  const { data, error } = await supabase
    .from("pos_settings")
    .select(POS_SETTINGS_SELECT)
    .eq("salon_id", salon.id)
    .maybeSingle<PosSettingsRow>();

  if (error) {
    if (error.code === "PGRST205" || error.code === "42P01") {
      return normalizePosSettingsPayload(null);
    }

    console.error("Supabase load POS settings failed", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
      salonId: salon.id,
    });
    throw new Error(error.message);
  }

  return rowToPosSettings(data);
}

export async function getPublicPosDisplaySettingsByToken(token: string) {
  const supabase = createSupabaseServerClient();

  if (!supabase || !token.trim()) {
    return normalizePosSettingsPayload(null);
  }

  const { data, error } = await supabase.rpc(
    "get_pos_customer_display_settings_by_token",
    {
      p_token: token,
    },
  );

  if (error) {
    console.warn("Supabase load customer POS settings failed", {
      code: error.code,
      message: error.message,
    });
    return normalizePosSettingsPayload(null);
  }

  return normalizePosSettingsPayload(data);
}

import type { ComponentProps } from "react";
import type { SalonProfileView } from "@/app/salon-profile/salon-profile-view";
import type { Location } from "@/types/location";
import type { getCurrentSalonSetting, getCurrentSalonDiscoveryReadiness } from "./salon-settings";
import type { getSalonLifecycle, getSalonClosureReview } from "./salon-lifecycle";
import type { getCurrentSalonOperatingHoursSettings } from "./salon-operating-status";
import type { getCurrentSalonMapLocationState } from "./location/salon-map-location";
import type { getCurrentSalonStaffDirectory } from "./staff";
import type { getSalonOwnerRoster } from "./owner-transfer";
import type { getCurrentSalonPosSettings } from "./pos-settings";
import type { getCurrentSalonPortablePosAccessState } from "./pos-portable-access";
import type { getWindowsPosRelease } from "./windows-pos-release";

export const APP_LOCAL_BUSINESS_READS = {
  "owner.salon-profile": { argumentKeys: [], access: "scoped", retention: "scoped" },
  "owner.salon-settings": { argumentKeys: [], access: "scoped", retention: "scoped" },
  "owner.pos-settings": { argumentKeys: [], access: "scoped", retention: "scoped" },
  "customer.salons": { argumentKeys: [], access: "scoped", retention: "scoped" },
} as const;
export const APP_LOCAL_BUSINESS_ROUTES = ["/salon-profile", "/salon-settings", "/pos/settings", "/salons", "/businesses", "/salons/new", "/businesses/new"] as const;

export type AppLocalSalonProfileData = Omit<ComponentProps<typeof SalonProfileView>, "error" | "notice">;
export type AppLocalSalonSettingsData = {
  setting: NonNullable<Awaited<ReturnType<typeof getCurrentSalonSetting>>["setting"]>;
  lifecycle: NonNullable<Awaited<ReturnType<typeof getSalonLifecycle>>>;
  operatingSettings: Awaited<ReturnType<typeof getCurrentSalonOperatingHoursSettings>>;
  discoveryReadiness: Awaited<ReturnType<typeof getCurrentSalonDiscoveryReadiness>>;
  mapLocation: Awaited<ReturnType<typeof getCurrentSalonMapLocationState>>;
  staffDirectory: Pick<Awaited<ReturnType<typeof getCurrentSalonStaffDirectory>>, "staff">;
  ownerRoster: Awaited<ReturnType<typeof getSalonOwnerRoster>> | null;
  closureReview: Awaited<ReturnType<typeof getSalonClosureReview>> | null;
  isOwner: boolean; canManageSettings: boolean; canViewStaff: boolean; canManageLifecycle: boolean; canManageOwnership: boolean;
  salonId: string; workspaceLabel: string;
};
export type AppLocalPosSettingsData = {
  canManageSettings: boolean;
  portableAccessState: Awaited<ReturnType<typeof getCurrentSalonPortablePosAccessState>>;
  settings: Awaited<ReturnType<typeof getCurrentSalonPosSettings>>;
  snapshot: Record<string, unknown>;
  desktopRelease: Awaited<ReturnType<typeof getWindowsPosRelease>>;
};
export type AppLocalSalonsData = {
  salons: Location[]; currentSalonId: string | null; hasCreatePermission: boolean;
  createRequestKey: string; workspaceId: string | null;
};
/** Exact optimistic-concurrency fields accepted by save_pos_workspace_settings; no future secret column can enter a retained DTO. */
export const APP_LOCAL_POS_SETTINGS_SNAPSHOT_KEYS = [
  "large_turn_threshold", "staff_check_in_enabled", "tip_suggestions", "touch_keyboard_enabled", "workspace_preferences", "app_download_url",
  "customer_background_image_path", "customer_left_ad_image_path", "customer_right_ad_image_path", "customer_left_ad_text", "customer_right_ad_text",
  "customer_promo_title", "customer_promo_body", "customer_show_salon_name", "customer_show_customer_name", "customer_show_receipt_status", "customer_show_service_name", "customer_show_staff_name", "customer_show_barcode",
] as const;

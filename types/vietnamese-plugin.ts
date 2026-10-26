export const VIETNAMESE_PLUGIN_ID = "vietnamese-language";
export const VIETNAMESE_MONTHLY_CENTS = 399;
export const VIETNAMESE_TRIAL_DAYS = 5;
export type VietnamesePluginState = {
  installed: boolean;
  active: boolean;
  staff_enabled: boolean;
  portable_enabled: boolean;
  trial_ends_at: string | null;
  paid_until: string | null;
  has_subscription: boolean;
};
export const EMPTY_VIETNAMESE_PLUGIN: VietnamesePluginState = {
  installed: false, active: false, staff_enabled: false, portable_enabled: false,
  trial_ends_at: null, paid_until: null, has_subscription: false,
};

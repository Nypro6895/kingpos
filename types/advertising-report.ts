export type AdvertisingLimits = {
  maxTotal: number;
  maxPopups: number;
  minPopupGapSeconds: number;
  sessionMinutes: number;
};
export const DEFAULT_ADVERTISING_LIMITS: AdvertisingLimits = {
  maxTotal: 6,
  maxPopups: 1,
  minPopupGapSeconds: 60,
  sessionMinutes: 30,
};
export type AdvertisingReportRow = {
  campaign_id: string;
  campaign_name?: string;
  day: string;
  device: string;
  audience: string;
  views: number;
  clicks: number;
  signups: number;
};

export type OwnerAttentionItem = {
  item_key: string;
  kind: "closing" | "ticket_change" | "discount" | "checkin";
  business_date: string;
  occurred_at: string;
  label: string;
  detail: string;
  target_href: string;
  ignored: boolean;
  facts?: Record<string, unknown>;
};
export type OwnerAttentionData = {
  salonId: string;
  viewerId: string;
  today: string;
  timezone: string;
  total: number;
  items: OwnerAttentionItem[];
};

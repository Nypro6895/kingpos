export const CHECKIN_RECEIPT_PLUGIN = "checkin-receipt";
export const CHECKIN_RECEIPT_MONTHLY_CENTS = 470;
export type CheckinReceipt = { visitId: string; queueNumber: number; businessDate: string; salonName: string; customerName: string };
export type CheckinReceiptSubscription = { active: boolean; subscribed: boolean };

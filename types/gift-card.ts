export type CardElement = { id: string; kind: "logo" | "name" | "text"; text: string; x: number; y: number; size: number };
export type GiftDesign = { background: string; color: string; image: string; logo: string; elements: CardElement[] };
export const defaultGiftDesign = (name = "Your salon", logo = ""): GiftDesign => ({ background: "#fff0e8", color: "#262626", image: "", logo,
  elements: [{ id: "logo", kind: "logo", text: "", x: 50, y: 30, size: 48 }, { id: "name", kind: "name", text: name, x: 50, y: 65, size: 24 }] });
export type GiftCardView = { id: string; salonId: string; salonName: string; balance: number; last4: string; status: string; design: GiftDesign; generation: number; pendingTransfer?: boolean };
export type GiftSession = { id: string; revision: number; prompt?: number; mode: "use" | "buy"; entry: "code" | "scan" | "wallet"; status: string; amount: number; total: number; purchase: number; card: GiftCardView | null; approved: boolean; qrVisible: boolean; mobile: string; delivery?: string; deliveryCode?: string; deliveryPin?: string; collected?: boolean; expires: string };
export type GiftReply = { counterSales?: Array<{id:string;amountCents:number;status:string;ticketId?:string;at:string}>; session?: GiftSession; cards?: GiftCardView[]; card?: GiftCardView; token?: string; code?: string; pin?: string; installed?: boolean; design?: GiftDesign; salonName?: string; stripeConnected?: boolean; url?: string; order?: string; ticketId?: string; giftSaleId?: string; ticketNumber?: string; message?: string; ledger?: Array<{ id: string; kind: string; delta: number; at: string; ticketId?: string }>; stats?: { issued: number; redeemed: number; outstanding: number; soldCount?: number; usedCount?: number } };
export type GiftTransport = (op: string, args?: Record<string, unknown>) => Promise<GiftReply>;
export const giftMoney = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export function giftCents(input: string) { if (!/^\d{1,5}(\.\d{1,2})?$/.test(input.trim())) throw new Error("Enter a valid amount."); const cents = Math.round(Number(input) * 100); if (!Number.isSafeInteger(cents) || cents < 100 || cents > 100000) throw new Error("Choose $1–$1,000."); return cents; }
export function normalizeGiftDesign(value: unknown): GiftDesign {
  const v = value as GiftDesign; const base = defaultGiftDesign();
  const image = (s: unknown) => typeof s === "string" && s.length <= 2000000 && (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s) || /^https:\/\//.test(s)) ? s : "";
  return { background: /^#[0-9a-f]{6}$/i.test(v?.background) ? v.background : base.background, color: /^#[0-9a-f]{6}$/i.test(v?.color) ? v.color : base.color,
    image: image(v?.image), logo: image(v?.logo), elements: Array.isArray(v?.elements) ? v.elements.slice(0, 12).map((e, i) => ({ id: String(i), kind: ["logo", "name"].includes(e.kind) ? e.kind : "text", text: String(e.text ?? "").slice(0, 120), x: Math.max(8, Math.min(92, Number(e.x) || 50)), y: Math.max(10, Math.min(90, Number(e.y) || 50)), size: Math.max(12, Math.min(72, Number(e.size) || 24)) })) : base.elements };
}

import type { GiftDesign } from "@/types/gift-card";

export const giftPresets = [
  { name: "Emerald Signature", image: "/gift-cards/presets/emerald-v2.jpg", background: "#063c2b", color: "#f4dfaf", center: 48 },
  { name: "Ivory Peony", image: "/gift-cards/presets/ivory-v2.jpg", background: "#f7f1e8", color: "#604829", center: 50 },
  { name: "Noir Couture", image: "/gift-cards/presets/noir-v2.jpg", background: "#111111", color: "#f1d8a6", center: 44 },
] as const;

export function createGiftPreset(index: number, image: string, salonName: string, salonLogo = ""): GiftDesign {
  const preset = giftPresets[index] ?? giftPresets[0];
  return {
    background: preset.background, color: preset.color, image, logo: salonLogo,
    elements: [
      { id: "salon", kind: "name", text: salonName, x: preset.center, y: 25, size: 21, font: "sans" },
      { id: "title", kind: "text", text: "Gift Card", x: preset.center, y: 48, size: 62, font: "serif" },
      { id: "message", kind: "text", text: "A moment of beauty, just for you", x: preset.center, y: 66, size: 19, font: "serif" },
      ...(salonLogo ? [{ id: "logo", kind: "logo" as const, text: "", x: preset.center, y: 83, size: 35, font: "sans" as const }] : []),
    ],
  };
}

const images = new Map<number, Promise<string>>();
/** Embed selected art in the saved design so issued cards never depend on an asset URL. */
export function loadGiftPreset(index: number): Promise<string> {
  const preset = giftPresets[index];
  if (!preset) return Promise.reject(new Error("Choose a gift card design."));
  const cached = images.get(index);
  if (cached) return cached;
  const request = (async () => {
    const response = await fetch(preset.image, { cache: "force-cache" });
    if (!response.ok) throw new Error("This design could not load. Please try again.");
    const blob = await response.blob();
    if (blob.type !== "image/jpeg" || blob.size > 350000) throw new Error("This design could not load. Please try again.");
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("This design could not open. Please try again."));
      reader.readAsDataURL(blob);
    });
  })().catch(error => { images.delete(index); throw error; });
  images.set(index, request);
  return request;
}

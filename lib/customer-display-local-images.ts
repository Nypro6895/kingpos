"use client";
import { useMemo, useSyncExternalStore } from "react";

export const LOCAL_PROMOTION_IMAGES_KEY = "kingpos:device:promotion-images:v1";
const changed = "kingpos:device:promotion-images-changed";
const maxImages = 4;
function read() { try { return localStorage.getItem(LOCAL_PROMOTION_IMAGES_KEY) ?? ""; } catch { return ""; } }
function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === LOCAL_PROMOTION_IMAGES_KEY || event.key === null) listener(); };
  window.addEventListener(changed, listener); window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(changed, listener); window.removeEventListener("storage", onStorage); };
}
export function normalizeLocalPromotionImages(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((image): image is string => typeof image === "string" && image.length <= 650_000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image)).slice(0, maxImages) : [];
}
export function useLocalPromotionImages() {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => { try { return normalizeLocalPromotionImages(JSON.parse(raw)); } catch { return []; } }, [raw]);
}
export function saveLocalPromotionImages(images: string[]) {
  const safe = normalizeLocalPromotionImages(images);
  if (safe.length !== images.length || images.length > maxImages) throw Error("Choose up to four images.");
  localStorage.setItem(LOCAL_PROMOTION_IMAGES_KEY, JSON.stringify(safe));
  window.dispatchEvent(new Event(changed));
}
export async function prepareLocalPromotionImages(files: File[]): Promise<string[]> {
  if (!files.length || files.length > maxImages) throw Error("Choose up to four images.");
  return Promise.all(files.map(async file => {
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type) || file.size > 10 * 1024 * 1024) throw Error("Choose JPG, PNG, WebP, GIF or AVIF images under 10 MB.");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url;
      try { await image.decode(); } catch { throw new Error("This image could not be opened. Please choose another image."); }
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d"); if (!context) throw Error("Unable to prepare this image.");
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL("image/jpeg", 0.8);
      if (data.length > 650_000) data = canvas.toDataURL("image/jpeg", 0.55);
      if (data.length > 650_000) throw Error("This image is too large. Please choose a smaller image.");
      return data;
    } finally { URL.revokeObjectURL(url); }
  }));
}

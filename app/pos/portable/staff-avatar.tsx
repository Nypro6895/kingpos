"use client";
import { useEffect, useState } from "react";

// Keep successfully fetched photos locally, revalidate on reconnect and while
// the app stays open. A missing photo never renders a broken-image icon.
export function StaffAvatar({ src, className }: { src: string | null; className?: string }) {
  const [image, setImage] = useState<{ source: string; url: string } | null>(null);
  useEffect(() => {
    if (!src) return;
    let active = true, busy = false;
    let objectUrl: string | undefined;
    const show = async (response: Response) => {
      const blob = await response.blob();
      if (!active || !blob.size || !blob.type.startsWith("image/")) return;
      const next = URL.createObjectURL(blob);
      setImage({ source: src, url: next });
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = next;
    };
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const cache = await caches.open("kingpos-staff-photos-v1");
        if (!objectUrl) { const saved = await cache.match(src); if (saved) await show(saved); }
        if (!navigator.onLine) return;
        const response = await fetch(src, { cache: "no-cache", signal: AbortSignal.timeout(8000) });
        if (response.ok && response.headers.get("content-type")?.startsWith("image/")) {
          await cache.put(src, response.clone()); await show(response);
        }
      } catch { /* The original URL remains a fallback for hosts without CORS. */ }
      finally { busy = false; }
    };
    void refresh(); const timer = setInterval(() => void refresh(), 60000);
    window.addEventListener("online", refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener("online", refresh); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={image?.source === src ? image.url : src} alt="" className={className}
    src={image?.source === src ? image.url : src} onError={event => { event.currentTarget.style.visibility = "hidden"; }} />;
}

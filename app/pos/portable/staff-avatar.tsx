"use client";
import { useEffect, useState } from "react";

// Keep photos locally for offline use. Roster changes supply the current URL;
// reconnection retries missing photos without a timer for every avatar.
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
        const response = await fetch(src, { cache: "default", signal: AbortSignal.timeout(8000) });
        if (response.ok && response.headers.get("content-type")?.startsWith("image/")) {
          await cache.put(src, response.clone()); await show(response);
        }
      } catch { /* The original URL remains a fallback for hosts without CORS. */ }
      finally { busy = false; }
    };
    void refresh();
    window.addEventListener("online", refresh);
    return () => { active = false; window.removeEventListener("online", refresh); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img key={image?.source === src ? image.url : src} alt="" className={className}
    src={image?.source === src ? image.url : src} onError={event => { event.currentTarget.style.visibility = "hidden"; }} />;
}

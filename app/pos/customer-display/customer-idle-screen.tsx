"use client";
import { useEffect, useState, type ReactNode } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { CustomerRelayEntry } from "@/app/service-relay/customer-relay";
import { useCustomerDisplayPreferences } from "@/lib/customer-display-preferences";
import { useLocalPromotionImages } from "@/lib/customer-display-local-images";
import "./customer-idle-screen.css";

export function CustomerIdleScreen({ token, images, title, body, salonName, backgroundImageUrl, onBegin, children, fullscreenControl }: {
  token: string; images: string[]; title: string; body: string; salonName: string; backgroundImageUrl?: string; onBegin: () => void; children: ReactNode; fullscreenControl?: ReactNode;
}) {
  const t = useWorkspaceTranslation();
  const preferences = useCustomerDisplayPreferences();
  const localImages = useLocalPromotionImages();
  const displayImages = localImages.length ? localImages : images;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { const start = Date.now(); const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000); return () => clearInterval(timer); }, []);
  const showAd = preferences.adsEnabled && seconds >= preferences.idleSeconds && displayImages.length > 0;
  const slide = displayImages.length ? Math.floor(Math.max(0, seconds - preferences.idleSeconds) / preferences.slideSeconds) % displayImages.length : 0;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  return <section className="customer-idle-screen" style={backgroundImageUrl ? { backgroundImage: `linear-gradient(rgba(250,250,250,.86),rgba(250,250,250,.86)),url(${JSON.stringify(backgroundImageUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} aria-label={t("Customer welcome screen")} data-ad-visible={showAd} data-ad-layout={preferences.layout}>
    <header className="customer-idle-heading"><strong>{salonName}</strong>{fullscreenControl}</header>
    <div className="customer-idle-layout">
      {showAd && <section className="customer-idle-ad" aria-label={t("Salon promotion")}>
        {displayImages[slide] !== failedImage && <img src={displayImages[slide]} alt="" onError={() => setFailedImage(displayImages[slide])} />}
        <div className="customer-idle-ad-copy"><h1>{title}</h1><p>{body}</p>{preferences.layout === "full" && <button type="button" onClick={onBegin}><WorkspaceText text="Touch to check in" /></button>}</div>
        <span className="customer-idle-slide" aria-label={t("Promotion slide")}>{slide + 1} / {displayImages.length}</span>
      </section>}
      <div className="customer-idle-phone">{children}</div>
      <aside className="customer-idle-qr"><CustomerRelayEntry token={token} /></aside>
    </div>
  </section>;
}

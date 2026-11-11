/* eslint-disable @next/next/no-img-element -- Local kiosk artwork and owner-uploaded promotion images use direct image URLs. */
"use client";
import { SalonName } from "@/components/salon-member-badge";

import { useEffect, useState, type ReactNode } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { CustomerRelayEntry } from "@/app/service-relay/customer-relay";
import { useCustomerDisplayPreferences } from "@/lib/customer-display-preferences";
import { DEFAULT_CUSTOMER_DISPLAY_PROMO_SLIDE_URL } from "@/lib/pos-display-default-assets";
import { checkinPromotionCopy } from "@/lib/checkin-presentation";
import { useLocalPromotionImages } from "@/lib/customer-display-local-images";
import "./customer-idle-screen.css";

export function CustomerIdleScreen({ token, images, title, body, salonName, backgroundImageUrl, onBegin, children, fullscreenControl, giftControl, activeEntry = false, showSalonName = true, salonLogoUrl }: {
  token: string; images: string[]; title: string; body: string; salonName: string; backgroundImageUrl?: string; onBegin: () => void; children: ReactNode; fullscreenControl?: ReactNode; giftControl?: ReactNode; activeEntry?: boolean; showSalonName?: boolean; salonLogoUrl?: string | null;
}) {
  const t = useWorkspaceTranslation();
  const preferences = useCustomerDisplayPreferences();
  const localImages = useLocalPromotionImages();
  const displayImages = localImages.length ? localImages : images;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => { const start = Date.now(); const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000); return () => clearInterval(timer); }, []);
  const showAd = (!activeEntry || preferences.layout === "split") && preferences.adsEnabled && seconds >= preferences.idleSeconds && displayImages.length > 0;
  const slide = displayImages.length ? Math.floor(Math.max(0, seconds - preferences.idleSeconds) / preferences.slideSeconds) % displayImages.length : 0;
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const selectedImage = displayImages[slide];
  const customImage = selectedImage && ![DEFAULT_CUSTOMER_DISPLAY_PROMO_SLIDE_URL, "/pos/checkin-shared-default.webp", "/pos/customer-display-default-promo-slide.png"].includes(selectedImage) && !failedImages[selectedImage] ? selectedImage : null;
  const copy = checkinPromotionCopy(title, body);
  const hasOwnerCopy = copy.title !== "A little time for you." || copy.body !== "Beauty. Connected. Rewarded.";
  return <section className="customer-idle-screen" style={backgroundImageUrl ? { backgroundImage: `linear-gradient(rgba(250,250,250,.86),rgba(250,250,250,.86)),url(${JSON.stringify(backgroundImageUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} aria-label={t("Customer welcome screen")} data-ad-visible={showAd} data-ad-layout={preferences.layout}>
    <header className="customer-idle-heading"><div className="customer-idle-salon">{salonLogoUrl && <img src={salonLogoUrl} alt={t("Salon logo")}/>} {showSalonName && <strong><SalonName name={salonName} reference={{kind:"display",value:token}}/></strong>}</div><div className="customer-idle-brand"><span>Reylumi</span>{fullscreenControl}</div></header>
    <div className="customer-idle-layout">
      <div className="customer-idle-story">
        {showAd && <section className="customer-idle-hero">
          {customImage ? <section className="customer-idle-custom" aria-label={t("Salon promotion")}>
            <img src={customImage} alt="" onError={() => setFailedImages(value => ({...value, [customImage]: true}))} />
            <div className="customer-idle-custom-copy"><h1>{copy.title}</h1><p>{copy.body}</p></div>
            <span className="customer-idle-slide">{slide + 1} / {displayImages.length}</span>
          </section> : <section className="customer-idle-default">
            <img className="customer-idle-portrait" src={DEFAULT_CUSTOMER_DISPLAY_PROMO_SLIDE_URL} alt="Reylumi — Your next reward starts here. Check in. Earn points. Enjoy more. Customer app preview with sample reward points and appointment." />
            {hasOwnerCopy && <div className="customer-idle-custom-copy"><h1>{copy.title}</h1><p>{copy.body}</p></div>}
          </section>}
          {showAd && preferences.layout === "full" && <button className="customer-idle-begin" type="button" onClick={onBegin}><WorkspaceText text="Touch to check in" /> <span aria-hidden="true">→</span></button>}
        </section>}
        <div className="customer-idle-services"><aside className="customer-idle-qr"><CustomerRelayEntry token={token} /></aside>{giftControl}</div>
      </div>
      <div className="customer-idle-phone">{children}</div>
    </div>
  </section>;
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { campaignDeliveryRequest } from "@/lib/campaign-delivery-area";
import { adRequest, prepareAdImage } from "@/lib/advertising-client";
import styles from "./owner-campaign.module.css";
type Ad = { title: string; caption: string; image: string | null; href: string; ticket: string };
export function OwnerSponsoredPost({ location, latitude, longitude }: { location?: string; latitude?:number|null; longitude?:number|null }) {
  const selection = useMemo(() => campaignDeliveryRequest(location,latitude,longitude),[location,latitude,longitude]);
  const requestKey = selection?.key ?? null;
  const [delivery, setDelivery] = useState<{ key: string; ad: Ad } | null>(null);
  const [admittedTicket, setAdmittedTicket] = useState<string | null>(null);
  const [dismissedTicket, setDismissedTicket] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const ad = delivery && delivery.key === requestKey ? delivery.ad : null;
  const claims = useRef(new Map<string, Promise<boolean>>());
  useEffect(() => {
    if (!selection) return;
    const abort = new AbortController();
    void adRequest(selection.url, { signal: abort.signal, ...(selection.body ? {method:"POST",headers:{"Content-Type":"application/json"},body:selection.body}: {}) }, selection.body ? 10000 : 4000)
      .then(async (value: Ad | null) => {
        if (!value?.ticket || !value.href || !await prepareAdImage(value.image ?? "", abort.signal)) return;
        if (!abort.signal.aborted) { setDelivery({ key:selection.key, ad: value }); setAdmittedTicket(null); setDismissedTicket(null); }
      }).catch(() => {});
    return () => abort.abort();
  }, [selection]);
  useEffect(() => {
    const element = ref.current;
    if (!ad || !element || dismissedTicket === ad.ticket) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false, requested = false, visible = false;
    const cancel = () => { clearTimeout(timer); timer = undefined; };
    const schedule = () => {
      cancel();
      if (!visible || document.visibilityState !== "visible" || requested) return;
      timer = setTimeout(() => {
        const rect = element.getBoundingClientRect();
        const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
        const image = element.querySelector("img");
        if (image && (!image.complete || !image.naturalWidth)) return;
        if (disposed || document.visibilityState !== "visible" || height < rect.height * .5) return;
        requested = true;
        let claim = claims.current.get(ad.ticket);
        if (!claim) {
          claim = adRequest("/api/campaigns/delivery", { method: "POST", keepalive: true,
            headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket: ad.ticket, kind: "view" }) })
            .then(result => result.ok === true).catch(() => false);
          claims.current.set(ad.ticket, claim);
        }
        void claim.then(ok => {
          if (disposed) return;
          if (ok) setAdmittedTicket(ad.ticket); else setDismissedTicket(ad.ticket);
        });
      }, 1000);
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .5;
      schedule();
    }, { threshold: [0, .5, 1] });
    observer.observe(element);
    document.addEventListener("visibilitychange", schedule);
    return () => { disposed = true; cancel(); observer.disconnect(); document.removeEventListener("visibilitychange", schedule); };
  }, [ad, dismissedTicket]);
  if (!ad || dismissedTicket === ad.ticket) return null;
  return <article ref={ref} className={styles.card} aria-label="Sponsored post">
    <div className={styles.cardHeader}><span className={styles.eyebrow}>SPONSORED</span><button className={styles.close} aria-label="Hide sponsored post" onClick={() => setDismissedTicket(ad.ticket)}>×</button></div>
    {ad.image ? <Image unoptimized src={ad.image} alt="" width={640} height={400} sizes="(max-width: 600px) 100vw, 50vw" style={{ width: "100%", height: "auto", maxHeight: 320, objectFit: "cover", borderRadius: 14, margin: "12px 0" }} /> : null}
    <h3 style={{ marginTop: 12 }}>{ad.title}</h3>{ad.caption ? <p className={styles.muted}>{ad.caption}</p> : null}
    <a className={styles.primary} href={ad.href} onClick={() => {
      // Navigation is immediate. An early click cannot create an unearned, billable view.
      if (admittedTicket === ad.ticket) void adRequest("/api/campaigns/delivery", { method: "POST", keepalive: true,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket: ad.ticket, kind: "click" }) }).catch(() => {});
    }}>Discover this post →</a>
  </article>;
}

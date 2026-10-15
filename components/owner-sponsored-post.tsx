"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./owner-campaign.module.css";
type Ad = { title: string; caption: string; image: string | null; href: string; ticket: string };
export function OwnerSponsoredPost({ location }: { location?: string }) {
  const [ad, setAd] = useState<Ad | null>(null);
  const [admitted, setAdmitted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!location) return;
    const abort = new AbortController();
    void fetch(`/api/campaigns/delivery?location=${encodeURIComponent(location)}`,{signal:abort.signal}).then(result => result.json()).then(value => { setAd(value); setAdmitted(false); setDismissed(false); }).catch(() => {});
    return () => abort.abort();
  }, [location]);
  useEffect(() => {
    const element = ref.current;
    if (!ad || !element || dismissed) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let requested = false;
    const observer = new IntersectionObserver(entries => {
      if (timer) clearTimeout(timer);
      if (entries[0].isIntersecting && entries[0].intersectionRatio >= .5 && document.visibilityState === "visible" && !requested) timer = setTimeout(() => {
        if (document.visibilityState !== "visible") return;
        requested = true;
        void fetch("/api/campaigns/delivery",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticket:ad.ticket,kind:"view"})}).then(r => r.json()).then(result => { if (result.ok) setAdmitted(true); else setDismissed(true); }).catch(() => setDismissed(true));
      },1000);
    },{threshold:[0,.5,1]});
    observer.observe(element);
    const visibility = () => { if (timer) clearTimeout(timer); if (document.visibilityState === "visible" && !requested) { observer.unobserve(element); observer.observe(element); } };
    document.addEventListener("visibilitychange",visibility);
    return () => { observer.disconnect(); if(timer) clearTimeout(timer); document.removeEventListener("visibilitychange",visibility); };
  }, [ad,dismissed]);
  if (!ad || dismissed) return null;
  return <article ref={ref} className={styles.card} aria-label="Sponsored post"><div className={styles.cardHeader}><span className={styles.eyebrow}>SPONSORED</span><button className={styles.close} aria-label="Hide sponsored post" onClick={() => setDismissed(true)}>×</button></div>{ad.image ? <Image unoptimized={ad.image?.includes("/storage/v1/object/sign/")} src={ad.image} alt="" width={640} height={400} sizes="(max-width: 600px) 100vw, 50vw" style={{width:"100%",height:"auto",maxHeight:320,objectFit:"cover",borderRadius:14,margin:"12px 0"}} /> : null}<h3 style={{marginTop:12}}>{ad.title}</h3>{ad.caption ? <p className={styles.muted}>{ad.caption}</p> : null}<a className={styles.primary} aria-disabled={!admitted} href={admitted ? ad.href : undefined} onClick={event => { if (!admitted) { event.preventDefault(); return; } void fetch("/api/campaigns/delivery",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},body:JSON.stringify({ticket:ad.ticket,kind:"click"})}); }}>Discover this post →</a></article>;
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useWorkspaceTranslation } from "@/components/workspace-language";
import { beginBookingDepositCheckoutAction } from "./booking-deposit-purchase-actions";
import { openMarketPayment } from "@/lib/open-market-payment";
import { isReylumiIOSClient } from "@/lib/ios-client";
import styles from "./booking-deposit-product.module.css";

const screenshots = [
  { file: "booking", caption: "Customer booking", width: 640, height: 632 },
  { file: "settings", caption: "Salon settings", width: 636, height: 459 },
  { file: "receipts", caption: "Payment receipt", width: 640, height: 374 },
];
const features = [
  ["Choose a flexible deposit", "A fixed amount, a percentage or the full service price."],
  ["Make the amount clear", "Customers see their deposit and remaining balance."],
  ["Track deposits by appointment", "See payments, refunds and receipts."],
];

export function BookingDepositProduct({ salonId, installed = false, cancelled = false }: { salonId?: string; installed?: boolean; cancelled?: boolean }) {
  const t = useWorkspaceTranslation(), router = useRouter();
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [photo, setPhoto] = useState<number | null>(null);
  const viewer = useRef<HTMLDialogElement>(null), alive = useRef(true), pending = useRef(false);
  useEffect(() => { alive.current = true; const dialog = viewer.current; return () => { alive.current = false; dialog?.close(); }; }, []);
  useEffect(() => {
    if (photo !== null && !viewer.current?.open) viewer.current?.showModal();
    if (photo === null && viewer.current?.open) viewer.current?.close();
  }, [photo]);
  function add() {
    if (pending.current || busy) return;
    pending.current = true;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await beginBookingDepositCheckoutAction(salonId);
        if (!alive.current) return;
        if (result.path) { router.push(result.path); return; }
        if (result.url) {
          const url = new URL(result.url);
          if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com" || url.username || url.password || url.port) throw new Error("Invalid checkout link.");
          if (openMarketPayment(url.href) && isReylumiIOSClient(navigator.userAgent) && salonId) {
            router.push(`/market/booking-deposit/payment?salon=${encodeURIComponent(salonId)}`);
          }
        } else setMessage(result.error || "Payment could not open. Please try again.");
      } catch { if (alive.current) setMessage("Payment could not open. Please try again."); }
      finally { pending.current = false; }
    });
  }
  const selected = photo === null ? null : screenshots[photo];
  return <main className={styles.page}>
    <Link href="/market" className={styles.back}><span aria-hidden="true">←</span>{t("Discover plugins")}</Link>
    <header className={styles.identity}>
      <div className={styles.identityCopy}><h1>Booking Deposit</h1><p className={styles.publisher}>{t("A plugin by Reylumi")}</p><p className={styles.tagline}>{t("Deposits upfront. Bookings with confidence.")}</p><span className={styles.category}>{t("Booking")}</span></div>
      <div className={styles.pluginIcon} aria-hidden="true"><svg viewBox="0 0 30 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="24" height="19" rx="4" /><path d="M3 13h24M8 19h5m5 1 3 3 6-7" /></svg></div>
    </header>
    <section className={styles.album} aria-label={t("Plugin screenshots")}>
      {screenshots.map((screen, index) => <figure key={screen.file}>
        <button type="button" className={`${styles.screen} ${styles[screen.file]}`} onClick={() => setPhoto(index)} aria-label={t(screen.caption)}>
          <Image src={`/market/booking-deposit/${screen.file}.jpg`} alt={t(screen.caption)} width={screen.width} height={screen.height} sizes="(max-width: 700px) 238px, 360px" />
        </button><figcaption>{t(screen.caption)}</figcaption>
      </figure>)}
    </section>
    <section className={styles.about} aria-labelledby="deposit-about"><h2 id="deposit-about">{t("About this plugin")}</h2><p className={styles.description}>{t("Collect part or all of the service price when customers book online.")}</p>
      <ul className={styles.features}>{features.map(([title, detail]) => <li key={title}><span className={styles.check} aria-hidden="true">✓</span><div><strong>{t(title)}</strong><p>{t(detail)}</p></div></li>)}</ul>
    </section>
    <footer className={styles.action}>
      {cancelled && <p className={styles.notice} role="status">{t("Checkout cancelled. You can add Booking Deposit whenever you are ready.")}</p>}
      {message && <p className={styles.notice} role="alert">{t(message)}</p>}
      <button type="button" className={styles.primary} onClick={add} disabled={busy}>{t(busy ? "Opening…" : installed ? "Open deposit settings" : "Add to Reylumi")}</button>
    </footer>
    <dialog ref={viewer} className={styles.viewer} aria-label={t("Plugin screenshots")} onCancel={() => setPhoto(null)} onClose={() => setPhoto(null)} onClick={event => { if (event.target === viewer.current) setPhoto(null); }} onKeyDown={event => { if (photo === null) return; if (event.key === "ArrowRight") setPhoto((photo + 1) % 3); if (event.key === "ArrowLeft") setPhoto((photo + 2) % 3); }}>
      {selected && <div className={styles.viewerContent}><header><strong>{t(selected.caption)}</strong><button type="button" aria-label={t("Close image")} onClick={() => setPhoto(null)}>×</button></header><Image src={`/market/booking-deposit/${selected.file}.jpg`} alt={t(selected.caption)} width={selected.width} height={selected.height} sizes="(max-width: 700px) 90vw, 640px" /><nav aria-label={t("Album navigation")}><button type="button" aria-label={t("Previous image")} onClick={() => setPhoto((photo! + 2) % 3)}>←</button><span>{photo! + 1} / 3</span><button type="button" aria-label={t("Next image")} onClick={() => setPhoto((photo! + 1) % 3)}>→</button></nav></div>}
    </dialog>
  </main>;
}

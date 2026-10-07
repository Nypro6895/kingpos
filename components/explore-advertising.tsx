/* eslint-disable @next/next/no-img-element -- Preserve uploaded GIF animation and intrinsic campaign dimensions. */
"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import type { Campaign } from "@/types/explore-advertising";
import { chooseCampaign } from "@/lib/explore-advertising-rules";
import styles from "./explore-advertising.module.css";
const Context = createContext<Campaign | null>(null);
function select(campaigns: Campaign[], kind: Campaign["kind"]) {
  let previous: string | null = null;
  try {
    previous = sessionStorage.getItem(`reylumi-ad-${kind}`);
  } catch {}
  const selected = chooseCampaign(
    campaigns.filter((c) => c.kind === kind),
    previous,
  );
  if (selected)
    try {
      sessionStorage.setItem(`reylumi-ad-${kind}`, selected.id);
    } catch {}
  return selected;
}
function ImageAd({ campaign }: { campaign: Campaign }) {
  const Tag = campaign.href ? "a" : "div";
  return (
    <Tag
      className={styles.imageLink}
      {...(campaign.href ? { href: campaign.href } : {})}
      aria-label={campaign.name}
      style={{ background: campaign.background, color: campaign.color }}
    >
      {campaign.imageUrl ? (
        <img src={campaign.imageUrl} alt={campaign.name} />
      ) : null}
      {campaign.text || !campaign.imageUrl ? (
        <div className={styles.message}>
          <strong>{campaign.name}</strong>
          {campaign.text ? <p>{campaign.text}</p> : null}
        </div>
      ) : null}
      <span className={styles.sponsored}>Sponsored</span>
    </Tag>
  );
}
export function ExploreAdSlot({ desktop = false }: { desktop?: boolean }) {
  const campaign = useContext(Context);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!campaign) return;
    const show = setTimeout(
      () => setVisible(true),
      campaign.delaySeconds * 1000,
    );
    const hide = campaign.durationSeconds
      ? setTimeout(
          () => setVisible(false),
          (campaign.delaySeconds + campaign.durationSeconds) * 1000,
        )
      : undefined;
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
      setVisible(false);
    };
  }, [campaign]);
  if (!campaign || !visible) return null;
  return (
    <aside
      aria-label="Advertisement"
      className={desktop ? styles.desktop : styles.feed}
    >
      <ImageAd campaign={campaign} />
    </aside>
  );
}
export function ExploreAdvertising({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = pathname.startsWith("/explore");
  const [placement, setPlacement] = useState<Campaign | null>(null);
  const [popup, setPopup] = useState<Campaign | null>(null);
  const [ticker, setTicker] = useState<Campaign | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const controller = new AbortController();
    const schedule = (
      campaign: Campaign | null,
      set: (campaign: Campaign | null) => void,
    ) => {
      if (!campaign) return;
      timers.push(
        setTimeout(() => {
          if (!cancelled) set(campaign);
        }, campaign.delaySeconds * 1000),
      );
      if (campaign.durationSeconds)
        timers.push(
          setTimeout(
            () => {
              if (!cancelled) set(null);
            },
            (campaign.delaySeconds + campaign.durationSeconds) * 1000,
          ),
        );
    };
    void fetch("/api/explore/advertising", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((data: { campaigns: Campaign[] }) => {
        if (cancelled) return;
        setPlacement(select(data.campaigns, "placement"));
        schedule(select(data.campaigns, "ticker"), setTicker);
        const selected = select(data.campaigns, "popup");
        if (selected)
          timers.push(
            setTimeout(async () => {
              try {
                const response = await fetch("/api/explore/advertising", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ id: selected.id }),
                  signal: controller.signal,
                });
                const result = await response.json();
                if (!cancelled && result.allowed) {
                  setPopup(selected);
                  if (selected.durationSeconds)
                    timers.push(
                      setTimeout(
                        () => setPopup(null),
                        selected.durationSeconds * 1000,
                      ),
                    );
                }
              } catch {}
            }, selected.delaySeconds * 1000),
          );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
      timers.forEach(clearTimeout);
      setPopup(null);
      setTicker(null);
      setPlacement(null);
    };
  }, [active, pathname]);
  useEffect(() => {
    if (!popup) return;
    const previous = document.activeElement as HTMLElement | null;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = document.querySelector<HTMLElement>("[data-ad-popup]");
    node?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && popup.closeButton) setPopup(null);
      if (event.key === "Tab") {
        const nodes = node?.querySelectorAll<HTMLElement>("a,button");
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === node)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = old;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [popup]);
  return (
    <Context.Provider value={active ? placement : null}>
      <div
        className={
          active && ticker
            ? ticker.position === "top"
              ? styles.topReserve
              : styles.bottomReserve
            : undefined
        }
      >
        {children}
      </div>
      {active && ticker
        ? createPortal(
            <div
              className={`${styles.ticker} ${ticker.position === "top" ? styles.top : styles.bottom}`}
              style={{ background: ticker.background, color: ticker.color }}
            >
              {ticker.href ? (
                <a
                  href={ticker.href}
                  style={{ animationDuration: `${ticker.speedSeconds}s` }}
                >
                  {ticker.text || ticker.name}
                </a>
              ) : (
                <span
                  className={styles.tickerText}
                  style={{ animationDuration: `${ticker.speedSeconds}s` }}
                >
                  {ticker.text || ticker.name}
                </span>
              )}
              {ticker.closeButton ? (
                <button
                  aria-label="Close announcement"
                  onClick={() => setTicker(null)}
                >
                  ×
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {active && popup
        ? createPortal(
            <div className={styles.backdrop}>
              <section
                className={styles.popup}
                data-ad-popup
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label={popup.name}
              >
                <ImageAd campaign={popup} />
                {popup.closeButton ? (
                  <button
                    className={styles.close}
                    aria-label="Close promotion"
                    onClick={() => setPopup(null)}
                  >
                    ×
                  </button>
                ) : null}
              </section>
            </div>,
            document.body,
          )
        : null}
    </Context.Provider>
  );
}

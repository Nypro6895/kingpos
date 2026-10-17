"use client";
import { adRequest, prepareAdImage } from "@/lib/advertising-client";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { NavigationProgress } from "@/components/feedback-link";
/* eslint-disable @next/next/no-img-element -- Preserve uploaded GIF animation and intrinsic campaign dimensions. */

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useId,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import type {
  Campaign,
  CampaignAudience,
  CampaignPlacement,
} from "@/types/explore-advertising";
import {
  chooseCampaign,
  shuffleCampaigns,
  campaignMatches,
} from "@/lib/explore-advertising-rules";
import styles from "./explore-advertising.module.css";
const Context = createContext<{
  campaigns: Campaign[];
  claimFeed: (id: string, slot: string) => boolean;
  record: (campaign: Campaign, event: "view" | "shown" | "click") => Promise<boolean>;
}>({ campaigns: [], claimFeed: () => true, record: async () => true });

function useAdNavigation(record: (campaign: Campaign, event: "view" | "click") => Promise<boolean>) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    const reset = () => {
      generation.current += 1;
      busy.current = false;
      setPending(false);
    };
    window.addEventListener("pageshow", reset);
    return () => {
      mounted.current = false;
      window.removeEventListener("pageshow", reset);
      reset();
    };
  }, [record]);
  async function navigate(campaign: Campaign) {
    if (busy.current || !mounted.current) return;
    busy.current = true;
    const attempt = ++generation.current;
    setPending(true);
    try {
      void record(campaign, "click").catch(() => {});
      if (mounted.current && generation.current === attempt) window.location.assign(campaign.href);
    } catch {
      if (mounted.current && generation.current === attempt) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  return { pending, navigate };
}
function imageSrcset(campaign: Campaign) {
  return campaign.imageVariants?.map(image => `${image.url} ${image.width}w`).join(", ");
}
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
export function ImageAd({
  campaign,
  preview = false,
}: {
  campaign: Campaign;
  preview?: boolean;
}) {
  const __vt = useWorkspaceTranslation();

  const { record } = useContext(Context);
  const navigation = useAdNavigation(record);
  const Tag = campaign.href && !preview ? "a" : "div";
  return (
    <Tag
      className={styles.imageLink}
      {...(campaign.href && !preview
        ? {
            href: campaign.href,
            onClick: async (event: React.MouseEvent) => {
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                void record(campaign, "click");
                return;
              }
              event.preventDefault();
              await navigation.navigate(campaign);
            },
          }
        : {})}
      aria-label={__vt(campaign.name)}
      style={{ background: campaign.background, color: campaign.color }}
    >
      {campaign.imageUrl ? (
        <img src={campaign.imageUrl} srcSet={imageSrcset(campaign)} sizes="(max-width: 600px) 90vw, 380px" width={campaign.imageWidth} height={campaign.imageHeight} decoding="async" alt={__vt(campaign.name)} />
      ) : null}
      {campaign.text || !campaign.imageUrl ? (
        <div className={styles.message}>
          <strong>{campaign.name}</strong>
          {campaign.text ? <p><WorkspaceText text={campaign.text} /></p> : null}
        </div>
      ) : null}
      <span className={styles.sponsored}><WorkspaceText text="Sponsored" /></span>
      <NavigationProgress pending={navigation.pending} />
    </Tag>
  );
}
function AdDisplayConfirmation({ campaign, onDenied }: { campaign: Campaign; onDenied: () => void }) {
  const { record } = useContext(Context);
  const marker = useRef<HTMLSpanElement>(null);
  const denied = useRef(onDenied);
  useEffect(() => { denied.current = onDenied; }, [onDenied]);
  useEffect(() => {
    const element = marker.current?.parentElement;
    if (!element) return;
    let frame = 0; let secondFrame = 0; let disposed = false; let requested = false;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || document.visibilityState !== "visible" || requested) return;
      frame = requestAnimationFrame(() => { secondFrame = requestAnimationFrame(() => {
        if (disposed || document.visibilityState !== "visible" || requested) return;
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
        const image = element.querySelector("img");
        if ((image && (!image.complete || !image.naturalWidth)) || document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) {
          denied.current(); return;
        }
        requested = true;
        void record(campaign, "shown").then(allowed => { if (!disposed && !allowed) denied.current(); });
      }); });
    });
    observer.observe(element);
    const visible = () => { if (document.visibilityState === "visible" && !requested) { observer.unobserve(element); observer.observe(element); } };
    document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); document.removeEventListener("visibilitychange", visible); };
  }, [campaign, record]);
  return <span ref={marker} hidden />;
}

export function ExploreAdSlot({
  desktop = false,
  slotIndex = 0,
  position,
}: {
  desktop?: boolean;
  slotIndex?: number;
  position?: CampaignPlacement;
}) {
  const __vt = useWorkspaceTranslation();

  const { campaigns, claimFeed, record } = useContext(Context);
  const slotId = useId();
  const location = position ?? (desktop ? "sidebar" : "feed");
  const campaign =
    campaigns.filter((item) =>
      (item.placements ?? ["sidebar", "feed"]).includes(location),
    )[slotIndex] ?? null;
  const [visible, setVisible] = useState(false);
  const slotRef = useRef<HTMLElement>(null);
  const [admitted, setAdmitted] = useState(false);
  useEffect(() => {
    if (!campaign) return;
    const show = setTimeout(() => {
      setAdmitted(false);
      setVisible(true);
    }, campaign.delaySeconds * 1000);
    return () => {
      clearTimeout(show);
      setVisible(false);
    };
  }, [campaign]);
  useEffect(() => {
    if (!visible || !campaign || !slotRef.current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const abort = new AbortController();
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        if (location === "feed" && !claimFeed(campaign.id, slotId)) {
          setVisible(false);
          return;
        }
        void prepareAdImage(campaign.imageUrl, abort.signal, 6000, imageSrcset(campaign)).then(ready => ready && !disposed && document.visibilityState === "visible" ? record(campaign, "view") : false).then((allowed) => {
          if (disposed) return;
          if (!allowed) {
            setVisible(false);
            return;
          }
          setAdmitted(true);
          if (campaign.durationSeconds)
            timer = setTimeout(
              () => setVisible(false),
              campaign.durationSeconds * 1000,
            );
        });
      }
    });
    observer.observe(slotRef.current);
    return () => {
      disposed = true;
      abort.abort();
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [visible, campaign, location, claimFeed, slotId, record]);
  if (!campaign || !visible) return null;
  return (
    <aside
      ref={slotRef}
      style={{ visibility: admitted ? "visible" : "hidden" }}
      aria-label={__vt("Advertisement")}
      className={
        position ? styles.pagePlacement : desktop ? styles.desktop : styles.feed
      }
    >
      {admitted ? <AdDisplayConfirmation campaign={campaign} onDenied={() => setVisible(false)} /> : null}
      <ImageAd campaign={campaign} />
    </aside>
  );
}
export function ExploreAdvertising({
  children,
  audience = "guest",
  enabled = true,
}: {
  children: ReactNode;
  audience?: CampaignAudience;
  enabled?: boolean;
}) {
  const __vt = useWorkspaceTranslation();

  const pathname = usePathname();
  const active = enabled && !pathname.startsWith("/admin");
  const [device, setDevice] = useState<"desktop" | "mobile" | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const update = () => setDevice(query.matches ? "desktop" : "mobile");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [placement, setPlacement] = useState<Campaign[]>([]);
  const feedClaims = useRef(new Map<string, string>());
  const claimFeed = useCallback((id: string, slot: string) => {
    const previous = feedClaims.current.get(id);
    if (previous && previous !== slot) return false;
    feedClaims.current.set(id, slot);
    return true;
  }, []);
  const recorded = useRef(new Map<string, Promise<boolean>>());
  const reservations = useRef(new Map<string, string>());
  const visit = useRef<AbortController | null>(null);
  const record = useCallback(
    (campaign: Campaign, event: "view" | "shown" | "click") => {
      const key = `${pathname}:${campaign.id}:${event}`;
      const previous = recorded.current.get(key);
      if (previous) return previous;
      const promise = adRequest("/api/explore/advertising", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: campaign.id,
          event: event === "shown" ? "view" : event,
          phase: event === "view" ? "reserve" : event === "shown" ? "confirm" : undefined,
          reservation: reservations.current.get(`${pathname}:${campaign.id}`),
          path: pathname,
          device,
        }),
        keepalive: true,
        signal: event === "click" ? undefined : visit.current?.signal,
      })
        .then((result) => {
          if (event === "view" && result.allowed && result.reservation) reservations.current.set(`${pathname}:${campaign.id}`, result.reservation);
          return result.allowed === true && (event !== "view" || Boolean(result.reservation));
        })
        .catch(() => false);
      recorded.current.set(key, promise);
      return promise;
    },
    [pathname, device],
  );
  const [popup, setPopup] = useState<Campaign | null>(null);
  const [ticker, setTicker] = useState<Campaign | null>(null);
  const navigation = useAdNavigation(record);
  useEffect(() => {
    if (!active || !device) return;
    feedClaims.current.clear();
    recorded.current.clear();
    reservations.current.clear();
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const controller = new AbortController();
    visit.current = controller;
    const listeners: (() => void)[] = [];
    const schedule = (
      campaign: Campaign | null,
      set: (campaign: Campaign | null) => void,
    ) => {
      if (!campaign) return;
      timers.push(setTimeout(() => {
        if (cancelled || document.visibilityState !== "visible") return;
        void record(campaign, "view").then(allowed => {
          if (cancelled || !allowed || document.visibilityState !== "visible") return;
          set(campaign);
          if (campaign.durationSeconds) timers.push(setTimeout(() => set(null), campaign.durationSeconds * 1000));
        });
      }, campaign.delaySeconds * 1000));
    };
    void adRequest(
      `/api/explore/advertising?path=${encodeURIComponent(pathname)}&device=${device}`,
      {
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then((data: { campaigns: Campaign[] }) => {
        if (cancelled) return;
        const eligible = data.campaigns.filter((campaign) =>
          campaignMatches(campaign, pathname, audience, device),
        );
        const shuffled = shuffleCampaigns(
          eligible.filter((c) => c.kind === "placement"),
        );
        const first = select(shuffled, "placement");
        setPlacement(
          first ? [first, ...shuffled.filter((c) => c.id !== first.id)] : [],
        );
        const announcement = select(eligible, "ticker");
        const announcementDelay =
          device === "mobile" ? 0 : (announcement?.delaySeconds ?? 0);
        schedule(
          announcement
            ? {
                ...announcement,
                delaySeconds: announcementDelay,
                position: device === "mobile" ? "top" : announcement.position,
              }
            : null,
          setTicker,
        );
        const selected = select(eligible, "popup");
        if (selected) {
          // Decode early during the configured delay, without counting an impression.
          const prepared = prepareAdImage(selected.imageUrl, controller.signal, 6000, imageSrcset(selected));
          const unobstructed = () => document.visibilityState === "visible" &&
            !document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]') &&
            !document.activeElement?.matches('input,textarea,select,[contenteditable="true"]');
          const display = async () => {
            if (!await prepared || cancelled || !unobstructed()) return;
            const allowed = await record(selected, "view");
            if (!cancelled && allowed && unobstructed()) {
              setPopup(selected);
              if (selected.durationSeconds)
                timers.push(
                  setTimeout(
                    () => setPopup(null),
                    selected.durationSeconds * 1000,
                  ),
                );
            }
          };
          const delay = Math.max(
            selected.delaySeconds,
            announcement ? announcementDelay + 8 : 0,
          );
          let ready = false,
            fired = false;
          const reached = () => {
            const height =
              document.documentElement.scrollHeight - window.innerHeight;
            return (
              selected.popupTrigger !== "scroll" ||
              (height > 0 &&
                (window.scrollY / height) * 100 >=
                  (selected.scrollPercent ?? 35))
            );
          };
          const attempt = () => {
            if (ready && !fired && reached() && unobstructed()) {
              fired = true;
              void display();
            }
          };
          window.addEventListener("scroll", attempt, { passive: true });
          window.addEventListener("focusout", attempt);
          document.addEventListener("visibilitychange", attempt);
          listeners.push(() => { window.removeEventListener("scroll", attempt); window.removeEventListener("focusout", attempt); document.removeEventListener("visibilitychange", attempt); });
          timers.push(
            setTimeout(() => {
              ready = true;
              attempt();
            }, delay * 1000),
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      controller.abort();
      timers.forEach(clearTimeout);
      listeners.forEach((remove) => remove());
      setPopup(null);
      setTicker(null);
      setPlacement([]);
    };
  }, [active, pathname, audience, device, record]);
  useEffect(() => {
    if (!popup) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPopup(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popup]);
  const contextValue = useMemo(() => ({ campaigns: active ? placement : [], claimFeed, record }), [active, placement, claimFeed, record]);
  return (
    <Context.Provider
      value={contextValue}
    >
      <NavigationProgress pending={navigation.pending} />
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
              <AdDisplayConfirmation campaign={ticker} onDenied={() => setTicker(null)} />
              {ticker.href ? (
                <a
                  href={ticker.href}
                  onClick={async (event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey) {
                      void record(ticker, "click");
                      return;
                    }
                    event.preventDefault();
                    await navigation.navigate(ticker);
                  }}
                  style={{ animationDuration: `${ticker.speedSeconds}s` }}
                >
                  <WorkspaceText text={ticker.text || ticker.name} />
                </a>
              ) : (
                <span
                  className={styles.tickerText}
                  style={{ animationDuration: `${ticker.speedSeconds}s` }}
                >
                  <WorkspaceText text={ticker.text || ticker.name} />
                </span>
              )}
              {ticker.closeButton ? (
                <button
                  aria-label={__vt("Close announcement")}
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
                aria-modal="false"
                aria-label={__vt(popup.name)}
              >
                <AdDisplayConfirmation campaign={popup} onDenied={() => setPopup(null)} />
                <ImageAd campaign={popup} />
                {(
                  <button
                    className={styles.close}
                    aria-label={__vt("Close promotion")}
                    onClick={() => setPopup(null)}
                  >
                    ×
                  </button>
                )}
              </section>
            </div>,
            document.body,
          )
        : null}
    </Context.Provider>
  );
}

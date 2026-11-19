"use client";
import { useTransientOverlay } from "@/components/overlay-dismissal";
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
  Campaign as BaseCampaign,
  CampaignAudience,
  CampaignPlacement,
} from "@/types/explore-advertising";
import {
  chooseCampaign,
  forumCampaignAt,
  shuffleCampaigns,
  campaignMatches,
} from "@/lib/explore-advertising-rules";
import styles from "./explore-advertising.module.css";
import { AdDisclosureControls } from "@/components/ad-disclosure-controls";
import type { AdSelectionDisclosure, AdSelectionDetail } from "@/types/ad-disclosure";
type Campaign = BaseCampaign & { adDisclosure?: AdSelectionDisclosure; displayDetails?: AdSelectionDetail[] };
const Context = createContext<{
  campaigns: Campaign[];
  claimFeed: (id: string, slot: string) => boolean;
  disclosureFor: (campaign:Campaign)=>AdSelectionDisclosure|undefined;
  record: (campaign: Campaign, event: "view" | "shown" | "click") => Promise<boolean>;
}>({ campaigns: [], claimFeed: () => true, disclosureFor:campaign=>campaign.adDisclosure, record: async () => true });

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
  return selected ? {...selected, displayDetails:[...(selected.displayDetails ?? []), {
    label:"Rotation choice", value:"Random choice among "+campaigns.filter(c => c.kind === kind).length+" eligible "+kind+" promotions. "+
      (campaigns.filter(c => c.kind === kind).length > 1 && campaigns.some(c => c.kind === kind && c.id === previous)
        ? "The promotion previously selected in this browser session was excluded from this choice."
        : "There was no prior matching promotion to exclude, or only one eligible choice."),
  }]} : null;
}
export function ImageAd({
  campaign,
  preview = false,
  forum = false,
}: {
  campaign: Campaign;
  preview?: boolean;
  forum?: boolean;
}) {
  const __vt = useWorkspaceTranslation();

  const { record } = useContext(Context);
  const navigation = useAdNavigation(record);
  const Tag = campaign.href && !preview ? "a" : "div";
  return (
    <Tag
      className={forum ? styles.forumCard : styles.imageLink}
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
      style={forum ? undefined : { background: campaign.background, color: campaign.color }}
    >
      {forum ? <><span className={styles.forumSponsored}>Được tài trợ</span><strong>{campaign.name}</strong>{campaign.text ? <p>{campaign.text}</p> : null}</> : null}
      {campaign.imageUrl ? (
        <img src={campaign.imageUrl} srcSet={imageSrcset(campaign)} sizes="(max-width: 600px) 90vw, 380px" width={campaign.imageWidth} height={campaign.imageHeight} decoding="async" alt={__vt(campaign.name)} />
      ) : null}
      {!forum && (campaign.text || !campaign.imageUrl) ? (
        <div className={styles.message}>
          <strong>{campaign.name}</strong>
          {campaign.text ? <p><WorkspaceText text={campaign.text} /></p> : null}
        </div>
      ) : null}
      {forum ? (campaign.href ? <span className={styles.forumCta}>Xem chi tiết</span> : null) : <span className={styles.sponsored}><WorkspaceText text="Sponsored" /></span>}
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
        if (image && (!image.complete || !image.naturalWidth)) {
          denied.current(); return;
        }
        if(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'))return;
        requested = true;
        void record(campaign, "shown").then(allowed => { if (!disposed && !allowed) denied.current(); });
      }); });
    });
    observer.observe(element);
    const visible = () => { if (document.visibilityState === "visible" && !requested) { observer.unobserve(element); observer.observe(element); } };
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("close",visible,true);
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); document.removeEventListener("visibilitychange", visible);document.removeEventListener("close",visible,true); };
  }, [campaign, record]);
  return <span ref={marker} hidden />;
}

export function ExploreAdSlot({
  desktop = false,
  slotIndex = 0,
  position,
  campaignId,
  forumPostIndex,
  forumAfterPost,
}: {
  desktop?: boolean;
  slotIndex?: number;
  position?: CampaignPlacement;
  campaignId?: string;
  forumPostIndex?: number;
  forumAfterPost?: boolean;
}) {
  const __vt = useWorkspaceTranslation();

  const { campaigns, claimFeed, record, disclosureFor } = useContext(Context);
  const informationOpen=useRef(false);
  const informationChanged=useCallback((open:boolean)=>{informationOpen.current=open;},[]);
  const slotId = useId();
  const location = position ?? (desktop ? "sidebar" : "feed");
  const campaign =
    campaigns.filter((item) => (!campaignId || item.id === campaignId) &&
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
          if (campaign.durationSeconds) {
            const expire=()=>{if(disposed)return;if(informationOpen.current){timer=setTimeout(expire,250);return;}setVisible(false);};
            timer=setTimeout(expire,campaign.durationSeconds*1000);
          }
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
          position === "forum" ? styles.forumPlacement : position ? styles.pagePlacement : desktop ? styles.desktop : styles.feed
      }
    >
      {admitted ? <AdDisplayConfirmation campaign={campaign} onDenied={() => setVisible(false)} /> : null}
        <ImageAd campaign={campaign} forum={position === "forum"} />
        <AdDisclosureControls disclosure={disclosureFor(campaign)} onOpenChange={informationChanged} displayDetails={[...(campaign.displayDetails ?? []),
          {label:"This display",value:"Placement: "+location+"; slot "+(slotIndex+1)+"; delay "+campaign.delaySeconds+" seconds; duration "+(campaign.durationSeconds ? campaign.durationSeconds+" seconds" : "until the page or placement closes")+"."},
          ...(forumPostIndex === undefined ? [] : [{label:"Forum placement",value:"After post "+forumPostIndex+"; configured interval "+(campaign.forumEvery ?? 6)+" posts. "+(forumAfterPost ? "This is an explicit after-post slot." : "The forum interval rule selected this slot.")}]),
        ]} />
    </aside>
  );
}
export function ForumCampaignSlot({ postIndex, afterPost = false }: { postIndex: number; afterPost?: boolean }) {
  const { campaigns }=useContext(Context);
  const campaign=forumCampaignAt(campaigns,postIndex,afterPost);
  return campaign ? <ExploreAdSlot position="forum" campaignId={campaign.id} forumPostIndex={postIndex} forumAfterPost={afterPost}/> : null;
}

type AdvertisingProps = {children:ReactNode;audience?:CampaignAudience;enabled?:boolean;viewerId?:string|null};
export function ExploreAdvertising(props:AdvertisingProps) {
  const actor = props.viewerId ?? null;
  return <ExploreAdvertisingContent key={JSON.stringify([actor,props.audience ?? "guest"])} {...props}/>;
}
function ExploreAdvertisingContent({
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
  const [deliveryScope,setDeliveryScope] = useState("");
  const selectionScope = JSON.stringify([pathname,audience,device]);
  const selectionCurrent = deliveryScope === selectionScope;
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
  const admissions = useRef(new Map<string,AdSelectionDisclosure>());
  const informationOpen = useRef(new Set<string>());
  const popupInformation=useCallback((open:boolean)=>{if(open)informationOpen.current.add("popup");else informationOpen.current.delete("popup");},[]);
  const tickerInformation=useCallback((open:boolean)=>{if(open)informationOpen.current.add("ticker");else informationOpen.current.delete("ticker");},[]);
  const disclosureFor=useCallback((campaign:Campaign)=>admissions.current.get(`${pathname}:${campaign.id}`),[pathname]);
  const visit = useRef<AbortController | null>(null);
  const record = useCallback(
    (campaign: Campaign, event: "view" | "shown" | "click") => {
      const key = `${pathname}:${campaign.id}:${event}`;
      const previous = recorded.current.get(key);
      if (previous) return previous;
      if(event==="view"&&!campaign.adDisclosure)return Promise.resolve(false);
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
          disclosureProof:event === "view" ? campaign.adDisclosure?.proof : undefined,
        }),
        keepalive: true,
        signal: event === "click" ? undefined : visit.current?.signal,
      })
        .then((result) => {
          const disclosure=result.admissionDisclosure as AdSelectionDisclosure|undefined;
          if (event === "view" && result.allowed && result.reservation && disclosure?.kind==="platform_campaign" && disclosure.selectionId===campaign.adDisclosure?.selectionId && disclosure.reportScope===campaign.adDisclosure?.reportScope && typeof disclosure.proof==="string") {
            reservations.current.set(`${pathname}:${campaign.id}`, result.reservation);
            admissions.current.set(`${pathname}:${campaign.id}`,disclosure);
          }
          return result.allowed === true && (event !== "view" || Boolean(result.reservation && admissions.current.has(`${pathname}:${campaign.id}`)));
        })
        .catch(() => false);
      recorded.current.set(key, promise);
      return promise;
    },
    [pathname, device],
  );
  const [popup, setPopup] = useState<Campaign | null>(null);
  useTransientOverlay(() => setPopup(null), Boolean(popup));
  const [ticker, setTicker] = useState<Campaign | null>(null);
  const navigation = useAdNavigation(record);
  useEffect(() => {
    if (!active || !device) return;
    feedClaims.current.clear();
    recorded.current.clear();
    reservations.current.clear();
    admissions.current.clear();
    informationOpen.current.clear();
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const expirations=new Set<ReturnType<typeof setTimeout>>();
    const expireAfter=(campaign:Campaign,set:(value:Campaign|null)=>void)=>{
      const scheduleExpiry=(delay:number)=>{const timer=setTimeout(()=>{expirations.delete(timer);if(cancelled)return;if(informationOpen.current.has(campaign.kind))scheduleExpiry(250);else set(null);},delay);expirations.add(timer);};
      scheduleExpiry(campaign.durationSeconds*1000);
    };
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
          set({...campaign,adDisclosure:disclosureFor(campaign)});
          if (campaign.durationSeconds) expireAfter(campaign,set);
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
        setDeliveryScope(selectionScope);
        const eligible = data.campaigns.filter((campaign) =>
          campaignMatches(campaign, pathname, audience, device),
        );
        const shuffled = shuffleCampaigns(
          eligible.filter((c) => c.kind === "placement"),
        );
        const first = select(shuffled, "placement");
        setPlacement(
          first ? [first, ...shuffled.filter((c) => c.id !== first.id).map(c => ({...c,displayDetails:[{label:"Placement rotation",value:"Eligible placement promotions were randomly shuffled; the first slot also avoids the previously selected promotion when alternatives exist."}]}))] : [],
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
                displayDetails:[...(announcement.displayDetails ?? []),{label:"This display",value:"Ticker; "+(device === "mobile" ? "top (mobile layout)" : announcement.position)+"; delay "+announcementDelay+" seconds; duration "+(announcement.durationSeconds || "until closed")+"; animation cycle "+announcement.speedSeconds+" seconds."}],
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
              setPopup({...selected,adDisclosure:disclosureFor(selected),displayDetails:[...(selected.displayDetails ?? []),{label:"This display",value:"Popup; effective delay "+Math.max(selected.delaySeconds,announcement ? announcementDelay+8 : 0)+" seconds; trigger "+(selected.popupTrigger === "scroll" ? "scroll at least "+(selected.scrollPercent ?? 35)+"%" : "delay")+"; duration "+(selected.durationSeconds || "until closed")+". The page had to be visible, unobstructed by another dialog, and outside a text-entry interaction."}]});
              if (selected.durationSeconds)
                expireAfter(selected,setPopup);
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
      expirations.forEach(clearTimeout);
      listeners.forEach((remove) => remove());
      setPopup(null);
      setTicker(null);
      setPlacement([]);
    };
  }, [active, pathname, audience, device, record, selectionScope,disclosureFor]);
  useEffect(() => {
    if (!popup) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("dialog[open]")) setPopup(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popup]);
  const contextValue = useMemo(() => ({ campaigns: active && selectionCurrent ? placement : [], claimFeed, record,disclosureFor }), [active, selectionCurrent, placement, claimFeed, record,disclosureFor]);
  return (
    <Context.Provider
      value={contextValue}
    >
      <NavigationProgress pending={navigation.pending} />
      <div
        className={
          active && selectionCurrent && ticker
            ? ticker.position === "top"
              ? styles.topReserve
              : styles.bottomReserve
            : undefined
        }
      >
        {children}
      </div>
      {active && selectionCurrent && ticker
        ? createPortal(
            <div
              className={`${styles.ticker} ${ticker.position === "top" ? styles.top : styles.bottom}`}
              style={{ background: ticker.background, color: ticker.color, height:44, paddingRight:ticker.closeButton ? 44 : 8 }}
            >
              <AdDisplayConfirmation campaign={ticker} onDenied={() => setTicker(null)} />
              <div style={{overflow:"hidden",flex:"1 1 0",minWidth:0}}>{ticker.href ? (
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
              )}</div>
              <AdDisclosureControls disclosure={ticker.adDisclosure} displayDetails={ticker.displayDetails} onOpenChange={tickerInformation}/>
              {ticker.closeButton ? (
                <button
                  aria-label={__vt("Close announcement")}
                  onClick={() => setTicker(null)}
                  style={{height:44,width:44}}
                >
                  ×
                </button>
              ) : null}
            </div>,
            document.body,
          )
        : null}
      {active && selectionCurrent && popup
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
                <AdDisclosureControls disclosure={popup.adDisclosure} displayDetails={popup.displayDetails} onOpenChange={popupInformation}/>
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

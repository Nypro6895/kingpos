"use client";
import {CheckWriterPanel} from "./check-writer-panel";
import {openMarketPayment} from "@/lib/open-market-payment";
import {BookSmsPanel} from "./booksms-panel";
import type {BookSmsState} from "@/types/booksms";
import { TaxCompanyMarketPanel } from "./tax-company-panel";
import { setServiceRelayPlugin } from "@/app/service-relay/actions";
import { BookingDepositPanel } from "./booking-deposit-panel";
import type { BookingDepositState } from "@/types/booking-deposit";
import { BookingPolicyPanel } from "./booking-policy-panel";
import type { BookingPolicyState } from "@/types/booking-policy";

import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import { checkinReceiptPaymentAction } from "./checkin-receipt-actions";
import type { CheckinReceiptSubscription } from "@/types/checkin-receipt";
import { setCampaignPluginAction } from "@/app/campaigns/credit-actions";
import { formatCredits } from "@/lib/campaign-credit-display";
import { useRouter } from "next/navigation";
import { setPayrollDataPlugin } from "./plugin-actions";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invalidateExperienceResources } from "@/lib/experience-resource-cache";
import { useRememberedExperience } from "@/lib/use-remembered-experience";
import { clearExperienceState } from "@/lib/experience-state";
import { rankMarketApps } from "@/lib/market-ranking";
import { sampleApps, type MarketApp } from "./sample-apps";
import { CardCheckoutPanel as BankCheckoutPanel } from "./card-checkout-panel";
import type { MarketBankBillingState } from "@/types/market-bank-billing";
import { marketAppsWithBankPricing } from "@/lib/market-catalog-view";
import styles from "./market.module.css";
import { CampaignPreview } from "./campaign-preview";
import { VietnamesePreview } from "./vietnamese-preview";
import { TaxCompanyPreview } from "./tax-company-preview";
import { AppLogo } from "./app-logo";
import Image from "next/image";
import { ContactSupportForm } from "../(legal)/contact-support/contact-form";
import { VietnamesePluginPanel } from "./vietnamese-plugin-panel";
import { EMPTY_VIETNAMESE_PLUGIN, type VietnamesePluginState } from "@/types/vietnamese-plugin";
import { takeMarketStartupDraft, MARKET_CATEGORIES, type MarketBrowse } from "./market-browse";

const categories = MARKET_CATEGORIES;
const browseResetEvents = ["reylumi:experience-reset", "reylumi:app-local-reset", "reylumi:app-local-access-changed", "reylumi:experience-access-changed", "reylumi:offline-clear"];

type MarketExperience = { query: string; category: string; view: "discover" | "my-apps" };
function isMarketExperience(value: unknown): value is MarketExperience {
  if (!value || typeof value !== "object") return false;
  const state = value as MarketExperience;
  return typeof state.query === "string" && state.query.length <= 200
    && categories.some(category => category === state.category)
    && (state.view === "discover" || state.view === "my-apps");
}

export function MarketClient({ checkWriter = {active:false,subscribed:false}, automaticTax, cardReady = false, booksms, experienceScope, taxCompany = { active: false, subscribed: false }, bankBillingState, paymentsAvailable = true, paymentReturn, serviceRelayInstalled = false, bookingDeposit, bookingPolicy = { active: false, subscribed: false, content: "", published: false }, installationCounts = {}, checkinReceipt = { active: false, subscribed: false }, vietnameseState = EMPTY_VIETNAMESE_PLUGIN, vietnamesePublished = true, payrollDownloadInstalled = false, pluginLoadError = "", campaignInstalled = false, initialBrowse }: { checkWriter?: {active:boolean;subscribed:boolean;installed?:boolean;operationalReady?:boolean}; automaticTax?: {enabled:boolean;price_behavior:'inclusive'|'exclusive'}; cardReady?: boolean; booksms?:BookSmsState; experienceScope?: string; taxCompany?: { active: boolean; subscribed: boolean }; bankBillingState?: MarketBankBillingState; paymentsAvailable?: boolean; paymentReturn?: "received" | "cancelled"; serviceRelayInstalled?: boolean; bookingDeposit?: BookingDepositState; bookingPolicy?: BookingPolicyState; installationCounts?: Record<string, number>; checkinReceipt?: CheckinReceiptSubscription; vietnameseState?: VietnamesePluginState; vietnamesePublished?: boolean; campaignInstalled?: boolean; payrollDownloadInstalled?: boolean; pluginLoadError?: string; initialBrowse?: MarketBrowse }) {
  const __vt = useWorkspaceTranslation();

  const router = useRouter();
  const [bankBilling, setBankBilling] = useState(bankBillingState);
  const [bankSource, setBankSource] = useState(bankBillingState);
  if (bankSource !== bankBillingState) { setBankSource(bankBillingState); setBankBilling(bankBillingState); }
  const bankCheckout = Boolean(bankBilling && bankBilling.settings.version > 0);
  const apps = bankCheckout && bankBilling ? marketAppsWithBankPricing(sampleApps, bankBilling.catalog) : sampleApps;
  const [relayAdded, setRelayAdded] = useState(serviceRelayInstalled);
  const [campaignAdded,setCampaignAdded] = useState(campaignInstalled);
  const [vietnamese, setVietnamese] = useState(vietnameseState);
  const [vietnameseSource, setVietnameseSource] = useState(vietnameseState);
  if (vietnameseSource !== vietnameseState) { setVietnameseSource(vietnameseState); setVietnamese(vietnameseState); }
  const [query, setQuery] = useState(initialBrowse?.query ?? "");
  const [category, setCategory] = useState<string>(initialBrowse?.category ?? "All features");
  const [view, setView] = useState<"discover" | "my-apps">("discover");
  const browseRestorationFinished = useRef(false);
  const startupDraftTaken = useRef(false);
  const browseKey = JSON.stringify(initialBrowse ?? null);
  const [browseSource, setBrowseSource] = useState({ scope: experienceScope, key: browseKey });
  const previousBrowseScope = useRef(experienceScope);
  if (browseSource.scope !== experienceScope || browseSource.key !== browseKey) {
    setBrowseSource({ scope: experienceScope, key: browseKey });
    // An unscoped startup can hand its input to its first authorized view.
    // A previous account/workspace cannot seed the next account's search.
    if (browseSource.scope !== experienceScope && browseSource.scope !== undefined || browseSource.key !== browseKey && initialBrowse) {
      setQuery(initialBrowse?.query ?? ""); setCategory(initialBrowse?.category ?? "All features"); setView("discover");
    }
  }
  useLayoutEffect(() => {
    if (previousBrowseScope.current !== experienceScope && previousBrowseScope.current !== undefined) {
      browseRestorationFinished.current = false; startupDraftTaken.current = false;
    }
    previousBrowseScope.current = experienceScope;
  }, [experienceScope]);
  const searchInput = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (startupDraftTaken.current) return;
    startupDraftTaken.current = true;
    const draft = takeMarketStartupDraft(experienceScope);
    if (!draft) return;
    browseRestorationFinished.current = true;
    // The replaced public shell owns this external input; restore it before the new view paints.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(draft.browse.query);
    setCategory(draft.browse.category);
    const frame = requestAnimationFrame(() => {
      const input = searchInput.current;
      if (input && draft.focused && (document.activeElement === document.body || document.activeElement === input)) {
        input.focus({ preventScroll: true });
        if (draft.selectionStart !== null && draft.selectionEnd !== null) input.setSelectionRange(draft.selectionStart, draft.selectionEnd);
      }
    });
    return () => { cancelAnimationFrame(frame); };
  }, [experienceScope]);
  useRememberedExperience({ namespace: "market", scope: experienceScope ?? "unscoped", key: "browse" }, {
    enabled: Boolean(experienceScope) && !paymentReturn,
    restoreOnVisit: true,
    value: { query: query.slice(0, 200), category, view },
    validate: isMarketExperience,
    onEmpty() {
      if (browseRestorationFinished.current) return;
      browseRestorationFinished.current = true;
      if (initialBrowse) return;
      setQuery(""); setCategory("All features"); setView("discover");
    },
    onRestore(state) {
      // Persisted UI seeds a new mount; Activity already retains the more recent React state.
      if (browseRestorationFinished.current) return;
      browseRestorationFinished.current = true;
      if (initialBrowse) return;
      setQuery(state.query); setCategory(state.category); setView(state.view);
    },
  });
  useEffect(() => {
    const reset = () => {
      clearExperienceState({ namespace: "market" });
      browseRestorationFinished.current = true; startupDraftTaken.current = true;
      setQuery(""); setCategory("All features"); setView("discover");
    };
    for (const event of browseResetEvents) window.addEventListener(event, reset);
    return () => { for (const event of browseResetEvents) window.removeEventListener(event, reset); };
  }, []);
  const [installed, setInstalled] = useState(payrollDownloadInstalled);
  const [installationSource, setInstallationSource] = useState({ serviceRelayInstalled, campaignInstalled, payrollDownloadInstalled });
  if (installationSource.serviceRelayInstalled !== serviceRelayInstalled || installationSource.campaignInstalled !== campaignInstalled || installationSource.payrollDownloadInstalled !== payrollDownloadInstalled) {
    setInstallationSource({ serviceRelayInstalled, campaignInstalled, payrollDownloadInstalled });
    setRelayAdded(serviceRelayInstalled); setCampaignAdded(campaignInstalled); setInstalled(payrollDownloadInstalled);
  }
  const [pluginBusy, setPluginBusy] = useState(false);
  const [pluginMessage, setPluginMessage] = useState(pluginLoadError);
  const added = [...(checkWriter.active || checkWriter.subscribed || checkWriter.installed ? ["print-check"] : []),...(booksms?.installed?["booksms"]:[]),...(taxCompany.active || taxCompany.subscribed ? ["tax-company"] : []),...(relayAdded ? ["service-relay"] : []),...(bookingDeposit?.installed || bookingDeposit?.subscribed ? ["booking-deposit"] : []),...(bookingPolicy.active || bookingPolicy.subscribed ? ["booking-policy"] : []),...(checkinReceipt.active || checkinReceipt.subscribed ? ["checkin-receipt"] : []),...(installed ? ["payroll-data-download"] : []),...(campaignAdded ? ["campaigns"] : []), ...(vietnamese.installed || vietnamese.has_subscription ? ["vietnamese-language"] : [])];
  const [comingSoon, setComingSoon] = useState(false);
  const [selectedApp, setSelected] = useState<MarketApp | null>(null);
  const selected = selectedApp ? apps.find(app => app.id === selectedApp.id) ?? selectedApp : null;
  const [developer, setDeveloper] = useState(false);

  const dialog = useRef<HTMLDialogElement>(null);
  const open = Boolean(selected || developer);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if(query.get('activate')==='print-check'){
      const frame=requestAnimationFrame(()=>{const item=sampleApps.find(app=>app.id==='print-check');if(item)setSelected(item);});
      return ()=>cancelAnimationFrame(frame);
    }
    if (query.get("activate") !== "campaigns" || query.get("returnTo") !== "campaigns") return;
    const frame = requestAnimationFrame(() => {
      if (campaignInstalled) { router.replace("/campaigns"); return; }
      const campaign = sampleApps.find(app => app.id === "campaigns");
      if (campaign) setSelected(campaign);
    });
    return () => cancelAnimationFrame(frame);
  }, [campaignInstalled, router]);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);

  function close() { setSelected(null); setDeveloper(false); setComingSoon(false); }
  function openFeature(app: MarketApp) {
    if (app.id === "booking-deposit") { router.push("/market/booking-deposit"); return; }
    setSelected(app);
  }
  useLayoutEffect(() => () => { setSelected(null); setDeveloper(false); setComingSoon(false); setPluginMessage(""); dialog.current?.close(); }, []);
  function marketChanged() {
    invalidateExperienceResources({ scope: experienceScope, tags: ["market", "catalog", "settings"] });
    window.dispatchEvent(new Event("reylumi:market-changed"));
  }
  async function requestFeature() {
    if (selected?.id === "service-relay") {
      setPluginBusy(true); setPluginMessage("");
      try { const result = await setServiceRelayPlugin(!relayAdded); if (result.error) setPluginMessage(result.error); else { setRelayAdded(Boolean(result.installed)); setPluginMessage(result.installed ? "Added. Staff can receive customers in My Work; service tickets appear in POS." : "Removed. Existing tickets can still be settled at POS."); marketChanged(); router.refresh(); } }
      catch { setPluginMessage("Could not update Phone Checkin."); }
      finally { setPluginBusy(false); }
      return;
    }
    if (selected?.id === "checkin-receipt") {
      setPluginBusy(true); setPluginMessage("");
      try {
        const result = await checkinReceiptPaymentAction(checkinReceipt.subscribed);
        if (result.error) setPluginMessage(result.error);
        else if (result.url) openMarketPayment(result.url);
      } catch { setPluginMessage("Checkout could not open. Please retry."); }
      finally { setPluginBusy(false); }
      return;
    }
    if (selected?.id === "campaigns") {
      setPluginBusy(true);setPluginMessage("");
      try { const result = await setCampaignPluginAction(!campaignAdded); if(result.error)setPluginMessage(result.error);else{setCampaignAdded(Boolean(result.installed));setPluginMessage(result.installed ? `Campaigns added. ${formatCredits(result.credits??0)} credits are ready to use.` : "Campaigns removed. Your credits and results are kept; adding again does not grant another welcome gift.");marketChanged();const query=new URLSearchParams(window.location.search);if(result.installed&&query.get("returnTo")==="campaigns"){router.push("/campaigns");}else router.refresh();} } catch {setPluginMessage("Campaigns could not be updated. Please try again.");} finally {setPluginBusy(false);}return;
    }
    if (selected?.id !== "payroll-data-download") { setComingSoon(true); return; }
    setPluginBusy(true); setPluginMessage("");
    try {
      const result = await setPayrollDataPlugin(!installed);
      if (result.error) setPluginMessage(result.error);
      else { setInstalled(Boolean(result.installed)); setPluginMessage(result.installed ? "Added. Open Owner → Payroll and scroll to Download." : "Removed. Download is now hidden."); marketChanged(); }
    } catch { setPluginMessage("Could not update this feature. Please try again."); }
    finally { setPluginBusy(false); }
  }

  const visible = rankMarketApps(apps, installationCounts).filter(app =>
    (!bankCheckout || !bankBilling?.hidden_plugin_ids?.includes(app.id) || added.includes(app.id)) &&
    (!bankCheckout || !["tax-company", "booking-deposit", "booking-policy", "checkin-receipt", "vietnamese-language"].includes(app.id) || bankBilling?.catalog.some(plan => plan.plugin_id === app.id && plan.published) || added.includes(app.id)) &&
    (bankCheckout || app.id !== "vietnamese-language" || vietnamesePublished || vietnamese.installed) &&
    (view === "discover" || added.includes(app.id)) &&
    (category === "All features" || category === app.category) &&
    `${app.name} ${app.category} ${app.summary}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return <main className={styles.page}>
    <div className={styles.container}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}><WorkspaceText text="MORE FEATURES FOR REYLUMI" /></span><h1><WorkspaceText text="Market" /></h1><p><WorkspaceText text="Add the features your salon needs, right inside Reylumi." /></p></div>

      </header>
      {paymentReturn && <p role="status" className={styles.previewNote}>{paymentReturn === "received" ? "Checkout completed. Payment confirmation may take a moment. Access starts only after the payment is verified; refresh Market to check your subscription." : "You left checkout. No new plugin access was granted. You can reopen the plugin to continue."}</p>}
      <section className={styles.hero} aria-labelledby="market-feature-title">
        <div><span className={styles.eyebrow}><WorkspaceText text="YOUR REYLUMI. MORE POSSIBILITIES." /></span><h2 id="market-feature-title"><WorkspaceText text="Add more features" /><br /><WorkspaceText text="to Reylumi." /></h2><p><WorkspaceText text="Bring messaging, rewards, payroll tools and more into your Reylumi workspace. Choose what helps your salon—no separate app download." /></p><button className={styles.primary} onClick={() => setSelected(sampleApps[0])}><WorkspaceText text="See Payroll Data Download" /> <span aria-hidden="true">→</span></button></div>
        <div className={styles.heroIllustration}><Image src="/market/reylumi-features.webp" alt={__vt("A salon owner adding messaging, gifts and payroll features to one Reylumi workspace")} width={840} height={560} priority /></div>
      </section>
      {bankCheckout ? <p className={styles.previewNote}>{bankBilling?.settings.enabled && bankBilling.settings.ready ? "Pay for a plugin by bank transfer using your order's reference. Access starts after the payment is verified. Each monthly period is a separate order; no automatic debit." : "Bank checkout is not enabled yet. Free features, drafts and existing subscription management remain available."}</p> : !paymentsAvailable && <p className={styles.previewNote}>Payment checkout is currently unavailable. Free plugins and existing subscription management remain available.</p>}
      <nav className={styles.tabs} aria-label={__vt("Market views")}><button aria-current={view === "discover" ? "page" : undefined} onClick={() => { browseRestorationFinished.current = true; setView("discover"); }}><WorkspaceText text="Discover" /></button><button aria-current={view === "my-apps" ? "page" : undefined} onClick={() => { browseRestorationFinished.current = true; setView("my-apps"); }}><WorkspaceText text="My features" /> <span>{added.length}</span></button></nav>
      <div className={styles.toolbar}><div className={styles.filters} aria-label={__vt("Feature categories")}>{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => { browseRestorationFinished.current = true; setCategory(item); }}>{item}</button>)}</div><label className={styles.search}><span aria-hidden="true">⌕</span><input ref={searchInput} aria-label={__vt("Search features")} placeholder={__vt("Search features…")} value={query} onChange={event => { browseRestorationFinished.current = true; setQuery(event.target.value); }} />{query && <button aria-label={__vt("Clear search")} onClick={() => setQuery("")}>×</button>}</label></div>
      <div className={styles.sectionHeading}><h2>{view === "discover" ? <WorkspaceText text="Choose what to add to Reylumi" /> : <WorkspaceText text="Your features" />}</h2><span aria-live="polite">{visible.length} <WorkspaceText text={visible.length === 1 ? "feature" : "features"} /></span></div>
      <div className={styles.grid}>{visible.map(app => <article className={styles.card} key={app.id}><div className={styles.cardTop}><AppLogo app={app} /><span className={styles.category}>{app.category}</span></div><h3><button onClick={() => openFeature(app)}>{app.name}</button></h3><span className={styles.publisher}><WorkspaceText text="By" /> {app.publisher}</span><p>{app.summary}</p><div className={styles.cardBenefits}>{app.features.slice(0, 2).map(feature => <span key={feature}>✓ {feature}</span>)}</div><div className={styles.priceLine}><strong>{app.price}</strong><span>{app.trial}</span></div><div className={styles.cardBottom}><span><WorkspaceText text={added.includes(app.id) ? "Added to your salon" : "Per salon · USD"} /></span><button aria-label={__vt(`View ${app.name}`)} onClick={() => openFeature(app)}><WorkspaceText text="View feature" /> <span aria-hidden="true">→</span></button></div></article>)}</div>
      {!visible.length && <div className={styles.empty}><h3><WorkspaceText text={view === "my-apps" && !added.length ? "Your next connection starts here" : "No features match these filters"} /></h3><p><WorkspaceText text={view === "my-apps" && !added.length ? "Discover features to add to your Reylumi workspace." : "Try another category or a different search."} /></p><button className={styles.secondary} onClick={() => { setQuery(""); setCategory("All features"); setView("discover"); }}><WorkspaceText text="Browse all features" /></button></div>}
      <section className={styles.developer}><div><span className={styles.eyebrow}><WorkspaceText text="BUILD WITH REYLUMI" /></span><h2><WorkspaceText text="Have an idea that helps salons?" /></h2><p><WorkspaceText text="A future home for developers, useful integrations and thoughtful tools." /></p></div><button className={styles.secondary} onClick={() => setDeveloper(true)}><WorkspaceText text="For developers →" /></button></section>
      <dialog className={`${styles.dialog} ${selected && !comingSoon ? styles.featureDialog : ""}`} ref={dialog} onCancel={close} onClose={close} aria-labelledby="market-dialog-title"><button className={styles.close} aria-label={__vt("Close details")} onClick={close}>×</button>{comingSoon ? <><span className={styles.eyebrow}><WorkspaceText text="COMING SOON" /></span><h2 id="market-dialog-title"><WorkspaceText text="Thanks for your interest!" /></h2><p><WorkspaceText text={selected?.name ?? "This feature"} /> <WorkspaceText text="is still in development. Please check back later. Thank you for your interest." /></p><button className={styles.primary} onClick={close}><WorkspaceText text="Got it" /></button></> : selected ? <><AppLogo app={selected} /><span className={styles.eyebrow}>{selected.category} <WorkspaceText text="· Reylumi add-on" /></span><h2 id="market-dialog-title">{selected.name}</h2><span className={styles.publisher}><WorkspaceText text="By" /> {selected.publisher}</span>{bankCheckout && bankBilling?.catalog.some(item => item.plugin_id === selected.id && !item.fulfillment_ready) && <p className={styles.previewNote}>Preview · This plugin is being prepared. Bank payment and activation become available after its integration is ready.</p>}{selected.id === "campaigns" ? <CampaignPreview /> : selected.id === "vietnamese-language" ? <VietnamesePreview /> : selected.id === "tax-company" ? <TaxCompanyPreview /> : <Image src={selected.id!=="booksms" && sampleApps.some(app => app.id === selected.id) ? `/market/features/${selected.id}.svg` : "/market/reylumi-features.webp"} alt={__vt(sampleApps.some(app => app.id === selected.id) ? `${selected.name} interface in the Reylumi salon workspace` : "Reylumi Market preview")} width={900} height={560} className={styles.detailImage} />}<p className={styles.detailIntro}>{selected.description}</p><p className={styles.insideReylumi}><WorkspaceText text={selected.id === "tax-company" ? "Tax professionals use the separate Tax Company app with their personal Reylumi account." : selected.id === "payroll-data-download" ? "Free, built by Reylumi. No separate app or provider account. Added features apply to your current salon." : "Adds features to your Reylumi workspace. No separate app download. Some features may require connecting a provider account when available."} /></p><div className={styles.workflowPreview}><span className={styles.eyebrow}><WorkspaceText text="A DAY WITH" /> {selected.name.toUpperCase()}</span><ol>{selected.workflow?.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol></div><h3><WorkspaceText text="Designed to help with" /></h3><ul>{selected.features.map(feature => <li key={feature}>{feature}</li>)}</ul><h3>{["payroll-data-download","campaigns"].includes(selected.id) ? <WorkspaceText text="Free feature" /> : <WorkspaceText text="Choose a plan" />} <span className={styles.conceptLabel}><WorkspaceText text="USD" /></span></h3><p>{selected.trial}</p><div className={styles.plans}>{selected.plans?.map(plan => <div className={styles.plan} key={plan.name}><span>{plan.name}</span><strong>{plan.price}</strong><p>{plan.detail}</p></div>)}</div><h3><WorkspaceText text="Access needed" /></h3><ul>{selected.permissions.map(permission => <li key={permission}>{permission}</li>)}</ul>{bankCheckout && bankBilling && ["print-check", "booksms", "tax-company", "booking-deposit", "booking-policy", "checkin-receipt", "vietnamese-language"].includes(selected.id) && <BankCheckoutPanel automaticTax={automaticTax} key={selected.id} ready={cardReady && (selected.id!=="print-check" || checkWriter.operationalReady===true)} pluginId={selected.id} pluginName={selected.name} billingState={bankBilling} hasActiveSubscription={selected.id === "print-check" ? checkWriter.active || checkWriter.subscribed : selected.id === "booksms" ? false : selected.id === "tax-company" ? taxCompany.subscribed : selected.id === "booking-deposit" ? Boolean(bookingDeposit?.subscribed) : selected.id === "booking-policy" ? bookingPolicy.subscribed : selected.id === "checkin-receipt" ? checkinReceipt.subscribed : vietnamese.has_subscription} onStateChange={setBankBilling} />} {selected.id === "print-check" ? <CheckWriterPanel state={checkWriter}/> : selected.id === "booksms" ? <BookSmsPanel initial={booksms} plannedLimit={bankBilling?.catalog.find(item=>item.plugin_id==="booksms")?.monthly_sms_limit}/> : selected.id === "tax-company" ? <TaxCompanyMarketPanel state={taxCompany} bankCheckout={bankCheckout} paymentsAvailable={paymentsAvailable} /> : selected.id === "booking-deposit" ? <BookingDepositPanel key={`deposit-${bookingDeposit?.active}-${bookingDeposit?.subscribed}-${bookingDeposit?.testMode}`} initial={bookingDeposit} paymentsAvailable={paymentsAvailable} bankCheckout={bankCheckout} monthlyPrice={selected.price} /> : selected.id === "booking-policy" ? <BookingPolicyPanel key={selected.id} state={bookingPolicy} paymentsAvailable={paymentsAvailable} bankCheckout={bankCheckout} monthlyPrice={selected.price} /> : selected.id === "vietnamese-language" ? <VietnamesePluginPanel key={`vietnamese-${vietnamese.paid_until}-${vietnamese.active}-${vietnamese.has_subscription}`} initialState={vietnamese} onChange={setVietnamese} paymentsAvailable={paymentsAvailable} bankCheckout={bankCheckout} monthlyPrice={selected.price} /> : <>{selected.id === "checkin-receipt" && <p>{checkinReceipt.active ? checkinReceipt.subscribed ? "Paid access is active. Manage your existing subscription to control renewal." : "Bank-paid access is active for the verified service period. There is no automatic renewal." : checkinReceipt.subscribed ? "Payment needs attention. Open Manage subscription to review your invoice or payment method." : "Subscribe to activate Check-in Receipt for this salon."}</p>}<p role="status"><WorkspaceText text={pluginMessage} /></p>{!(selected.id === "checkin-receipt" && bankCheckout && !checkinReceipt.subscribed) && <button className={styles.primary} disabled={pluginBusy || (selected.id === "checkin-receipt" && !checkinReceipt.subscribed && (!paymentsAvailable || checkinReceipt.active))} onClick={requestFeature}>{pluginBusy ? <WorkspaceText text="Updating…" /> : selected.id === "checkin-receipt" ? (checkinReceipt.subscribed ? "Manage subscription" : "Subscribe · $4.70 / month") : added.includes(selected.id) ? <WorkspaceText text="Remove from Reylumi" /> : <WorkspaceText text={selected.available ? "Add to Reylumi" : "View availability"} />}</button>}{selected.id === "campaigns" && campaignAdded ? <a className={styles.secondary} href="/campaigns"><WorkspaceText text="Open Campaigns →" /></a> : null}{selected.id === "payroll-data-download" && installed ? <a className={styles.secondary} href="/payroll?tab=download"><WorkspaceText text="Open Payroll → Download" /></a> : null}</>}</> : <><span className={styles.eyebrow}><WorkspaceText text="BUILD WITH REYLUMI" /></span><h2 id="market-dialog-title"><WorkspaceText text="Build something salons will love." /></h2><p><WorkspaceText text="The developer platform is being prepared. Create features that fit into the Reylumi workspace." /></p><ol className={styles.steps}><li><strong><WorkspaceText text="Create your app" /></strong><span><WorkspaceText text="App profile, publisher details and test environment." /></span></li><li><strong><WorkspaceText text="Connect with permission" /></strong><span><WorkspaceText text="Scoped access approved by the salon." /></span></li><li><strong><WorkspaceText text="Test, then publish" /></strong><span><WorkspaceText text="Sandbox testing and a reviewed Market listing." /></span></li></ol><p className={styles.previewNote}><WorkspaceText text="Developer registration, credentials and publishing are not available yet." /></p><section className={styles.developerContact} aria-label={__vt("Developer contact form")}><h3><WorkspaceText text="Tell us about your idea" /></h3><p><WorkspaceText text="Interested in building with Reylumi? Share your idea or ask our team a question." /></p><ContactSupportForm /></section><button className={styles.secondary} onClick={close}><WorkspaceText text="Back to Market" /></button></>}</dialog>
    </div>
  </main>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { sampleApps, type MarketApp } from "./sample-apps";
import styles from "./market.module.css";
import { AppLogo } from "./app-logo";
import Image from "next/image";

const categories = ["All features", "Customer care", "Payroll", "Payments", "Operations", "Marketing", "Commerce", "Reporting"] as const;

export function MarketClient() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All features");
  const [view, setView] = useState<"discover" | "my-apps">("discover");
  const [added, setAdded] = useState<string[]>([]);
  const [selected, setSelected] = useState<MarketApp | null>(null);
  const [developer, setDeveloper] = useState(false);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const open = Boolean(selected || developer);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);

  function close() { setSelected(null); setDeveloper(false); }
  function toggleApp(app: MarketApp) {
    const removing = added.includes(app.id);
    setAdded(current => removing ? current.filter(id => id !== app.id) : [...current, app.id]);
    setNotice(`${app.name} ${removing ? "removed from" : "added to"} this preview. This is a feature preview; no salon data was connected.`);
    close();
  }

  const visible = sampleApps.filter(app =>
    (view === "discover" || added.includes(app.id)) &&
    (category === "All features" || category === app.category) &&
    `${app.name} ${app.category} ${app.summary}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return <main className={styles.page}>
    <div className={styles.container}>
      <header className={styles.header}>
        <div><span className={styles.eyebrow}>MORE FEATURES FOR REYLUMI</span><h1>Market <span className={styles.badge}>Preview</span></h1><p>Add the features your salon needs, right inside Reylumi.</p></div>

      </header>
      <section className={styles.hero} aria-labelledby="market-feature-title">
        <div><span className={styles.eyebrow}>YOUR REYLUMI. MORE POSSIBILITIES.</span><h2 id="market-feature-title">Add more features<br />to Reylumi.</h2><p>Bring messaging, rewards, payroll tools and more into your Reylumi workspace. Choose what helps your salon—no separate app download.</p><button className={styles.primary} onClick={() => setSelected(sampleApps[0])}>See Print Check features <span aria-hidden="true">→</span></button></div>
        <div className={styles.heroIllustration}><Image src="/market/reylumi-features.webp" alt="A salon owner adding messaging, gifts and payroll features to one Reylumi workspace" width={840} height={560} priority /></div>
      </section>
      <p className={styles.previewNote}>Sample catalog · Planned add-on features and fictional providers. Prices in USD are proposed examples, not live offers. Adding a feature only changes this preview and resets when you leave or reload.</p>
      <nav className={styles.tabs} aria-label="Market views"><button aria-current={view === "discover" ? "page" : undefined} onClick={() => setView("discover")}>Discover</button><button aria-current={view === "my-apps" ? "page" : undefined} onClick={() => setView("my-apps")}>My features <span>{added.length}</span></button></nav>
      <div className={styles.toolbar}><div className={styles.filters} aria-label="Feature categories">{categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div><label className={styles.search}><span aria-hidden="true">⌕</span><input aria-label="Search features" placeholder="Search features…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Clear search" onClick={() => setQuery("")}>×</button>}</label></div>
      <div className={styles.sectionHeading}><h2>{view === "discover" ? "Choose what to add to Reylumi" : "Your preview features"}</h2><span aria-live="polite">{visible.length} {visible.length === 1 ? "feature" : "features"}</span></div>
      <p className={styles.status} role="status">{notice}</p>
      <div className={styles.grid}>{visible.map(app => <article className={styles.card} key={app.id}><div className={styles.cardTop}><AppLogo app={app} /><span className={styles.category}>{app.category}</span></div><h3><button onClick={() => setSelected(app)}>{app.name}</button></h3><span className={styles.publisher}>By {app.publisher} <span className={styles.conceptLabel}>Sample feature</span></span><p>{app.summary}</p><div className={styles.cardBenefits}>{app.features.slice(0, 2).map(feature => <span key={feature}>✓ {feature}</span>)}</div><div className={styles.priceLine}><strong>{app.price}</strong><span>{app.trial}</span></div><div className={styles.cardBottom}><span>{added.includes(app.id) ? "Added in preview" : "Per salon · Proposed pricing"}</span><button aria-label={`View ${app.name}`} onClick={() => setSelected(app)}>View feature <span aria-hidden="true">→</span></button></div></article>)}</div>
      {!visible.length && <div className={styles.empty}><h3>{view === "my-apps" && !added.length ? "Your next connection starts here" : "No features match these filters"}</h3><p>{view === "my-apps" && !added.length ? "Choose a sample feature and preview adding it to your Reylumi workspace." : "Try another category or a different search."}</p><button className={styles.secondary} onClick={() => { setQuery(""); setCategory("All features"); setView("discover"); }}>Browse all features</button></div>}
      <section className={styles.developer}><div><span className={styles.eyebrow}>BUILD WITH REYLUMI</span><h2>Have an idea that helps salons?</h2><p>A future home for developers, useful integrations and thoughtful tools.</p></div><button className={styles.secondary} onClick={() => setDeveloper(true)}>Explore developer preview →</button></section>
      <dialog className={styles.dialog} ref={dialog} onCancel={close} onClose={close} aria-labelledby="market-dialog-title"><button className={styles.close} aria-label="Close details" onClick={close}>×</button>{selected ? <><AppLogo app={selected} /><span className={styles.eyebrow}>{selected.category} · Reylumi add-on preview</span><h2 id="market-dialog-title">{selected.name}</h2><span className={styles.publisher}>By {selected.publisher} · Fictional publisher</span><p className={styles.detailIntro}>{selected.description}</p><p className={styles.insideReylumi}>Adds features to your Reylumi workspace. No separate app download. Some features may require connecting a provider account when available.</p><div className={styles.workflowPreview}><span className={styles.eyebrow}>A DAY WITH {selected.name.toUpperCase()}</span><ol>{selected.workflow?.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol></div><h3>Designed to help with</h3><ul>{selected.features.map(feature => <li key={feature}>{feature}</li>)}</ul><h3>Choose a plan <span className={styles.conceptLabel}>Sample pricing · USD</span></h3><p> {selected.trial}. No payment details or charges in this preview.</p><div className={styles.plans}>{selected.plans?.map(plan => <div className={styles.plan} key={plan.name}><span>{plan.name}</span><strong>{plan.price}</strong><p>{plan.detail}</p></div>)}</div><h3>Proposed access</h3><ul>{selected.permissions.map(permission => <li key={permission}>{permission}</li>)}</ul><p className={styles.previewNote}>No permissions are granted in this preview. All features, trial periods and prices are concepts for a future release, not availability commitments. This preview does not activate a feature or collect payment.</p><button className={styles.primary} onClick={() => toggleApp(selected)}>{added.includes(selected.id) ? "Remove from preview" : "Add to Reylumi · Preview"}</button></> : <><span className={styles.eyebrow}>DEVELOPER PREVIEW</span><h2 id="market-dialog-title">Build something salons will love.</h2><p>The developer platform is being prepared. This preview shows where your apps will eventually live.</p><ol className={styles.steps}><li><strong>Create your app</strong><span>App profile, publisher details and test environment.</span></li><li><strong>Connect with permission</strong><span>Scoped access approved by the salon.</span></li><li><strong>Test, then publish</strong><span>Sandbox testing and a reviewed Market listing.</span></li></ol><p className={styles.previewNote}>Developer registration, credentials and publishing are not available yet.</p><button className={styles.secondary} onClick={close}>Back to Market</button></>}</dialog>
    </div>
  </main>;
}

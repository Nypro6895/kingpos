"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { APP_LOCAL_HELP_GUIDES, APP_LOCAL_HELP_QUICK_STARTS, APP_LOCAL_SUPPORT_INSTRUCTIONS, getAppLocalHelpGuide } from "@/lib/app-local-reference-content";
import { searchHelpGuides } from "@/lib/help-search";
import { translateHelp, helpHref, type HelpLanguage } from "@/lib/help-language";
import type { HelpGuide, HelpRole } from "@/lib/help-guides";
import { useRememberedExperience } from "@/lib/use-remembered-experience";
import { clearExperienceState } from "@/lib/experience-state";
import { getExperienceDeviceGeneration } from "@/lib/experience-persistent-cache";
import styles from "@/app/help/help.module.css";

type Props = { slug?: string; language?: HelpLanguage; support?: boolean; experienceScope?: string; navigate: (href: string) => void };
const browseResetEvents = ["reylumi:experience-reset", "reylumi:app-local-reset", "reylumi:app-local-access-changed", "reylumi:experience-access-changed", "reylumi:offline-clear"];
type Browse = { query: string; role: HelpRole | "all" };
function isBrowse(value: unknown): value is Browse {
  if (!value || typeof value !== "object") return false;
  const state = value as Browse;
  return typeof state.query === "string" && state.query.length <= 200 && ["all", "customer", "owner", "staff"].includes(state.role);
}
/** Complete public guides work without Next routing, private DTOs or a network. */
export function AppLocalHelp({ slug, language = "en", support = false, experienceScope, navigate }: Props) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<HelpRole | "all">("all");
  const scope = experienceScope ?? `public:${getExperienceDeviceGeneration()}`;
  const [browseOwner, setBrowseOwner] = useState(scope);
  const restored = useRef<string | null>(null);
  if (browseOwner !== scope) { setBrowseOwner(scope); setQuery(""); setRole("all"); }
  useRememberedExperience({ namespace: "help", scope, key: "catalog-search" }, {
    enabled: !support, restoreOnVisit: true,
    value: { query: query.slice(0, 200), role }, validate: isBrowse,
    onRestore(value) { if (restored.current !== scope) { restored.current = scope; setQuery(value.query); setRole(value.role); } },
    onEmpty() { restored.current = scope; },
  });
  useEffect(() => {
    const reset = () => { clearExperienceState({ namespace: "help" }); restored.current = scope; setQuery(""); setRole("all"); };
    for (const event of browseResetEvents) window.addEventListener(event, reset);
    return () => { for (const event of browseResetEvents) window.removeEventListener(event, reset); };
  }, [scope]);
  const t = (text: string) => translateHelp(text, language);
  const link = (href: string, children: ReactNode, className?: string) => <a href={helpHref(href, language)} className={className} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || href.startsWith("#")) return;
    event.preventDefault(); navigate(helpHref(href, language));
  }}>{children}</a>;
  const languages = <div className={styles.languages} role="group" aria-label={t("Help language")}>{(["en", "vi"] as const).map(value => <button key={value} type="button" lang={value} aria-pressed={language === value} onClick={() => navigate(helpHref(slug ? `/help/${slug}` : "/help", value))}>{value === "en" ? "English" : "Tiếng Việt"}</button>)}</div>;
  if (support) return <main lang={language} className={styles.shell}><h1>{t(APP_LOCAL_SUPPORT_INSTRUCTIONS.title)}</h1><p>{t(APP_LOCAL_SUPPORT_INSTRUCTIONS.introduction)}</p>{APP_LOCAL_SUPPORT_INSTRUCTIONS.sections.map(section => <section key={section.href} className={styles.section}><h2>{t(section.title)}</h2><p>{t(section.body)}</p>{link(section.href, t(section.title))}</section>)}<p>{t(APP_LOCAL_SUPPORT_INSTRUCTIONS.confirmation)}</p></main>;
  if (!slug) {
    const matches = searchHelpGuides(query, role);
    return <main lang={language} className={styles.shell}>{languages}<header className={styles.hero}><h1>{t("Reylumi Help")}</h1><p>{t("Follow the guides in order, or jump to the task you need.")}</p></header>
      <section className={styles.section}><h2>{t("Choose a quick start")}</h2><div className={styles.roles}>{APP_LOCAL_HELP_QUICK_STARTS.map(item => <section key={item.id} className={styles.card}><h3>{t(item.title)}</h3><p>{t(item.summary)}</p><ol>{item.slugs.map(id => { const guide = getAppLocalHelpGuide(id, language); return guide ? <li key={id}>{link(`/help/${id}`, guide.title)}</li> : null; })}</ol></section>)}</div></section>
      <section className={styles.section}><h2>{t("All guides")}</h2><div role="search" className={styles.search}><label htmlFor="app-local-help-search">{t("Search the guides")}</label><input id="app-local-help-search" type="search" value={query} onChange={event => { restored.current = scope; setQuery(event.target.value.slice(0, 200)); }} /></div>
        <div className={styles.filters} role="group" aria-label={t("Filter by role")}>{(["all", "customer", "owner", "staff"] as const).map(value => <button key={value} type="button" aria-pressed={role === value} onClick={() => setRole(value)}>{t(({ all: "All roles", customer: "Customers", owner: "Salon owners", staff: "Staff members" })[value])}</button>)}</div>
        <p role="status">{t("Guides found")}: {matches.length}</p><ol className={styles.catalog} id="help-results">{matches.map((item, index) => { const guide = getAppLocalHelpGuide(item.slug, language)!; return <li key={guide.slug}>{link(`/help/${guide.slug}`, <><span className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><div className={styles.guideCopy}><strong className={styles.guideTitle}>{guide.title}</strong><span className={styles.summary}>{guide.summary}</span></div><span aria-hidden="true">→</span></>, styles.catalogLink)}</li>; })}</ol>
        {!matches.length ? <p>{t("No matching guides. Try a shorter phrase or another role.")}</p> : null}{query || role !== "all" ? <button type="button" onClick={() => { setQuery(""); setRole("all"); }}>{t("Reset search")}</button> : null}
      </section><p>{link("/support", t("Contact support"))}</p></main>;
  }
  const guide = getAppLocalHelpGuide(slug, language);
  if (!guide) return <main lang={language} className={styles.shell}><h1>{t("Reylumi Help")}</h1>{link("/help", t("Back to all guides"))}</main>;
  const image = (screen: HelpGuide["evidence"]["screenshots"][number]) => <figure key={screen.id} className={styles.figure}><picture><source media="(max-width: 720px)" srcSet={screen.mobile.src} width={screen.mobile.width} height={screen.mobile.height} /><img src={screen.desktop.src} width={screen.desktop.width} height={screen.desktop.height} alt={screen.alt} loading="lazy" /></picture><figcaption><span>{t("Illustration")}</span><strong>{screen.caption}</strong><span>{link(screen.desktop.src, t("View full desktop image"))} · {link(screen.mobile.src, t("View full mobile image"))}</span></figcaption></figure>;
  const inline = new Set(guide.sections.flatMap(section => section.illustrationId ? [section.illustrationId] : []));
  const next = APP_LOCAL_HELP_GUIDES[APP_LOCAL_HELP_GUIDES.findIndex(item => item.slug === slug) + 1];
  return <main lang={language} className={styles.shell}>{languages}{link("/help", `← ${t("Back to all guides")}`, styles.back)}<header className={styles.hero}><h1>{guide.title}</h1><p>{guide.summary}</p></header>
    <nav aria-label={t("Guide contents")} className={styles.contents}>{link("#before-start", t("Before you start"))}{link("#steps", t("Step by step"))}{link("#walkthroughs", t("Detailed walkthroughs"))}</nav>
    <section id="before-start" className={styles.prerequisite}><h2>{t("Before you start")}</h2><p>{guide.prerequisite}</p>{link(guide.entry.href, guide.entry.label)}</section>
    <section id="steps" className={styles.section}><h2>{t("Step by step")}</h2><ol className={styles.steps}>{guide.steps.map((step, index) => <li key={step.title}><span className={styles.stepNumber} aria-hidden="true">{index + 1}</span><div><h3>{step.title}</h3><p>{step.body}</p></div></li>)}</ol></section>
    <section id="walkthroughs" className={styles.section}><h2>{t("Detailed walkthroughs")}</h2><nav className={styles.sectionLinks} aria-label={t("Article sections")}>{guide.sections.map(section => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}</nav>{guide.sections.map(section => <section id={section.id} key={section.id} className={styles.walkthrough}><h3>{section.title}</h3><ol>{section.steps.map(step => <li key={step}>{step}</li>)}</ol>{section.illustrationId ? guide.evidence.screenshots.filter(screen => screen.id === section.illustrationId).map(image) : null}<p className={styles.result}><strong>{t("Check the result")}: </strong>{section.check}</p><p className={styles.example}><strong>{t("Example")}: </strong>{section.example}</p><details className={styles.details}><summary>{t("If something goes wrong")}</summary><ul>{section.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details></section>)}</section>
    {guide.notes.length ? <details className={styles.details}><summary>{t("Details and common questions")}</summary><ul>{guide.notes.map(note => <li key={note}>{note}</li>)}</ul></details> : null}{guide.evidence.screenshots.filter(screen => !inline.has(screen.id)).map(image)}
    <footer className={styles.articleFooter}><p>{link("/support", t("Contact support"))}</p>{next ? <p>{t("Continue learning")}: {link(`/help/${next.slug}`, t(next.title))}</p> : null}</footer></main>;
}

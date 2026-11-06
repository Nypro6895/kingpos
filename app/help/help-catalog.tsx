"use client";
import { useSearchParams, usePathname } from "next/navigation";
import { HelpLink, HelpText, useHelpTranslation } from "./help-language";
import { HELP_GROUPS, type HelpRole } from "@/lib/help-guides";
import { searchHelpGuides } from "@/lib/help-search";
import styles from "./help.module.css";

const roles: {id: HelpRole | "all"; label: string}[] = [
  {id:"all",label:"All"}, {id:"customer",label:"Customers"},
  {id:"owner",label:"Owners"}, {id:"staff",label:"Staff"},
];
export function HelpCatalog() {
  const t = useHelpTranslation();
  const params = useSearchParams();
  const pathname = usePathname();
  const query = params.get("q") ?? "";
  const role = roles.find(item => item.id === params.get("role"))?.id ?? "all";
  const matches = searchHelpGuides(query, role);
  function update(values: {q?: string; role?: string}) {
    const next = new URLSearchParams(params.toString());
    for (const [key,value] of Object.entries(values)) {
      if (value && value !== "all") next.set(key,value); else next.delete(key);
    }
    window.history.replaceState(null,"",`${pathname}${next.size ? `?${next}` : ""}`);
  }
  return <section className={styles.catalogSection} aria-label={t("Guides")}>
    <div className={styles.search} role="search" aria-label={t("Search guides")}>
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>
      <input id="help-search" type="search" value={query} aria-label={t("Search guides")} placeholder={t("Search guides")} onChange={event => update({q:event.target.value})} aria-controls="help-results" />
    </div>
    <div className={styles.filters} role="group" aria-label={t("Filter by role")}>
      {roles.map(item => <button type="button" key={item.id} aria-pressed={role === item.id} onClick={() => update({role:item.id})}><HelpText text={item.label}/></button>)}
    </div>
    <div className={styles.resultsBar}>
      <p className={styles.resultCount} role="status" aria-live="polite" aria-atomic="true">{matches.length} <HelpText text="Guides"/></p>
      {query || role !== "all" ? <button type="button" className={styles.reset} onClick={() => update({q:"",role:"all"})}><HelpText text="Show all guides"/></button> : null}
      {!query && role === "all" ? <select className={styles.topicSelect} aria-label={t("Choose a topic")} value="" onChange={event => {
        const heading = document.getElementById(`topic-${event.target.value}`);
        heading?.scrollIntoView({block:"start"}); heading?.focus({preventScroll:true});
      }}><option value="">{t("Topics")}</option>{HELP_GROUPS.map(group => <option key={group.id} value={group.id}>{t(group.title)}</option>)}</select> : null}
    </div>
    <div id="help-results">{HELP_GROUPS.map(group => {
      const guides = group.slugs.flatMap(slug => matches.filter(guide => guide.slug === slug));
      if (!guides.length) return null;
      return <section key={group.id} className={styles.topic} aria-labelledby={`topic-${group.id}`}>
        <h2 id={`topic-${group.id}`} tabIndex={-1}><HelpText text={group.title}/></h2>
        <ul className={styles.catalog}>{guides.map(guide => <li key={guide.slug}>
          <HelpLink href={`/help/${guide.slug}`} prefetch={false} className={styles.catalogLink}>
            <span className={styles.guideMark} aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 4h11a3 3 0 0 1 3 3v14H8a3 3 0 0 1-3-3V4Zm0 13h14M9 8h6M9 11h5"/></svg></span>
            <div className={styles.guideCopy}><span className={styles.guideTitle}><HelpText text={guide.title}/></span><span className={styles.summary}><HelpText text={guide.summary}/></span></div>
            <span className={styles.chevron} aria-hidden="true">›</span>
          </HelpLink>
        </li>)}</ul>
      </section>;
    })}</div>
    {!matches.length ? <div className={styles.empty}><h2><HelpText text="No guides found"/></h2><p><HelpText text="Try another search or show all guides."/></p><HelpLink href="/support?from=%2Fhelp" prefetch={false}><HelpText text="Contact support"/></HelpLink></div> : null}
  </section>;
}

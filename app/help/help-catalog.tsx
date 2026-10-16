"use client";
import Link from "next/link";
import { useState } from "react";
import { HelpText as WorkspaceText, translateHelp } from "./help-language";
import { type HelpRole } from "@/lib/help-guides";
import { searchHelpGuides } from "@/lib/help-search";
import styles from "./help.module.css";
const roles: {id: HelpRole | "all"; label: string}[] = [
  {id: "all", label: "All roles"}, {id: "customer", label: "Customers"},
  {id: "owner", label: "Salon owners"}, {id: "staff", label: "Staff members"},
];
export function HelpCatalog() {
  const t = translateHelp;
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<HelpRole | "all">("all");
  const matches = searchHelpGuides(query, role);
  return <section className={styles.section} aria-labelledby="all-guides-heading">
    <h2 id="all-guides-heading"><WorkspaceText text="All guides" /></h2>
    <div className={styles.search} role="search" aria-label={t("Search the guides")}>
      <label htmlFor="help-search"><WorkspaceText text="Search the guides" /></label>
      <input id="help-search" type="search" value={query} placeholder={t("Search by task or feature")} onChange={event => setQuery(event.target.value)} aria-controls="help-results" />
    </div>
    <div className={styles.filters} role="group" aria-label={t("Filter by role")}>
      {roles.map(item => <button type="button" key={item.id} aria-pressed={role === item.id} onClick={() => setRole(item.id)}><WorkspaceText text={item.label} /></button>)}
    </div>
    <p className={styles.resultCount} role="status" aria-live="polite" aria-atomic="true"><WorkspaceText text="Guides found" />: {matches.length}</p>
    <ol className={styles.catalog} id="help-results">{matches.map((guide, index) => <li key={guide.slug}>
      <Link href={`/help/${guide.slug}`} prefetch={false} className={styles.catalogLink}>
        <span className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <span><span className={styles.guideTitle}><WorkspaceText text={guide.title} /></span><span className={styles.summary}><WorkspaceText text={guide.summary} /></span></span>
        <span aria-hidden="true">→</span>
      </Link>
    </li>)}</ol>
    {!matches.length ? <p className={styles.empty}><WorkspaceText text="No matching guides. Try a shorter phrase or another role." /></p> : null}
    {query || role !== "all" ? <button type="button" className={styles.reset} onClick={() => {setQuery(""); setRole("all");}}><WorkspaceText text="Reset search" /></button> : null}
  </section>;
}

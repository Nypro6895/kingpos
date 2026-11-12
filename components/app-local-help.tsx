"use client";

import { useEffect, useRef, useState } from "react";
import { APP_LOCAL_SUPPORT_INSTRUCTIONS, getAppLocalHelpGuide } from "@/lib/app-local-reference-content";
import { translateHelp, type HelpLanguage } from "@/lib/help-language";
import type { HelpRole } from "@/lib/help-guides";
import { useRememberedExperience } from "@/lib/use-remembered-experience";
import { clearExperienceState } from "@/lib/experience-state";
import { getExperienceDeviceGeneration } from "@/lib/experience-persistent-cache";
import styles from "@/app/help/help.module.css";
import {HelpHomeView,HelpArticleView} from "@/app/help/help-view";
import {HelpViewProvider,HelpLink,helpBrowseHref,type HelpAnchorProps} from "@/app/help/help-view-context";

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
  const t=(text:string)=>translateHelp(text,language);
  function renderLink(props:HelpAnchorProps){
    const attributes={...props};delete attributes.prefetch;
    return <a {...attributes} onClick={event=>{
      props.onClick?.(event);
      if(event.defaultPrevented||event.button||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||props.href.startsWith("#")||props.target==="_blank"||props.download)return;
      event.preventDefault();navigate(props.href);
    }}/>;
  }
  const guide=slug?getAppLocalHelpGuide(slug,language):null;
  return <HelpViewProvider language={language} query={query} role={role} update={values=>{restored.current=scope;if(values.query!==undefined)setQuery(values.query.slice(0,200));if(values.role!==undefined)setRole(values.role);}} selectLanguage={next=>navigate(helpBrowseHref(slug?`/help/${slug}`:"/help",next,{query,role}))} renderLink={renderLink}>
    <main lang={language} className={styles.shell}>
      {support?<><h1>{t(APP_LOCAL_SUPPORT_INSTRUCTIONS.title)}</h1><p>{t(APP_LOCAL_SUPPORT_INSTRUCTIONS.introduction)}</p>{APP_LOCAL_SUPPORT_INSTRUCTIONS.sections.map(section=><section key={section.href} className={styles.section}><h2>{t(section.title)}</h2><p>{t(section.body)}</p><HelpLink href={section.href}>{t(section.title)}</HelpLink></section>)}<p>{t(APP_LOCAL_SUPPORT_INSTRUCTIONS.confirmation)}</p></>:!slug?<HelpHomeView/>:guide?<HelpArticleView guide={guide}/>:<><h1>{t("Help")}</h1><HelpLink href="/help">{t("Back to Help")}</HelpLink></>}
    </main>
  </HelpViewProvider>;
}

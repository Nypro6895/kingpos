"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, createElement, useContext, type ComponentProps, type ReactNode } from "react";
import { helpHref, translateHelp, type HelpLanguage } from "@/lib/help-language";
import styles from "./help.module.css";
const LanguageContext = createContext<HelpLanguage>("vi");
export function useHelpLanguage() { return useContext(LanguageContext); }
export function useHelpTranslation() {
  const language = useHelpLanguage();
  return (text: string) => translateHelp(text, language);
}
// Help language belongs to this URL, never the workspace or account setting.
export function HelpShell({ language, children }: { language: HelpLanguage; children: ReactNode }) {
  return <LanguageContext.Provider value={language}><main lang={language} className={styles.shell}><HelpLanguageSwitcher />{children}</main></LanguageContext.Provider>;
}
function HelpLanguageSwitcher() {
  const language = useHelpLanguage(), t = useHelpTranslation();
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  function select(next: HelpLanguage) {
    const query = new URLSearchParams(params.toString());
    query.set("lang", next);
    router.replace(pathname + "?" + query.toString() + window.location.hash, { scroll: false });
  }
  return <div className={styles.languages} role="group" aria-label={t("Help language")}>
    <span>{t("Help language")}</span>
    <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => select("en")}>English</button>
    <button type="button" lang="vi" aria-pressed={language === "vi"} onClick={() => select("vi")}>Tiếng Việt</button>
  </div>;
}
export function HelpText({ text }: { text: string }) { return useHelpTranslation()(text); }
export function HelpElement({ as, ...props }: { as: "img" | "nav"; [key: string]: unknown }) {
  const t = useHelpTranslation();
  for (const key of ["alt", "title", "aria-label"]) if (typeof props[key] === "string") props[key] = t(props[key]);
  return createElement(as, props);
}
export function HelpLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  return <Link {...props} href={helpHref(href, useHelpLanguage())} />;
}

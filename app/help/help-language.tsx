"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, createElement, useContext, type ComponentProps, type ReactNode } from "react";
import { translateHelp, resolveHelpLanguage, type HelpLanguage } from "@/lib/help-language";
export { translateHelp } from "@/lib/help-language";
import styles from "./help.module.css";

const HelpLanguageContext = createContext<HelpLanguage>("en");
export function useHelpLanguage() { return useContext(HelpLanguageContext); }
export function useHelpTranslation() {
  const language = useContext(HelpLanguageContext);
  return (text: string) => translateHelp(text, language);
}
export function HelpRoot({ children, className, language: initialLanguage }: { children: ReactNode; className: string; language?: HelpLanguage }) {
  const searchParams = useSearchParams();
  // Plain Help links always open in English, regardless of workspace or old storage.
  const language = initialLanguage ?? resolveHelpLanguage(searchParams.getAll("lang").length === 1 ? searchParams.get("lang") : undefined);
  return <HelpLanguageContext.Provider value={language}>
    <main lang={language} className={className}>
      {children}
    </main>
  </HelpLanguageContext.Provider>;
}
export function HelpLanguageSelector() {
  const language = useContext(HelpLanguageContext);
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const t = useHelpTranslation();
  function select(next: HelpLanguage) {
    const query = new URLSearchParams(params.toString());
    if (next === "vi") query.set("lang", "vi"); else query.delete("lang");
    router.replace(`${pathname}${query.size ? `?${query}` : ""}${window.location.hash}`, {scroll:false});
  }
  return <div className={styles.languageSelector} role="group" aria-label={t("Guide language")}>
    <button type="button" lang="en" aria-label="English" aria-pressed={language === "en"} onClick={() => select("en")}>EN</button>
    <button type="button" lang="vi" aria-label="Tiếng Việt" aria-pressed={language === "vi"} onClick={() => select("vi")}>VI</button>
  </div>;
}
export function HelpLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const language = useContext(HelpLanguageContext);
  const params = useSearchParams();
  const url = new URL(href, "https://reylumi.com");
  if (url.pathname === "/help" || url.pathname.startsWith("/help/")) {
    if (language === "vi") url.searchParams.set("lang", "vi");
    for (const key of ["q", "role"]) if (params.has(key)) url.searchParams.set(key, params.get(key)!);
  }
  return <Link {...props} href={`${url.pathname}${url.search}${url.hash}`} />;
}
export function HelpText({ text }: { text: string }) {
  return useHelpTranslation()(text);
}
export function HelpElement({ as, ...props }: { as: "img" | "nav"; [key: string]: unknown }) {
  const t = useHelpTranslation();
  const attributes = { ...props };
  for (const key of ["alt", "title", "aria-label"]) {
    if (typeof attributes[key] === "string") attributes[key] = t(attributes[key]);
  }
  return createElement(as, attributes);
}

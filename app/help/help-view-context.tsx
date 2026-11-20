"use client";
import { createContext, createElement, useContext, type ComponentProps, type ReactNode } from "react";
import { helpHref, translateHelp, type HelpLanguage } from "@/lib/help-language";
import type { HelpRole } from "@/lib/help-guides";
import styles from "./help.module.css";

export type HelpBrowse = {query: string; role: HelpRole | "all"};
export type HelpAnchorProps = Omit<ComponentProps<"a">,"href"> & {href: string; prefetch?: boolean};
type HelpView = HelpBrowse & {
  language: HelpLanguage;
  update: (values: Partial<HelpBrowse>) => void;
  selectLanguage: (language: HelpLanguage) => void;
  renderLink: (props: HelpAnchorProps) => ReactNode;
};
function BasicLink(props: HelpAnchorProps) { const attributes={...props};delete attributes.prefetch;return <a {...attributes}/>; }
const HelpViewContext = createContext<HelpView>({language:"en",query:"",role:"all",update:()=>{},selectLanguage:()=>{},renderLink:props=><BasicLink {...props}/>});
export function HelpViewProvider({children,...value}: HelpView & {children: ReactNode}) { return <HelpViewContext.Provider value={value}>{children}</HelpViewContext.Provider>; }
export function useHelpLanguage() { return useContext(HelpViewContext).language; }
export function useHelpBrowse() { return useContext(HelpViewContext); }
export function useHelpTranslation() { const {language}=useContext(HelpViewContext); return (text:string)=>translateHelp(text,language); }
export function helpBrowseHref(href:string,language:HelpLanguage,{query,role}:HelpBrowse) {
  if (!/^\/help(?:[/?#]|$)/.test(href)) return href;
  const url=new URL(helpHref(href,language),"https://reylumi.com");
  if(query)url.searchParams.set("q",query.slice(0,200));
  if(role!=="all")url.searchParams.set("role",role);
  return url.pathname+url.search+url.hash;
}
export function HelpLink({href,...props}:HelpAnchorProps) {
  const context=useContext(HelpViewContext);
  return context.renderLink({...props,href:helpBrowseHref(href,context.language,context)});
}
export function HelpLanguageSelector() {
  const {language,selectLanguage}=useContext(HelpViewContext),t=useHelpTranslation();
  return <div className={styles.languageSelector} role="group" aria-label={t("Guide language")}>
    <button type="button" lang="en" aria-label="English" aria-pressed={language==="en"} onClick={()=>selectLanguage("en")}>EN</button>
    <button type="button" lang="vi" aria-label="Tiếng Việt" aria-pressed={language==="vi"} onClick={()=>selectLanguage("vi")}>VI</button>
  </div>;
}
export function HelpText({text}:{text:string}) { return useHelpTranslation()(text); }
export function HelpElement({as,...props}:{as:"img"|"nav";[key:string]:unknown}) {
  const t=useHelpTranslation(),attributes={...props};
  for(const key of ["alt","title","aria-label"])if(typeof attributes[key]==="string")attributes[key]=t(attributes[key]);
  return createElement(as,attributes);
}

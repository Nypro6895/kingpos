"use client";
import Link from "next/link";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import type {ReactNode} from "react";
import {resolveHelpLanguage,type HelpLanguage} from "@/lib/help-language";
import type {HelpRole} from "@/lib/help-guides";
import {HelpViewProvider,type HelpAnchorProps,type HelpBrowse} from "./help-view-context";
export {HelpText,HelpElement,HelpLink,HelpLanguageSelector,useHelpLanguage,useHelpTranslation} from "./help-view-context";
export {translateHelp} from "@/lib/help-language";
const renderLink=(props:HelpAnchorProps)=><Link {...props}/>;
export function HelpRoot({children,className,language:initialLanguage}:{children:ReactNode;className:string;language?:HelpLanguage}) {
  const params=useSearchParams(),pathname=usePathname(),router=useRouter();
  const language=initialLanguage??resolveHelpLanguage(params.getAll("lang").length===1?params.get("lang"):undefined);
  const query=params.get("q")??"";
  const candidate=params.get("role");
  const role:HelpRole|"all"=candidate==="customer"||candidate==="owner"||candidate==="staff"?candidate:"all";
  function update(values:Partial<HelpBrowse>){
    const next=new URLSearchParams(params.toString());
    for(const [field,value] of Object.entries(values)){
      const key=field==="query"?"q":field;
      if(value&&value!=="all")next.set(key,value.slice(0,200));else next.delete(key);
    }
    window.history.replaceState(null,"",`${pathname}${next.size?`?${next}`:""}`);
  }
  function selectLanguage(next:HelpLanguage){
    const query=new URLSearchParams(params.toString());
    if(next==="vi")query.set("lang","vi");else query.delete("lang");
    router.replace(`${pathname}${query.size?`?${query}`:""}${window.location.hash}`,{scroll:false});
  }
  return <HelpViewProvider language={language} query={query} role={role} update={update} selectLanguage={selectLanguage} renderLink={renderLink}><main lang={language} className={className}>{children}</main></HelpViewProvider>;
}

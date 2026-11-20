import Link from "next/link";
import {HelpRoot,HelpText} from "./help-language";
import {HelpHomeView,HelpArticleView} from "./help-view";
import {isHelpAvailable} from "@/lib/help-draft";
import type {HelpLanguage} from "@/lib/help-language";
import type {HelpGuide} from "@/lib/help-guides";
import styles from "./help.module.css";
export function HelpSupportEntry(){if(!isHelpAvailable())return null;return <p className="mb-6 text-sm"><Link href="/help" prefetch={false} className={styles.supportLink}><HelpText text="Browse the Help guides"/></Link></p>;}
export function HelpHome({language}:{language?:HelpLanguage}={}){return <HelpRoot language={language} className={styles.shell}><HelpHomeView/></HelpRoot>;}
export function HelpArticle({guide,language}:{guide:HelpGuide;language?:HelpLanguage}){return <HelpRoot language={language} className={styles.shell}><HelpArticleView guide={guide}/></HelpRoot>;}

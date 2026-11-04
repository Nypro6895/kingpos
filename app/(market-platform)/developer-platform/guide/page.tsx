import {Suspense} from "react";
import {DeveloperPortal} from "../sections";
import {GuideContent} from "./content";
import styles from "../platform.module.css";
export const metadata={title:"Developer integration guide | Reylumi",robots:{index:false,follow:false}};
async function Content({searchParams}:{searchParams:Promise<{lang?:string}>}) {
  const query=await searchParams;
  return <DeveloperPortal initialLanguage={query.lang==="vi"?"vi":"en"}><main className={styles.page}><GuideContent /></main></DeveloperPortal>;
}
export default function GuidePage({searchParams}:{searchParams:Promise<{lang?:string}>}) {
  return <Suspense fallback={<main className={styles.page}><h1>Developer guide</h1><p>Loading…</p></main>}><Content searchParams={searchParams}/></Suspense>;
}

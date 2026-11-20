import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { DeveloperPortal, DeveloperLanguagePicker, DeveloperText } from "../../sections";
import { DeveloperRecoveryGuide } from "../../recovery-guide";
import styles from "../../platform.module.css";

export const metadata = { title: "Developer review & recovery | Reylumi" };
type Query = Promise<{ lang?: string }>;
async function GuideContent({ searchParams }: { searchParams: Query }) {
  await connection();
  const query = await searchParams;
  return <DeveloperPortal initialPanel="developer" initialLanguage={query.lang === "vi" ? "vi" : "en"}><main className={styles.page}><header><Link href="/developer-platform/guide"><DeveloperText text="Introduction & integration guide" /></Link><h1><DeveloperText text="Review, resubmit and recover" /></h1><DeveloperLanguagePicker /><p><DeveloperText text="Clear next steps for rejected versions, uncertain requests and support." /></p></header><DeveloperRecoveryGuide /></main></DeveloperPortal>;
}
export default function RecoveryGuide({ searchParams }: { searchParams: Query }) { return <Suspense fallback={<main className={styles.page}>Loading guide…</main>}><GuideContent searchParams={searchParams} /></Suspense>; }

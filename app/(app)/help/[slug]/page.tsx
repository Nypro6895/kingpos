import type { Metadata } from "next";
import { resolveHelpLanguage, translateHelp } from "@/lib/help-language";
import { notFound } from "next/navigation";
import { withExperiencePage } from "@/components/experience-page";
import { HelpArticle } from "@/app/help/help-content";
import { findHelpGuide } from "@/lib/help-guides";
import { isHelpAvailable } from "@/lib/help-draft";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const guide = findHelpGuide(slug), language = resolveHelpLanguage(query.lang);
  return { title: translateHelp(guide?.title ?? "Reylumi Help", language) + " | Reylumi", robots: { index: true, follow: true } };
}

async function HelpGuidePage({ params, searchParams }: Props) {
  if (!isHelpAvailable()) notFound();
  const { slug } = await params;
  const guide = findHelpGuide(slug);
  if (!guide) notFound();
  return <HelpArticle guide={guide} language={resolveHelpLanguage((await searchParams).lang)} />;
}

export default withExperiencePage(HelpGuidePage);

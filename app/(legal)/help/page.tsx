import type { Metadata } from "next";
import { resolveHelpLanguage, translateHelp } from "@/lib/help-language";
import { notFound } from "next/navigation";
import { withExperiencePage } from "@/components/experience-page";
import { HelpHome } from "@/app/help/help-content";
import { isHelpAvailable } from "@/lib/help-draft";

type Props = { searchParams: Promise<{ lang?: string | string[] }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const language = resolveHelpLanguage((await searchParams).lang);
  return { title: translateHelp("Reylumi Help", language), robots: { index: true, follow: true } };
}

async function HelpPage({ searchParams }: Props) {
  if (!isHelpAvailable()) notFound();
  return <HelpHome language={resolveHelpLanguage((await searchParams).lang)} />;
}

export default withExperiencePage(HelpPage);

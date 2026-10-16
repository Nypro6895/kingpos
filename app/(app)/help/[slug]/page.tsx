import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withExperiencePage } from "@/components/experience-page";
import { HelpArticle } from "@/app/help/help-content";
import { findHelpGuide } from "@/lib/help-guides";
import { isHelpAvailable } from "@/lib/help-draft";

export const metadata: Metadata = {
  title: "Hướng dẫn sử dụng | Reylumi",
  robots: { index: true, follow: true },
};

async function HelpGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isHelpAvailable()) notFound();
  const { slug } = await params;
  const guide = findHelpGuide(slug);
  if (!guide) notFound();
  return <HelpArticle guide={guide} />;
}

export default withExperiencePage(HelpGuidePage);

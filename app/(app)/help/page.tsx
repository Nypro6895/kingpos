import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { withExperiencePage } from "@/components/experience-page";
import { HelpHome } from "@/app/help/help-content";
import { isHelpAvailable } from "@/lib/help-draft";

export const metadata: Metadata = {
  title: "Hướng dẫn | Reylumi",
  robots: { index: true, follow: true },
};

async function HelpPage() {
  if (!isHelpAvailable()) notFound();
  return <HelpHome />;
}

export default withExperiencePage(HelpPage);

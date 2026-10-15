import { withExperiencePage } from "@/components/experience-page";
import { LegalHub } from "@/app/legal/legal-components";
import { legalMetadata } from "@/lib/legal-policies";
import type { Metadata } from "next";

export const metadata: Metadata = legalMetadata({
  description:
    "ReyLUMI legal hub for terms, privacy, community standards, and business policies.",
  path: "/legal",
  title: "Legal & Policies",
});

function LegalPage() {
  return <LegalHub />;
}

export default withExperiencePage(LegalPage);

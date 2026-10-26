import { withExperiencePage } from "@/components/experience-page";
import { LegalDocumentPage } from "@/app/legal/legal-components";
import { legalDocuments, legalMetadata } from "@/lib/legal-policies";
import type { Metadata } from "next";

export const metadata: Metadata = legalMetadata({
  description: legalDocuments.community.description,
  path: legalDocuments.community.href,
  title: legalDocuments.community.title,
});

function CommunityPage() {
  return <LegalDocumentPage document={legalDocuments.community} />;
}

export default withExperiencePage(CommunityPage);

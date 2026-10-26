import { withExperiencePage } from "@/components/experience-page";
import { LegalDocumentPage } from "@/app/legal/legal-components";
import { legalDocuments, legalMetadata } from "@/lib/legal-policies";
import type { Metadata } from "next";

export const metadata: Metadata = legalMetadata({
  description: legalDocuments.business.description,
  path: legalDocuments.business.href,
  title: legalDocuments.business.title,
});

function BusinessTermsPage() {
  return <LegalDocumentPage document={legalDocuments.business} />;
}

export default withExperiencePage(BusinessTermsPage);

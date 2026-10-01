import { LegalDocumentPage } from "@/app/legal/legal-components";
import { legalDocuments, legalMetadata } from "@/lib/legal-policies";
import type { Metadata } from "next";

export const metadata: Metadata = legalMetadata({
  description: legalDocuments.terms.description,
  path: legalDocuments.terms.href,
  title: legalDocuments.terms.title,
});

export default function TermsPage() {
  return <LegalDocumentPage document={legalDocuments.terms} />;
}

import { LegalDocumentPage } from "@/app/legal/legal-components";
import { legalDocuments, legalMetadata } from "@/lib/legal-policies";
import type { Metadata } from "next";

export const metadata: Metadata = legalMetadata({
  description: legalDocuments.privacy.description,
  path: legalDocuments.privacy.href,
  title: legalDocuments.privacy.title,
});

export default function PrivacyPage() {
  return <LegalDocumentPage document={legalDocuments.privacy} />;
}

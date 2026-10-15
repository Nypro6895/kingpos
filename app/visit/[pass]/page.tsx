import { withExperiencePage } from "@/components/experience-page";
import { notFound } from "next/navigation";
import { CustomerVisitPass } from "./visit-pass";
async function VisitPassPage({ params }: { params: Promise<{ pass: string }> }) {
  const { pass } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(pass)) notFound();
  return <CustomerVisitPass pass={pass} />;
}

export default withExperiencePage(VisitPassPage);

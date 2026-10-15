import { withExperiencePage } from "@/components/experience-page";
import { redirect } from "next/navigation";

function PortableTodayRedirectPage() {
  redirect("/pos/portable/ticket");
}

export default withExperiencePage(PortableTodayRedirectPage);

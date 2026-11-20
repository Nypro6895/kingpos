import { withExperiencePage } from "@/components/experience-page";
import {redirect} from "next/navigation"; function Page(){redirect("/admin/settings#email");}

export default withExperiencePage(Page, { admin: true });

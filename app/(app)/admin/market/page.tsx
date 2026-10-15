import { withExperiencePage } from "@/components/experience-page";
import {MarketSystemWorkspace} from "./system-workspace"; function Page(){return <MarketSystemWorkspace/>;}

export default withExperiencePage(Page, { admin: true });

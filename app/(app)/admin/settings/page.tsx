import { withExperiencePage } from "@/components/experience-page";
import {MarketSystemWorkspace} from "../market/system-workspace"; function Page(){return <MarketSystemWorkspace/>;}

export default withExperiencePage(Page, { admin: true });

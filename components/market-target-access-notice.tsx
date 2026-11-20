import Link from "next/link";
import {WorkspaceText} from "@/components/workspace-language";
export function MarketTargetAccessNotice(){return <main className="mx-auto max-w-xl space-y-4 p-6"><p role="alert"><WorkspaceText text="Owner access to this active salon is required. Choose a salon you own in All Settings."/></p><Link href="/settings"><WorkspaceText text="All Settings"/></Link></main>;}

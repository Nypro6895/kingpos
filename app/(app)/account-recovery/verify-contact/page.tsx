import {withExperiencePage} from "@/components/experience-page";
import {ConfirmRecoveryContactForm} from "@/app/account-recovery/confirm-contact-form";
import Link from "next/link";
export const metadata={title:"Verify recovery email | Reylumi",robots:{index:false,follow:false},referrer:"no-referrer" as const};
async function Page({searchParams}:{searchParams:Promise<{token?:string}>}){const {token}=await searchParams;return <main className="mx-auto max-w-lg px-5 py-12"><h1 className="text-2xl font-semibold">Verify your recovery contact</h1><p className="mt-3 text-sm leading-6">Confirm that you can receive email here. Account ownership is checked separately by support; this does not sign you in.</p>{token&&/^[a-f0-9]{64}$/.test(token)?<ConfirmRecoveryContactForm token={token}/>:<p className="mt-4">This link is invalid. Ask support for a new verification email.</p>}<Link className="mt-6 inline-block underline" href="/contact-support">Contact support</Link></main>}
export default withExperiencePage(Page);

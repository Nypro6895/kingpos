import { withExperiencePage } from "@/components/experience-page";
import { AcceptInviteForm } from "./accept-invite-form";
function AcceptInvitePage() {
 return <main className="mx-auto max-w-md px-5 py-16"><h1 className="text-2xl font-semibold">Accept your Reylumi invitation</h1><p className="mt-2 text-sm text-zinc-600">Choose a password to finish setting up your account.</p><AcceptInviteForm/></main>;
}

export default withExperiencePage(AcceptInvitePage);

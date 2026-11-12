import Link from "next/link";
import { loadTaxIdentity, taxWorkspaceClient } from "@/lib/tax-workspace";
import { taxInvitePath } from "@/lib/tax-flow";
import { TaxInvitation } from "@/app/tax/tax-invitation";
export const metadata = { referrer: "no-referrer" as const };
export default async function InvitationPage({ params }: {
    params: Promise<{
        token: string;
    }>;
}) {
    const { token } = await params, path = taxInvitePath(token);
    if (!path)
        return <main className="tax-auth"><h1>Invitation unavailable</h1><p>Ask the owner for a new invitation.</p></main>;
    const { context, profile, error } = await loadTaxIdentity();
    if (!context.user)
        return <main className="tax-auth"><h1>Your Tax workspace invitation</h1><p>Sign in or create a Reylumi account to review and accept this invitation.</p><Link className="tax-primary" href={`/tax/login?next=${encodeURIComponent(path)}`}>Sign in</Link><p><Link href={`/tax/signup?next=${encodeURIComponent(path)}`}>Create an account</Link></p></main>;
    const { client } = await taxWorkspaceClient();
    const preview = await client.rpc("tax_invitation_preview", { p_token: token });
    if (error || preview.error || !preview.data)
        return <main className="tax-auth"><h1>Invitation unavailable</h1><p>{error || "This invitation expired, was revoked or was accepted by another account. Ask the owner for a new link."}</p><Link href="/tax">My Tax workspace</Link></main>;
    return <TaxInvitation token={token} salonName={preview.data.salon_name} active={preview.data.active} profile={profile} name={context.user.display_name ?? ""} email={context.user.email ?? ""}/>;
}

import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";
import { OwnerTransferAcceptancePanel } from "@/app/ownership/owner-transfer-acceptance-panel";
import { getCurrentKingUser } from "@/lib/users/current-user";
import Link from "next/link";

type OwnerTransferInvitePageProps = {
  params: Promise<{
    token: string;
  }>;
};

async function OwnerTransferInvitePage({
  params,
}: OwnerTransferInvitePageProps) {
  const [{ token }, user] = await Promise.all([params, getCurrentKingUser()]);

  if (!user) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-xl px-4 py-12">
        <section className="min-w-0 bg-surface py-5">
          <h1 className="text-2xl font-extrabold text-text-primary">
            <WorkspaceText text="Owner invitation" />
          </h1>
          <p className="mt-2 text-sm font-medium text-text-secondary">
            <WorkspaceText text="Sign in with the invited account to continue." />
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white"
              href={`/login?next=${encodeURIComponent(`/ownership/invite/${token}`)}`}
            >
              <WorkspaceText text="Login" />
            </Link>
            <Link
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-950"
              href={`/signup?next=${encodeURIComponent(`/ownership/invite/${token}`)}`}
            >
              <WorkspaceText text="Sign up" />
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-surface px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-xl">
        <OwnerTransferAcceptancePanel token={token} />
      </div>
    </main>
  );
}

export default withExperiencePage(OwnerTransferInvitePage);

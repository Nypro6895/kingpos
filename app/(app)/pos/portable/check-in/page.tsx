import { withExperiencePage } from "@/components/experience-page";
import { WorkspaceText } from "@/components/workspace-language";
import { PortableCheckInClient } from "@/app/pos/portable/check-in/portable-check-in-client";
import {
  getPortableCheckInData,
  portableSubmitAttendanceEvent,
} from "@/app/pos/portable/actions";

async function PortableCheckInPage() {
  let data: Awaited<ReturnType<typeof getPortableCheckInData>>;

  try {
    data = await getPortableCheckInData();
  } catch {
    return (
      <section className="grid h-full place-items-center px-6 text-center">
        <div className="max-w-md rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-zinc-950">
            <WorkspaceText text="Check-in is locked" />
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            <WorkspaceText text="End the current device session and sign in again with a Portable POS ID that can use staff check-in." />
          </p>
        </div>
      </section>
    );
  }

  return (
    <PortableCheckInClient
      action={portableSubmitAttendanceEvent}
      data={data}
    />
  );
}

export default withExperiencePage(PortableCheckInPage);

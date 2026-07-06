import { createStaff } from "@/app/staff/actions";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { hasPermission } from "@/lib/permissions";
import { getCurrentSalonStaff } from "@/lib/staff";
import type { Staff } from "@/types/staff";
import { redirect } from "next/navigation";

type StaffPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function Field({
  label,
  name,
  autoComplete,
  required = false,
  type = "text",
}: {
  label: string;
  name: string;
  autoComplete?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={
        isActive
          ? "inline-flex rounded-md bg-zinc-950 px-2 py-1 text-xs font-medium text-white"
          : "inline-flex rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700"
      }
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

function MissingSalonState() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold text-zinc-950">Staff</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Manage staff members for this salon.
      </p>
      <p className="mt-6 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600">
        Please select a salon first.
      </p>
    </main>
  );
}

function StaffForm({
  error,
  canManageStaff,
}: {
  error?: string;
  canManageStaff: boolean;
}) {
  if (!canManageStaff) {
    return (
      <p className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
        You do not have permission to manage staff.
      </p>
    );
  }

  return (
    <form
      action={createStaff}
      className="mt-4 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-2">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Field autoComplete="name" label="Display Name" name="display_name" required />
      </div>
      <Field autoComplete="given-name" label="First Name" name="first_name" />
      <Field autoComplete="family-name" label="Last Name" name="last_name" />
      <Field autoComplete="tel" label="Phone" name="phone" />
      <Field autoComplete="email" label="Email" name="email" type="email" />
      <Field autoComplete="organization-title" label="Job Title" name="job_title" />

      <label className="flex items-center gap-2 text-sm font-medium text-zinc-700 sm:col-span-2">
        <input
          className="size-4 rounded border-zinc-300"
          defaultChecked
          name="is_active"
          type="checkbox"
        />
        Active
      </label>

      <div className="sm:col-span-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Create
        </button>
      </div>
    </form>
  );
}

function StaffList({ staff }: { staff: Staff[] }) {
  if (staff.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6">
        <h2 className="text-lg font-semibold text-zinc-950">No staff yet</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Create your first staff member for this salon.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="grid grid-cols-12 border-b border-zinc-200 bg-zinc-50 px-5 py-3 text-xs font-medium uppercase text-zinc-500">
        <div className="col-span-12 sm:col-span-4">Display Name</div>
        <div className="hidden sm:col-span-3 sm:block">Job Title</div>
        <div className="hidden sm:col-span-3 sm:block">Phone</div>
        <div className="hidden sm:col-span-2 sm:block">Status</div>
      </div>
      <ul className="divide-y divide-zinc-200">
        {staff.map((member) => (
          <li className="grid grid-cols-12 gap-3 px-5 py-4" key={member.id}>
            <div className="col-span-12 sm:col-span-4">
              <p className="font-medium text-zinc-950">{member.display_name}</p>
            </div>
            <div className="col-span-12 self-center text-sm text-zinc-700 sm:col-span-3">
              <span className="font-medium text-zinc-500 sm:hidden">Job Title: </span>
              {member.job_title || "-"}
            </div>
            <div className="col-span-6 self-center text-sm text-zinc-700 sm:col-span-3">
              <span className="font-medium text-zinc-500 sm:hidden">Phone: </span>
              {member.phone || "-"}
            </div>
            <div className="col-span-6 self-center sm:col-span-2">
              <StatusBadge isActive={member.is_active} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function StaffPage({ searchParams }: StaffPageProps) {
  const [{ error }, context] = await Promise.all([
    searchParams,
    getCurrentBusinessContext(),
  ]);

  if (!context.user) {
    redirect("/login");
  }

  if (!context.currentSalon) {
    return <MissingSalonState />;
  }

  const canViewStaff = await hasPermission("staff.view", context);

  if (!canViewStaff) {
    return (
      <main className="mx-auto w-full max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold text-zinc-950">Staff</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage staff members for this salon.
        </p>
        <p className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 p-5 text-sm text-zinc-600">
          You do not have permission to view staff.
        </p>
      </main>
    );
  }

  const [{ staff }, canManageStaff] = await Promise.all([
    getCurrentSalonStaff(),
    hasPermission("staff.manage", context),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="border-b border-zinc-200 pb-6">
        <h1 className="text-3xl font-semibold text-zinc-950">Staff</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Manage staff members for this salon.
        </p>
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-zinc-950">Create Staff</h2>
        <StaffForm canManageStaff={canManageStaff} error={error} />
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-zinc-950">Staff Members</h2>
        <StaffList staff={staff} />
      </section>
    </main>
  );
}

import type { Customer } from "@/types/customer";
import Link from "next/link";

type CustomerFormProps = {
  action: (formData: FormData) => Promise<void>;
  customer?: Customer;
  error?: string;
  mode: "create" | "edit";
};

function Field({
  label,
  name,
  autoComplete,
  defaultValue,
  required = false,
  type = "text",
}: {
  label: string;
  name: string;
  autoComplete?: string;
  defaultValue?: string | null;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        autoComplete={autoComplete}
        className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
        defaultValue={defaultValue ?? ""}
        name={name}
        required={required}
        type={type}
      />
    </label>
  );
}

export function CustomerForm({ action, customer, error, mode }: CustomerFormProps) {
  return (
    <form
      action={action}
      className="mt-6 grid gap-5 rounded-lg border border-zinc-200 bg-white p-5 sm:grid-cols-2"
    >
      {customer ? <input name="customer_id" type="hidden" value={customer.id} /> : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:col-span-2">
          {error}
        </p>
      ) : null}

      <div className="sm:col-span-2">
        <Field
          autoComplete="name"
          defaultValue={customer?.name}
          label="Customer name"
          name="name"
          required
        />
      </div>
      <Field
        autoComplete="tel"
        defaultValue={customer?.phone}
        label="Phone"
        name="phone"
      />
      <Field
        autoComplete="email"
        defaultValue={customer?.email}
        label="Email"
        name="email"
        type="email"
      />

      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-zinc-700">Legacy notes</span>
        <textarea
          className="mt-2 min-h-32 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={customer?.notes ?? ""}
          name="notes"
        />
      </label>

      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-zinc-700">Staff-safe notes</span>
        <textarea
          className="mt-2 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={customer?.staff_notes ?? ""}
          name="staff_notes"
        />
      </label>

      <label className="block sm:col-span-2">
        <span className="text-sm font-medium text-zinc-700">Owner-only notes</span>
        <textarea
          className="mt-2 min-h-24 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
          defaultValue={customer?.internal_notes ?? ""}
          name="internal_notes"
        />
      </label>

      {mode === "edit" ? (
        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Status</span>
          <select
            className="mt-2 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-950"
            defaultValue={customer?.status ?? "active"}
            name="status"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      ) : null}

      <div className="flex flex-wrap gap-3 sm:col-span-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
          type="submit"
        >
          Save Customer
        </button>
        <Link
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-950"
          href={customer ? `/customers/${customer.id}` : "/customers"}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

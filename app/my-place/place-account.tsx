"use client";

import { useState, useTransition } from "react";
import type { CurrentWorkspaceOption as Workspace } from "@/lib/current-context";
import type { PlaceAccountDetails } from "@/types/my-place";
import { getPlaceAccount, savePlaceMember } from "./actions";
import {
  Avatar,
  Field,
  LoadState,
  Notice,
  button,
  inputClass,
  primaryButton,
  readForm,
} from "./place-ui";

function permissionLabel(code: string) {
  const words = code.replaceAll("_", " ").split(".");
  const operation = words.pop() ?? "";
  return `${operation.charAt(0).toUpperCase()}${operation.slice(1)} ${words.join(" ")}`.trim();
}

export function CurrentBadge() {
  return (
    <span className="rounded-full bg-teal-50 px-2 py-1 text-[11px] font-semibold text-teal-700">
      Current workspace
    </span>
  );
}

export function AccountRow({
  workspace,
  current,
  salons,
  onCreate,
  onSalon,
  onNotice,
}: {
  workspace: Workspace;
  current: boolean;
  salons: Workspace[];
  onCreate: () => void;
  onSalon: (w: Workspace) => void;
  onNotice: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PlaceAccountDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [inviting, setInviting] = useState(false);
  async function load() {
    setError(null);
    try {
      const result = await getPlaceAccount(workspace.id);
      if (result.ok) setData(result.data);
      else setError(result.message);
    } catch {
      setError("Unable to load account members.");
    }
  }
  function submit(form: FormData) {
    start(async () => {
      setError(null);
      try {
        const result = await savePlaceMember(workspace.id, form);
        if (!result.ok) setError(result.message);
        else {
          onNotice(
            form.get("operation") === "invite"
              ? "Invitation created. The recipient can accept it in My Place."
              : "Membership updated.",
          );
          setInviting(false);
          await load();
        }
      } catch {
        setError("Unable to save this membership.");
      }
    });
  }
  const editableRoles = data?.roles.filter((r) => r.code !== "OWNER") ?? [];
  return (
    <div>
      <button
        className="flex w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-[#fcfaf8] sm:px-5"
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          setOpen(!open);
          if (!open && !data) void load();
        }}
      >
        <Avatar workspace={workspace} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="break-words text-sm font-bold">
              {workspace.label}
            </span>
            {current ? <CurrentBadge /> : null}
          </span>
          <span className="mt-1 block text-xs text-zinc-500">
            {workspace.roleLabel} · {workspace.salonCount ?? salons.length}{" "}
            salon{(workspace.salonCount ?? salons.length) === 1 ? "" : "s"}
          </span>
        </span>
        <span className="text-xs font-semibold text-zinc-500">
          {open ? "Close ↑" : "Manage ↓"}
        </span>
      </button>
      {open ? (
        <div className="grid gap-5 border-t border-[#f1ebe6] bg-[#fdfbf9] p-4 sm:p-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              Salons in this account
            </h3>
            <div className="flex flex-wrap gap-2">
              {salons.map((s) => (
                <button
                  className={button}
                  key={s.id}
                  onClick={() => onSalon(s)}
                >
                  {s.label}
                </button>
              ))}
              {workspace.menuActions.some((a) => a.id === "create-salon") ? (
                <button className={button} onClick={onCreate}>
                  ＋ Create salon
                </button>
              ) : null}
            </div>
          </div>
          {!data ? (
            <LoadState error={error ?? undefined} retry={() => void load()} />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Members ({data.members.length})
                </h3>
                {data.canManage && editableRoles.length > 0 ? (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => setInviting(!inviting)}
                  >
                    {inviting ? "Cancel invitation form" : "Invite member"}
                  </button>
                ) : null}
              </div>
              <p className="-mt-3 text-xs text-zinc-500">
                Business account roles apply across its salons.
              </p>
              {inviting ? (
                <form
                  onSubmit={(event) => submit(readForm(event))}
                  className="grid gap-3 rounded-xl border border-[#eee5df] bg-white p-4"
                >
                  <input type="hidden" name="operation" value="invite" />
                  <fieldset
                    disabled={busy}
                    className="grid gap-3 sm:grid-cols-2"
                  >
                    <Field
                      label="Member’s Reylumi email"
                      name="email"
                      type="email"
                      required
                      maxLength={320}
                    />
                    <label className="grid gap-1.5 text-sm font-medium">
                      Role
                      <select name="role_id" className={inputClass} required>
                        {editableRoles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                  <p className="text-xs text-zinc-500">
                    Invite an existing Reylumi user. They will see the
                    invitation in My Place and must accept it before gaining
                    access.
                  </p>
                  <button
                    className={primaryButton}
                    disabled={busy}
                    type="submit"
                  >
                    {busy ? "Saving…" : "Create invitation"}
                  </button>
                </form>
              ) : null}
              {error ? <Notice error>{error}</Notice> : null}
              <div className="divide-y divide-[#eee5df] rounded-xl border border-[#eee5df] bg-white">
                {data.members.map((m) => (
                  <div
                    key={`${m.id}-${m.roleId}-${m.status}`}
                    className="flex flex-wrap items-center justify-between gap-3 p-3"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-semibold">
                        {m.name}
                        {m.isSelf ? " (you)" : ""}
                      </p>
                      <p className="break-all text-xs text-zinc-500">
                        {m.email}
                      </p>
                      <p className="mt-1 text-xs capitalize text-zinc-500">
                        {data.roles.find((r) => r.id === m.roleId)?.name ??
                          m.roleCode}{" "}
                        ·{" "}
                        {m.status === "invited"
                          ? "Invitation pending"
                          : m.status}
                      </p>
                    </div>
                    {data.canManage &&
                    !m.isSelf &&
                    m.roleCode !== "OWNER" &&
                    ["active", "invited"].includes(m.status) ? (
                      <form
                        onSubmit={(event) => submit(readForm(event))}
                        className="flex flex-wrap gap-2"
                      >
                        <input
                          type="hidden"
                          name="membership_id"
                          value={m.id}
                        />
                        <select
                          aria-label={`Role for ${m.name}`}
                          className={`${inputClass} !w-auto max-w-48`}
                          name="role_id"
                          defaultValue={m.roleId}
                          disabled={busy}
                        >
                          {editableRoles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                        <button
                          className={button}
                          disabled={busy}
                          name="operation"
                          value="role"
                          type="submit"
                        >
                          Save role
                        </button>
                        {m.status === "invited" ? (
                          <button
                            className={button}
                            disabled={busy}
                            name="operation"
                            value="revoke"
                            type="submit"
                          >
                            Cancel invite
                          </button>
                        ) : null}
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-zinc-600">
                  Role permissions
                </summary>
                <div className="mt-3 grid gap-3">
                  {data.roles.map((r) => (
                    <div key={r.id}>
                      <p className="font-semibold">{r.name}</p>
                      <p className="mt-1 text-xs leading-5 text-zinc-500">
                        {r.code === "OWNER"
                          ? "Full business account access. Ownership changes are managed separately."
                          : r.permissions.map(permissionLabel).join(", ") ||
                            "No permissions assigned."}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

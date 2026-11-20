"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { saveTaxProfile, connectTaxBusiness } from "@/app/tax/actions";
import type { TaxProfile } from "@/types/tax-workspace";
import type { CurrentWorkspaceOption } from "@/lib/current-context";
import "./tax-workspace.css";
import { TaxAccountMenu } from "./tax-account-menu";
import { LogoutButton } from "@/app/account/logout-button";
import type { TaxBusinessSummary } from "@/lib/tax-workspace";
export function TaxProfileForm({
  profile,
  name,
  email,
  onSaved,
  submitLabel,
}: {
  profile: TaxProfile | null;
  name: string;
  email: string;
  onSaved: () => void;
  submitLabel?: string;
}) {
  const [pending, start] = useTransition(),
    [error, setError] = useState("");
  return (
    <form
      className="tax-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          const result = await saveTaxProfile(form);
          if (!result.ok) setError(result.error);
          else onSaved();
        });
      }}
    >
      <label>
        Display name
        <input
          name="display_name"
          required
          maxLength={120}
          defaultValue={profile?.display_name ?? name}
        />
      </label>
      <label>
        Contact email
        <input
          name="contact_email"
          type="email"
          required
          maxLength={254}
          defaultValue={profile?.contact_email ?? email}
        />
      </label>
      <label>
        Phone
        <input
          name="phone"
          type="tel"
          maxLength={40}
          defaultValue={profile?.phone ?? ""}
        />
      </label>
      <label>
        Company / practice name <span className="tax-muted">(optional)</span>
        <input
          name="company_name"
          maxLength={160}
          defaultValue={profile?.company_name ?? ""}
        />
      </label>
      <p className="tax-muted">
        This is your personal working profile, not a public listing or a
        verified professional credential. Access to each business is granted
        separately by its owner.
      </p>
      {error && (
        <p role="alert" className="tax-error">
          {error}
        </p>
      )}
      <button className="tax-primary" disabled={pending}>
        {pending ? "Saving…" : submitLabel ?? (profile ? "Save profile" : "Start tax work")}
      </button>
    </form>
  );
}
export function TaxConnectForm({ onConnected }: { onConnected: () => void }) {
  const [pending, start] = useTransition(),
    [error, setError] = useState("");
  return (
    <form
      className="tax-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        start(async () => {
          const result = await connectTaxBusiness(form);
          if (!result.ok) setError(result.error);
          else onConnected();
        });
      }}
    >
      <label>
        Business ID
        <input
          name="login_id"
          required
          maxLength={80}
          autoComplete="off"
          placeholder="TAX-…"
        />
      </label>
      <label>
        Connection password
        <input
          name="password"
          type="password"
          required
          maxLength={72}
          autoComplete="off"
        />
      </label>
      <p className="tax-muted">
        Use the ID and password supplied by the salon owner. These are not your
        personal sign-in details.
      </p>
      {error && (
        <p role="alert" className="tax-error">
          {error}
        </p>
      )}
      <button className="tax-primary" disabled={pending}>
        {pending ? "Connecting…" : "Connect business"}
      </button>
    </form>
  );
}
export function TaxEntry({
  profile,
  initialName,
  initialEmail,
  salons,
  workspaces,
  qa = false,
  editing = false,
}: {
  profile: TaxProfile | null;
  initialName: string;
  initialEmail: string;
  salons: TaxBusinessSummary[];
  workspaces: CurrentWorkspaceOption[];
  qa?: boolean;
  editing?: boolean;
}) {
  const [view, setView] = useState(editing ? "profile" : "businesses");
  if (!profile || view === "profile")
    return (
      <main className="tax-auth">
        <Link href="/tax" className="tax-brand">
          ReyLUMI <span>Tax</span>
        </Link>
        <h1>{profile ? "Your tax profile" : "Set up your Tax profile"}</h1>
        <p>
          One personal Reylumi account. A dedicated place for your tax work.
        </p>
        <TaxProfileForm
          profile={profile}
          name={initialName}
          email={initialEmail}
          onSaved={() => window.location.assign("/tax")}
        />
        {profile && (
          <button onClick={() => setView("businesses")}>
            Back to businesses
          </button>
        )}
      </main>
    );
  return (
    <div className="tax-app">
      <header className="tax-topbar">
        <Link href="/tax" className="tax-brand">
          ReyLUMI <span>Tax</span>
        </Link>
        <TaxAccountMenu label={<>{profile.display_name} · Tax</>}>
          <button onClick={() => setView("profile")}>Tax profile</button>
          <Link href="/settings/login-security">Security & sessions</Link>
          {workspaces
            .filter((w) => w.type !== "tax")
            .map((w) => (
              <a
                key={w.id}
                href={`/workspace/open?workspace_id=${encodeURIComponent(w.id)}`}
              >
                {w.type === "personal"
                  ? "Personal"
                  : w.roleLabel + " · " + w.label}
              </a>
            ))}
          <LogoutButton returnHref="/tax/login" />
        </TaxAccountMenu>
      </header>
      <main className="tax-home">
        <div className="tax-section-heading">
          <div>
            <h1>My businesses</h1>
            <p className="tax-muted">
              {profile.company_name || "Your personal Tax workspace"}
            </p>
          </div>
          <button
            className="tax-primary"
            onClick={() =>
              setView(view === "connect" ? "businesses" : "connect")
            }
          >
            {view === "connect" ? "Close" : "＋ Connect business"}
          </button>
        </div>
        {qa && (
          <p className="tax-qa">
            Local QA · seeded data · no external messages or payments
          </p>
        )}
        {view === "connect" && (
          <section className="tax-panel">
            <h2>Connect a business</h2>
            <TaxConnectForm onConnected={() => window.location.reload()} />
          </section>
        )}
        <div className="tax-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Business</th>
                <th>Location</th>
                <th>Paystub needed</th>
                <th>Access</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {salons.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td>{[s.city, s.state].filter(Boolean).join(", ") || "—"}</td>
                  <td>{s.missing_paystubs ?? "—"}</td>
                  <td>
                    <span className={`tax-badge ${s.active ? "" : "tax-warn"}`}>
                      {s.active ? "Connected" : "Paused"}
                    </span>
                    {!s.active && (
                      <small>
                        <span>
                          {s.inactive_reason ??
                            "Ask the owner to renew Tax Company access."}
                        </span>
                        <br />
                        <button
                          type="button"
                          onClick={() => window.location.reload()}
                        >
                          Refresh access
                        </button>
                      </small>
                    )}
                  </td>
                  <td>
                    {s.active && (
                      <Link href={`/tax/${s.id}`}>Open workspace →</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!salons.length && (
          <div className="tax-empty">
            <h2>Connect your first business</h2>
            <p>Ask its owner for the Tax connection ID and password.</p>
            <button onClick={() => setView("connect")}>Connect business</button>
          </div>
        )}
      </main>
    </div>
  );
}

"use client";
import { OwnerTaxCredentials } from "@/app/tax-company/owner-credentials";
import { updateTaxSettings } from "@/app/tax-company/actions";
import { TaxAccessLink } from "./tax-access-link";
export type OwnerTaxConnection = {
  active: boolean;
  enabled: boolean;
  login_id: string | null;
  connections: {
    user_id: string;
    display_name: string | null;
    email: string | null;
    phone: string | null;
    connected_at: string;
    account_active: boolean;
  }[];
};
export function OwnerConnectionPanel({ state, salonId }: { state: OwnerTaxConnection;salonId?:string }) {
  return (
    <>
      <section className="tax-panel">
        <h3>Salon login · ID & password</h3>
        <OwnerTaxCredentials
          loginId={state.login_id}
          active={state.active}
          enabled={state.enabled}
        />
        <TaxAccessLink salonId={salonId} canInvite={state.active&&state.enabled}/>
      </section>
      <section className="tax-panel">
        <h3>People with tax access · {state.connections.length}</h3>
        {state.connections.map((person) => (
          <div key={person.user_id} className="tax-section-heading">
            <div>
              <strong>
                {person.display_name || person.email || "Reylumi account"}
              </strong>
              <p>{person.email || person.phone}</p>
              <small className="tax-muted">
                Connected {person.connected_at.slice(0, 10)}
              </small>
            </div>
            <span className="tax-badge">
              {state.active && state.enabled && person.account_active
                ? "Can manage tax"
                : "Inactive"}
            </span>
          </div>
        ))}
        <p>
          The former professional loses salon access. The next professional
          continues from your existing records, with previous authors preserved.
        </p>
        {state.enabled && (
          <form action={updateTaxSettings}>
            <input type="hidden" name="disconnect" value="true" />
            <button>Disconnect all accounts</button>
          </form>
        )}
      </section>
    </>
  );
}

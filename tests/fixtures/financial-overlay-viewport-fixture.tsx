import React from "react";
import { createRoot } from "react-dom/client";
import { CustomServiceDialog } from "@/app/pos/custom-service-dialog";
import { CompactCheckoutAdjustments } from "@/app/pos/compact-checkout-adjustments";
import { StaffProfileSettingsDrawer } from "@/app/staff/my-work/staff-profile-settings-drawer";
import { StaffCreateAppointment } from "@/app/staff/appointments/staff-create-appointment";
import { ReceiptSetupSection } from "@/components/receipt-setup";
import { ReceiptContextProvider } from "@/components/receipt-print-context";
import { CheckWriter } from "@/app/check-writer/check-writer";
import { TaxWorkspace } from "@/app/tax/tax-workspace";
import { DeskRelay } from "@/app/service-relay/desk-relay";

const staff = {
  id: "fixture-staff", first_name: "Alex", last_name: "Nguyen",
  legal_first_name: "Alex", legal_last_name: "Nguyen", display_name: "Alex",
  public_bio: "Nail professional", job_title: "Nail artist", specialties: ["Gel nails"], is_active: true,
};
const taxData = {
  salon: { id: "fixture-salon", name: "Audit salon", phone: null, city: "Milwaukee", state: "WI", address_line1: "100 Sample Street" },
  runs: [], lines: [], documents: [], messages: [], receipts: [], events: [], people: [],
};
const relayData = {
  installed: true,
  tickets: [{ visitId: "fixture-visit", queueNumber: 1, customerName: "Audit customer", status: "checkout", revision: 1,
    lines: [{ id: "fixture-line", offerId: "fixture-offer", staffId: "fixture-staff", staffName: "Alex", serviceId: "fixture-service", serviceName: "Manicure", amount: 25 }], offers: [], requestedServices: [] }],
  services: [{ id: "fixture-service", name: "Manicure", price: 25 }], staff: [{ id: "fixture-staff", name: "Alex" }],
};
const root = createRoot(document.getElementById("root")!);
let revision = 0;
const close = () => window.showFinancialOverlay("closed");
const deny = async () => { window.financialMutationCalls.push("relay"); throw Error("No financial mutation in fixture"); };

declare global {
  interface Window {
    showFinancialOverlay: (kind: string) => void;
    financialMutationCalls: string[];
    financialUiResults: unknown[];
  }
}
window.financialMutationCalls = [];
window.financialUiResults = [];
window.showFinancialOverlay = kind => root.render(
  <React.Fragment key={++revision}>
    <main style={{ height: "100dvh", overflow: "hidden", padding: 16 }}>
      <h1>Local financial layout fixture</h1>
      {(kind === "tip" || kind === "discount") && <CompactCheckoutAdjustments disabled={false} discountInput="" discountType="fixed_amount" tipInput="" tipSuggestions={[5, 10, 15, 20]}
        onApply={(...args) => window.financialUiResults.push(args)} />}
      {kind === "staff-create" && <StaffCreateAppointment salonId="fixture-salon" date="2026-11-19" />}
      {kind === "receipt" && <ReceiptContextProvider scope="fixture:salon" brand={{ salonName: "Audit salon" }} timezone="America/Chicago"><ReceiptSetupSection /></ReceiptContextProvider>}
      {kind === "check-writer" && <CheckWriter />}
      {kind === "tax-receipt" && <TaxWorkspace qa initialData={taxData} mode="tax" profile={{ user_id: "fixture-user", display_name: "Audit tax professional", contact_email: "audit@example.test", phone: "", company_name: "" }} salons={[]} workspaces={[]} today="2026-11-19" />}
      {kind.startsWith("relay") && <DeskRelay salonId="fixture-salon" load={async () => ({ data: relayData })} submit={deny} save={deny} notify={deny} />}
    </main>
    {kind.startsWith("custom") && <CustomServiceDialog showKeyboard={kind === "custom-touch"} onCancel={close} onDone={name => { window.financialUiResults.push(name); close(); }} />}
    {kind === "profile" && <StaffProfileSettingsDrawer avatarUrl={null} closeHref="/staff/my-work" displayName="Alex" staff={staff as never} />}
  </React.Fragment>,
);
window.showFinancialOverlay("closed");

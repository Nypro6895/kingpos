import "server-only";
import { cookies, headers } from "next/headers";
import type {
  TaxProfile,
  TaxReportAmounts,
  TaxReportBreakdown,
  TaxReportComponent,
  TaxWorkspaceData,
  TaxWorkspaceMode,
} from "@/types/tax-workspace";
type Session = {
  mode: TaxWorkspaceMode;
  userId: string;
  staffUserId: string;
  profile: TaxProfile | null;
  data: TaxWorkspaceData;
};
const runtime = globalThis as typeof globalThis & {
  __reylumiTaxQa?: Map<string, Session>;
};
export const TAX_QA_SALON = "00000000-0000-4000-8000-000000000010";
const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const amountKeys = ["gross", "tax", "net", "check_gross", "check_tax", "check_net", "cash_gross", "cash_tax", "cash_net"] as const;
const componentKeys = ["check_wage", "cash_wage", "tip", "bonus"] as const;
function qaPart(gross: number, rate: number, applyTax: boolean, method: "check" | "cash", shown = true): TaxReportComponent {
  const tax = applyTax ? Math.round(gross * rate) / 100 : 0, net = Math.round((gross - tax) * 100) / 100;
  return { shown, gross, tax, net, tax_applied: applyTax, tax_rate: rate, payout_method: method,
    check_gross: method === "check" ? gross : 0, check_tax: method === "check" ? tax : 0, check_net: method === "check" ? net : 0,
    cash_gross: method === "cash" ? gross : 0, cash_tax: method === "cash" ? tax : 0, cash_net: method === "cash" ? net : 0 };
}
/** Deterministic sanitized fixture with the same disclosure masks as the shared RPC. */
function qaBreakdown(parts: Record<typeof componentKeys[number], TaxReportComponent>): TaxReportBreakdown {
  const components = Object.fromEntries(componentKeys.map(key => [key, parts[key].shown ? parts[key] : {
    shown: false, tax_applied: null, tax_rate: null, payout_method: null, ...Object.fromEntries(amountKeys.map(field => [field, null])),
  }])) as TaxReportBreakdown["components"];
  const totals = Object.fromEntries(amountKeys.map(field => [field,
    componentKeys.some(key => !parts[key].shown && Number(parts[key][field]) !== 0) ? null : componentKeys.reduce((sum, key) => sum + Math.round(Number(parts[key][field]) * 100), 0) / 100,
  ])) as TaxReportAmounts;
  return { version: 1, state: "published", components, totals };
}
function seed(mode: TaxWorkspaceMode): Session {
  const profile = {
    user_id: uid(4),
    display_name: "Taylor Nguyen",
    contact_email: "taylor@example.test",
    phone: "",
    company_name: "Evergreen Tax",
  };
  const data: TaxWorkspaceData = {
    salon: {
      id: TAX_QA_SALON,
      name: "Lumi Nail Studio",
      phone: "555-0100",
      city: "Houston",
      state: "TX",
      address_line1: "123 Main Street",
    },
    runs: [
      {
        id: uid(30),
        period_start: "2026-10-01",
        period_end: "2026-10-15",
        version: 2,
        status: "printed",
        cycle_type: "semi_monthly",
      },
      {
        id: uid(31),
        period_start: "2026-10-01",
        period_end: "2026-10-15",
        version: 1,
        status: "printed",
        cycle_type: "semi_monthly",
      },
      {
        id: uid(32),
        period_start: "2026-10-16",
        period_end: "2026-10-31",
        version: 1,
        status: "paid",
        cycle_type: "semi_monthly",
      },
    ],
    lines: [],
    documents: [],
    messages: [],
    receipts: [],
    events: [],
  };
  const rows = [
    ["Anna Nguyen", "Anna Thi Nguyen", 1350, 135, 1215, "complete"],
    ["Brian Tran", "Brian Minh Tran", 1080, 108, 972, "reviewed"],
    ["Sophia Le", "Sophia Ngoc Le", 1500, 150, 1350, "needs_information"],
    ["Michael Pham", "Michael Van Pham", 900, 90, 810, "pending"],
    ["Emily Vo", "Emily Anh Vo", 1250, 125, 1125, "complete"],
    ["David Ho", "David Thanh Ho", 1100, 110, 990, "pending"],
  ] as const;
  for (const [i, row] of rows.entries())
    for (const run of data.runs)
      data.lines.push({
        id: uid(
          100 +
            i +
            (run.version === 1 ? 30 : 0) +
            (run.id === uid(32) ? 60 : 0),
        ),
        run_id: run.id,
        staff_id: uid(40 + i),
        name: row[0],
        legal_name: row[1],
        reported_gross:
          Number(row[2]) - (i === 2 && run.id === uid(31) ? 100 : 0),
        tax: Number(row[3]) - (i === 2 && run.id === uid(31) ? 10 : 0),
        actual_check: Number(row[4]) - (i === 2 && run.id === uid(31) ? 90 : 0),
        reported_wage:
          Number(row[2]) -
          (i === 2 && run.id === uid(31) ? 100 : 0) -
          (i === 0 ? 150 : 0) -
          (i === 1 ? 50 : 0),
        wage_check_net:
          Number(row[4]) - (i === 0 ? 135 : 0) - (i === 1 ? 45 : 0),
        tip_method: i === 0 ? "check" : null,
        cash_reported: null,
        tip: i === 0 ? 150 : null,
        bonus: i === 1 ? 50 : null,
        bonus_method: i === 1 ? "check" : null,
        tax_rate: 10,
        work_status: row[5],
        work_version: 1,
      });
  // One legacy employee remains exact but has no invented component history.
  for (const line of data.lines) {
    const index = rows.findIndex((_, value) => line.staff_id === uid(40 + value));
    if (index === 3) continue;
    const oldSophia = index === 2 && line.run_id === uid(31);
    const rate = line.run_id === uid(32) ? 20 : 10;
    const parts = index === 0 ? {
      check_wage: qaPart(1000, 20, true, "check"), cash_wage: qaPart(300, 20, false, "cash"),
      tip: qaPart(150, 20, false, "check"), bonus: qaPart(50, 20, false, "cash"),
    } : index === 1 ? {
      check_wage: qaPart(600, 10, true, "check"), cash_wage: qaPart(400, 10, false, "cash", false),
      tip: qaPart(100, 10, false, "check"), bonus: qaPart(50, 10, false, "cash", false),
    } : index === 2 ? {
      check_wage: qaPart(oldSophia ? 800 : 900, rate, true, "check"), cash_wage: qaPart(0, rate, false, "cash"),
      tip: qaPart(100, rate, true, "check"), bonus: qaPart(50, rate, true, "check"),
    } : index === 4 ? {
      check_wage: qaPart(0, 20, true, "check"), cash_wage: qaPart(1100, 20, true, "cash"),
      tip: qaPart(120, 20, false, "cash"), bonus: qaPart(30, 20, true, "cash"),
    } : {
      check_wage: qaPart(780, 10, true, "check"), cash_wage: qaPart(520, 10, false, "cash"),
      tip: qaPart(80, 10, true, "cash"), bonus: qaPart(20, 10, false, "check"),
    };
    const breakdown = qaBreakdown(parts);
    Object.assign(line, {
      breakdown,
      reported_wage: parts.check_wage.shown && parts.cash_wage.shown ? Number(parts.check_wage.gross) + Number(parts.cash_wage.gross) : null,
      reported_gross: breakdown.totals.gross, tax: breakdown.totals.tax, actual_check: breakdown.totals.check_net,
      wage_check_net: breakdown.components.check_wage.net, cash_reported: breakdown.totals.cash_gross,
      tip: breakdown.components.tip.gross, bonus: breakdown.components.bonus.gross,
      tip_method: breakdown.components.tip.payout_method, bonus_method: breakdown.components.bonus.payout_method,
      tax_rate: breakdown.components.check_wage.tax_rate,
    });
  }
  for (const i of [0, 1, 2, 4])
    data.documents.push({
      id: uid(200 + i),
      salon_id: TAX_QA_SALON,
      staff_id: uid(40 + i),
      recipient_user_id: uid(6 + i),
      payroll_run_id: i === 2 ? uid(31) : uid(30),
      kind: "paystub",
      title: `Paystub-${rows[i][0].split(" ")[0]}.pdf`,
      file_name: `Paystub-${rows[i][0].split(" ")[0]}.pdf`,
      mime_type: "application/pdf",
      size_bytes: 2048,
      version: i === 0 ? 2 : 1,
      supersedes_id: null,
      uploaded_by: uid(4),
      uploaded_role: "tax",
      created_at: "2026-11-08T16:20:00Z",
      archived_at: null,
      owner_deleted_at: null,
    });
  data.documents.push({
    ...data.documents[0],
    id: uid(220),
    title: "Paystub-Anna-v1.pdf",
    file_name: "Paystub-Anna-v1.pdf",
    version: 1,
    created_at: "2026-11-07T16:20:00Z",
    archived_at: "2026-11-08T16:20:00Z",
  });
  data.documents.push({
    ...data.documents[0],
    id: uid(230),
    staff_id: null,
    recipient_user_id: null,
    payroll_run_id: null,
    kind: "business",
    title: "Business-info.pdf",
    file_name: "Business-info.pdf",
    uploaded_role: "owner",
  });
  data.messages = [
    {
      id: uid(300),
      staff_id: null,
      payroll_run_id: uid(30),
      author_id: uid(2),
      author_name: "Linh · Owner",
      body: "Payroll v2 is ready. Please review Sophia's update and send the employee paystubs.",
      document_id: null,
      created_at: "2026-11-08T15:20:00Z",
    },
    {
      id: uid(301),
      staff_id: uid(42),
      payroll_run_id: uid(30),
      author_id: uid(4),
      author_name: "Taylor Nguyen",
      body: "Please upload Sophia's employee information. Her previous paystub needs a new version.",
      document_id: null,
      created_at: "2026-11-08T16:00:00Z",
    },
  ];
  data.receipts = [
    {
      id: uid(400),
      category: "service_fee",
      description: "October payroll service",
      amount_cents: 35000,
      currency: "USD",
      receipt_date: "2026-11-06",
      status: "paid",
      document_id: null,
      archived_at: null,
      created_at: "2026-11-06T16:00:00Z",
    },
    {
      id: uid(401),
      category: "tax_receipt",
      description: "Receipt supplied by tax professional",
      amount_cents: 120000,
      currency: "USD",
      receipt_date: "2026-11-05",
      status: "received",
      document_id: null,
      archived_at: null,
      created_at: "2026-11-05T16:00:00Z",
    },
  ];
  data.events = [
    {
      id: uid(500),
      actor_name: "Taylor Nguyen",
      action: "document_uploaded",
      subject_id: uid(200),
      detail: { title: "Paystub-Anna.pdf", version: 2 },
      created_at: "2026-11-08T16:20:00Z",
    },
    {
      id: uid(501),
      actor_name: "Alex · Previous tax professional",
      action: "message_sent",
      subject_id: null,
      detail: {},
      created_at: "2025-12-10T16:20:00Z",
    },
  ];
  return {
    mode,
    userId: mode === "staff" ? uid(6) : mode === "owner" ? uid(2) : uid(4),
    staffUserId: uid(6),
    profile:
      mode === "staff"
        ? {
            ...profile,
            user_id: uid(6),
            display_name: "Anna Nguyen",
            contact_email: "anna@example.test",
            company_name: "",
          }
        : profile,
    data,
  };
}
/** Dev-only, explicit opt-in, loopback-only, no credentials or external services. */
export async function taxQaRequest(): Promise<Session | null> {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.REYLUMI_TAX_LOCAL_QA !== "1"
  )
    return null;
  const host = (await headers()).get("host")?.split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host ?? "")) return null;
  const jar = await cookies(),
    key = jar.get("reylumi-tax-qa-session")?.value;
  if (!key || !/^[a-zA-Z0-9_-]{1,80}$/.test(key)) return null;
  const modeValue = jar.get("reylumi-tax-qa-mode")?.value;
  const mode: TaxWorkspaceMode =
    modeValue === "owner" || modeValue === "staff" ? modeValue : "tax";
  const sessions: Map<string, Session> = (runtime.__reylumiTaxQa ??= new Map<
    string,
    Session
  >());
  const sessionKey = key + ":" + mode + ":component-report-v1";
  if (!sessions.has(sessionKey)) sessions.set(sessionKey, seed(mode));
  return sessions.get(sessionKey)!;
}

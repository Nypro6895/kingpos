"use server";
import { marketPluginContext, payrollDataPluginInstalled } from "@/lib/market-plugins";
import { getPayrollPageData } from "@/lib/payroll";
import { PAYROLL_INCOME_COLUMNS,PAYROLL_ADJUSTMENT_COLUMNS,PAYROLL_PAYMENT_COLUMNS,PAYROLL_FINANCIAL_COLUMNS,payrollIncomeExport,payrollAdjustmentExport,payrollPaymentExport,payrollFinancialExport } from "@/lib/payroll-export";

export async function downloadPayrollData(input: { start: string; end: string; categories: string[] }) {
  try {
    const { client, salonId } = await marketPluginContext();
    if (!await payrollDataPluginInstalled()) throw new Error("Add Payroll Data Download from Market first.");
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!validDate(input.start) || !validDate(input.end) || input.start > input.end || Date.parse(input.end) - Date.parse(input.start) > 365 * 86400000) throw new Error("Choose a valid date range of up to one year.");
    if (!Array.isArray(input.categories) || !input.categories.length || input.categories.some(value => !["financial", "staff", "customers"].includes(value))) throw new Error("Choose at least one data category.");
    const files: { name: string; csv: string }[] = [];
    const addFile = (category: string, columns: string[], rows: (string | number | null)[][]) => {
      const escape = (value: string | number | null) => {
        const text = value === null ? "" : String(value);
        const safe = typeof value === "string" && /^\s*[=+@-]/.test(text) ? `'${text}` : text;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      files.push({ name: `payroll-${category}-${input.start}-${input.end}.csv`, csv: "\uFEFF" + [columns, ...rows].map(row => row.map(escape).join(",")).join("\r\n") });
    };
    if (input.categories.includes("financial") || input.categories.includes("staff")) {
      const data = await getPayrollPageData({ preset: "custom", startDate: input.start, endDate: input.end });
      if (!data.access.canViewAllPayroll) throw new Error("You do not have access to salon payroll data.");
      if (["legacy_review","schedule_review","processing"].includes(data.ledger.state)) throw new Error(data.ledger.configurationIssue || "This range does not have a verified closed payroll original yet. Select an available scheduled period.");
      if (input.categories.includes("financial")) addFile("financial",PAYROLL_FINANCIAL_COLUMNS,payrollFinancialExport(data.live.shopDailyRows));
      if (input.categories.includes("staff")) {
        const lines=data.live.reportLines??data.live.lines,period={start:input.start,end:input.end};
        addFile("staff",PAYROLL_INCOME_COLUMNS,payrollIncomeExport(lines,period,data.ledger.state));
        addFile("adjustments",PAYROLL_ADJUSTMENT_COLUMNS,payrollAdjustmentExport(lines,period));
        addFile("actual-payments-for-source-periods",PAYROLL_PAYMENT_COLUMNS,payrollPaymentExport(lines,period));
      }
    }
    if (input.categories.includes("customers")) {
      const rows: (string | number | null)[][] = [];
      const until = new Date(Date.parse(input.end) + 86400000).toISOString();
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.from("customers").select("id,name,phone,email,status,created_at").eq("location_id", salonId).gte("created_at", `${input.start}T00:00:00Z`).lt("created_at", until).order("created_at").order("id").range(offset, offset + 999);
        if (error) throw new Error("Customer data could not be downloaded.");
        rows.push(...(data ?? []).map(row => [row.id, row.name, row.phone, row.email, row.status, row.created_at]));
        if (!data || data.length < 1000) break;
      }
      addFile("customers", ["Customer ID", "Name", "Phone", "Email", "Status", "Created at (UTC)"], rows);
    }
    return { files };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Download failed. Please try again." };
  }
}

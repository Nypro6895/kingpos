"use server";
import { marketPluginContext, payrollDataPluginInstalled } from "@/lib/market-plugins";
import {recordedPayrollRows,RECORDED_PAYMENT_COLUMNS,RECORDED_ADJUSTMENT_COLUMNS} from "@/lib/payroll-recorded-export";
import { getPayrollPageData } from "@/lib/payroll";

export async function downloadPayrollData(input: { salonId: string; start: string; end: string; categories: string[] }) {
  try {
    const { client, salonId } = await marketPluginContext();
    if(input.salonId!==salonId)throw new Error("The selected salon changed. Reopen Payroll before downloading.");
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
      if (input.categories.includes("financial")) {
        const summary=data.live.shopSummary;
        addFile("financial", ["Date", "POS expected", "Daily Report collected", "Cash", "Card", "Other", "Over / short", "Staff net pay", "Tips allocated (calculated)", "Tax withheld", "Total staff cost", "Remaining after payroll"], [
          ...data.live.shopDailyRows.map(row => [row.businessDate, row.posIncome, row.actualIncome, row.cashAmount, row.creditCardAmount, row.otherAmount, row.difference, row.staffNetPay, row.tipsPaid, row.taxWithheld, row.staffObligation, row.shopNetIncome]),
          ["PERIOD TOTAL (includes all staff cost)",summary.posIncome,summary.totalActualIncome,summary.cashAmount,summary.creditCardAmount,summary.otherAmount,summary.overShortTotal,summary.staffNetPay,summary.tipsPaid,summary.taxWithheld,summary.totalStaffObligation,summary.shopNetIncome],
        ]);
      }
      const records=recordedPayrollRows(data.recordedFacts);
      if(records){addFile("recorded-payments",RECORDED_PAYMENT_COLUMNS,records.payments);addFile("recorded-adjustments",RECORDED_ADJUSTMENT_COLUMNS,records.adjustments);}
      else addFile("recorded-history-status",["Status"],[["Recorded payment/adjustment history unavailable; live calculations do not confirm payment."]]);
      if (input.categories.includes("staff")) addFile("staff", ["Staff", "Start", "End", "Gross sales", "Earned", "Tips", "Bonus", "Tax withheld", "Cash due (calculated)", "Check due (calculated)", "Final income"], data.live.lines.map(line => [line.staff_display_name_snapshot, input.start, input.end, line.gross_sales, line.earned_amount, line.tip_amount, line.bonus_amount, line.tax_withheld, line.final_cash_amount, line.final_check_amount, line.final_staff_income]));
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

import { getContextBusinessDate } from "@/lib/salon-business-clock";
import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { marketPluginContext } from "@/lib/market-plugins";
import { marketServiceClient } from "@/lib/market-payments";
import { getCurrentBusinessContext } from "@/lib/current-context";
import { validUnlock, checkWriterCryptoReady } from "@/lib/check-writer-crypto";
import { ACCESS_TOKEN_COOKIE } from "@/lib/supabase/server";
import type {
  CheckSettings,
  CheckSnapshot,
  PayrollCheckLine,
  PayrollCheckRun,
} from "@/types/check-writer";
import { DEFAULT_STUBS } from "@/types/check-writer";
import { getPayrollPageData } from "@/lib/payroll";
import { checkDate } from "@/lib/check-writer-rules";
export const UNLOCK_COOKIE = "reylumi-check-writer-unlock";
export async function checkWriterContext(paid = false, unlocked = false) {
  const { client, salonId } = await marketPluginContext();
  const { user, currentSalon } = await getCurrentBusinessContext();
  if (!user || !currentSalon)
    throw Error("Choose an active salon in your Owner workspace.");
  const service = marketServiceClient();
  const { error } = await service.rpc("check_writer_assert", {
    p_salon: salonId,
    p_actor: user.id,
    p_paid: paid,
  });
  if (error)
    throw Error(
      paid
        ? "Activate Check Writer for this salon in Market."
        : "Check Writer is unavailable for this salon.",
    );
  const jar = await cookies();
  const binding = createHash("sha256")
    .update(
      [salonId, user.id, jar.get(ACCESS_TOKEN_COOKIE)?.value ?? ""].join(":"),
    )
    .digest("hex");
  if (unlocked && !validUnlock(binding, jar.get(UNLOCK_COOKIE)?.value))
    throw Error("Unlock Check Writer to continue.");
  return { client, service, salonId, user, currentSalon, binding };
}
export async function checkWriterState(
  runId?: string,
  options: { payroll?: boolean } = {},
) {
  const ctx = await checkWriterContext();
  const [settings, subscription, runs, checks, events] = await Promise.all([
    ctx.service
      .from("check_writer_settings")
      .select("public_config,next_number,version")
      .eq("salon_id", ctx.salonId)
      .maybeSingle(),
    ctx.service
      .from("check_writer_subscriptions")
      .select("paid_until,stripe_subscription,payment_owner")
      .eq("salon_id", ctx.salonId)
      .maybeSingle(),
    ctx.service
      .from("payroll_runs")
      .select("id,period_start,period_end,version,status,updated_at")
      .eq("salon_id", ctx.salonId)
      .in("status", ["locked", "printed", "paid"])
      .order("period_start", { ascending: false })
      .limit(30),
    ctx.service
      .from("check_writer_checks")
      .select("id,number,snapshot,status,created_at,void_reason,delivery_count")
      .eq("salon_id", ctx.salonId)
      .order("created_at", { ascending: false })
      .limit(100),
    ctx.service
      .from("check_writer_events")
      .select("check_id,action,created_at,reason")
      .eq("salon_id", ctx.salonId)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if ([settings, subscription, checks, events].some((r) => r.error))
    throw Error("Check Writer data could not load.");
  let selectedRun = ((runs.data ?? []) as PayrollCheckRun[]).find(
    (r) => r.id === runId,
  );
  let lines: { data: PayrollCheckLine[] | null; error: unknown } = {
    data: [],
    error: null,
  };
  const runOptions = [...((runs.data ?? []) as PayrollCheckRun[])];
  let payrollError = runs.error ? "Payroll data could not load." : "";
  try {
    if (options.payroll !== false && !payrollError) {
      if (!runId || runId.startsWith("live:")) {
        const parts = runId?.split(":");
        const startDate = parts ? checkDate(parts[1]) : undefined,
          endDate = parts ? checkDate(parts[2]) : undefined;
        if (
          startDate &&
          endDate &&
          (startDate > endDate ||
            Date.parse(endDate) - Date.parse(startDate) > 366 * 86400000)
        )
          throw Error("Invalid payroll period.");
        // Reuse the app's read-only calculator. No formula is duplicated and no
        // payroll statement, status, settings or payout is written by this plugin.
        const current = await getPayrollPageData({
          startDate,
          endDate,
          includeAnalytics: false,
        });
        const liveId = `live:${current.period.startDate}:${current.period.endDate}`;
        selectedRun = {
          id: liveId,
          period_start: current.period.startDate,
          period_end: current.period.endDate,
          version: 1,
          status: "live",
          updated_at: "",
        };
        const liveLines = current.live.lines.map((line) => {
          const projected: PayrollCheckLine = {
            id: line.id,
            payroll_run_id: liveId,
            staff_id: line.staff_id,
            staff_display_name_snapshot: line.staff_display_name_snapshot,
            staff_legal_name_snapshot: line.staff_legal_name_snapshot,
            final_check_amount: line.final_check_amount,
            final_cash_amount: line.final_cash_amount,
            tip_amount: line.tip_amount,
            bonus_amount: line.bonus_amount,
            gross_sales: line.gross_sales,
            check_number: line.check_number,
            updated_at: "",
          };
          projected.updated_at = createHash("sha256")
            .update(JSON.stringify(projected))
            .digest("hex");
          return projected;
        });
        lines = { data: liveLines, error: null };
        runOptions.unshift(selectedRun);
      } else {
        if (!selectedRun) throw Error("Payroll period is no longer available.");
        lines = selectedRun
          ? await ctx.service
              .from("payroll_staff_lines")
              .select(
                "id,payroll_run_id,staff_id,staff_display_name_snapshot,staff_legal_name_snapshot,final_check_amount,final_cash_amount,tip_amount,bonus_amount,gross_sales,updated_at,check_number",
              )
              .eq("salon_id", ctx.salonId)
              .eq("payroll_run_id", selectedRun.id)
              .order("staff_display_name_snapshot")
          : { data: [], error: null };
      }
      if (lines.error) throw Error("Payroll data could not load.");
    }
  } catch {
    payrollError =
      "Payroll data could not load. Standalone checks and History remain available.";
    selectedRun = undefined;
    lines = { data: [], error: null };
  }
  const salon = ctx.currentSalon;
  const address = [
    salon.address_line1,
    salon.address_line2,
    [salon.city, salon.state, salon.postal_code].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join("\n");
  const config = settings.data?.public_config as
    Partial<CheckSettings> | undefined;
  const publicSettings: CheckSettings = {
    issuer: salon.name,
    address,
    useSalon: true,
    bankName: "",
    last4: "",
    stock: "preprinted",
    offsetX: 0,
    offsetY: 0,
    stubs: DEFAULT_STUBS,
    ...config,
    nextNumber: Number(settings.data?.next_number ?? 1001),
    version: settings.data?.version ?? 0,
  };
  if (publicSettings.useSalon) {
    publicSettings.issuer = salon.name;
    publicSettings.address = address;
  }
  return {
    payrollError,
    operationalReady: checkWriterCryptoReady(),
    businessDate: await getContextBusinessDate(
      await getCurrentBusinessContext(),
    ),
    salonId: ctx.salonId,
    settings: publicSettings,
    salonIssuer: salon.name,
    salonAddress: address,
    active:
      subscription.data?.payment_owner === ctx.user.id &&
      Date.parse(subscription.data?.paid_until ?? "") > Date.now(),
    subscribed: Boolean(subscription.data?.stripe_subscription),
    runs: runOptions,
    selectedRun,
    lines: lines.data as PayrollCheckLine[],
    history: (checks.data ?? []).map((c) => {
      const snapshot = c.snapshot as CheckSnapshot;
      return { ...c, snapshot: { ...snapshot, bankEncrypted: undefined } };
    }),
    events: events.data ?? [],
  };
}

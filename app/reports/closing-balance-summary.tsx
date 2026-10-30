"use client";
import { WorkspaceText as Text } from "@/components/workspace-language";
import { closingPayload, type ClosingFormValues } from "@/lib/daily-closing-input";
import { independentDailyBalances } from "@/lib/daily-input-reconciliation";
const money = (value: number) => new Intl.NumberFormat("en-US", {style: "currency", currency: "USD"}).format(value);
export function ClosingBalanceSummary({values, expectedService, expectedTip}: {values: ClosingFormValues; expectedService: number; expectedTip: number}) {
  let input: ReturnType<typeof closingPayload>;
  try {input = closingPayload(values);} catch {return <p role="status"><Text text="Check the amounts before saving." /></p>;}
  const balance = independentDailyBalances({grossService: expectedService, discount: 0, assignedTips: expectedTip, cash: input.cashAmount, card: input.creditCardAmount, other: input.otherAmount, serviceEntered: input.serviceEntered, tipInput: input.tipInput});
  return <div className="grid gap-4"><p className="text-xs text-zinc-500"><Text text="Cash, card and other exclude tips. Tips are counted separately." /></p>{[
    {label: "Service", expected: balance.expectedService, actual: input.serviceEntered ? input.cashAmount+input.creditCardAmount+input.otherAmount : null, difference: balance.serviceDifference},
    {label: "Tips", expected: balance.expectedTip, actual: input.tipInput, difference: balance.tipDifference},
  ].map(row => <div key={row.label} className="rounded-lg border border-zinc-200 p-3"><h3 className="text-sm font-semibold"><Text text={row.label} /></h3><dl className="mt-2 grid gap-1 text-sm"><div className="flex justify-between gap-3"><dt><Text text="Expected" /></dt><dd>{money(row.expected)}</dd></div><div className="flex justify-between gap-3"><dt><Text text="Entered" /></dt><dd>{row.actual === null ? <Text text="Not entered" /> : money(row.actual)}</dd></div><div className="flex justify-between gap-3 font-medium"><dt><Text text="Difference" /></dt><dd className={row.difference === null ? "text-zinc-500" : row.difference === 0 ? "text-emerald-700" : "text-amber-800"}>{row.difference === null ? <Text text="Not entered" /> : <>{money(row.difference)} · <Text text={row.difference === 0 ? "Balanced" : row.difference < 0 ? "Short" : "Over"} /></>}</dd></div></dl></div>)}</div>;
}

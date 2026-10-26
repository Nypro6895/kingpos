import type {PayrollLedger} from "@/lib/payroll-ledger";
export type PayrollRecordedPeriod=Pick<PayrollLedger,"base"|"revision"|"adjustments"|"payments"|"legacyPaidHistory">;
export type PayrollRecordedFacts={status:"available";periods:PayrollRecordedPeriod[]}|{status:"unavailable";message:string};

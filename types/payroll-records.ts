import type {PayrollLedger} from "@/lib/payroll-ledger";
export type PayrollRecordedPeriod=Pick<PayrollLedger,"base"|"revision"|"adjustments"|"payments"|"legacyPaidHistory"> & {
 sourcePeriod?: {start:string;end:string;cycle:string};
};
export type PayrollRecordedFacts={status:"available";periods:PayrollRecordedPeriod[];selection?:{start:string;end:string;exact:boolean}}|{status:"unavailable";message:string};

"use client";
import type {PayrollLiveChange} from "@/types/payroll-live-history";
import {WorkspaceText as Text} from "@/components/workspace-language";
import {isInlineFinancialEdit} from "@/lib/inline-financial-history";
import {InlineFinancialHistory} from "./inline-financial-history";
import styles from "./payroll-object-history.module.css";
export function PayrollObjectHistory({changes,label="Edited"}:{changes:PayrollLiveChange[];label?:string}){
 const edits=changes.filter(isInlineFinancialEdit);
 if(!edits.length)return null;
 return <details className={styles.changeDisclosure}><summary><span><Text text={label}/> · {edits.length}</span></summary><InlineFinancialHistory changes={edits}/></details>;
}

import type {PayrollLiveChange} from "@/types/payroll-live-history";

type Values=Record<string,unknown>;
export type FinancialChangeDetail={label:string;before:string;after:string};
export type FinancialChangeGroup={title:string;details:FinancialChangeDetail[]};
export type FinancialChangePresentation={title:string;summary:string;details:FinancialChangeDetail[];groups:FinancialChangeGroup[];incomplete:boolean};
const labels:Record<string,string>={service_total:"Service sales",gross_sales:"Service sales",tip_amount:"Tips",tip_input:"Entered tips",discount_amount:"Customer discount",discount_value:"Discount",discount_type:"Discount type",cash_amount:"Cash",credit_card_amount:"Card",other_amount:"Other",bonus_amount:"Bonus",commission_rate:"Commission",tax_rate:"Tax",check_rate:"Check split",fixed_pay_amount:"Fixed pay",pay_type:"Pay type",effective_from:"Effective from",effective_to:"Effective to",tip_payout_method:"Tip payout",bonus_payout_method:"Bonus payout",tax_tips:"Tax on tips",tax_bonus:"Tax on bonus",apply_tax_to_fixed_pay:"Tax on fixed pay",cash_to_tax_company:"Cash reported",tax_company_enabled:"Tax company",legal_name:"Legal name",check_number:"Check number",cycle_type:"Pay cycle",biweekly_anchor_date:"Anchor date",note:"Note",notes:"Ticket note",status:"Ticket status",entered:"Report entered",work_date:"Business date",recorded_payment_total:"Ticket payments"};
const monetary=new Set(["service_total","gross_sales","tip_amount","tip_input","discount_amount","cash_amount","credit_card_amount","other_amount","bonus_amount","fixed_pay_amount","recorded_payment_total"]);
const percentages=new Set(["commission_rate","tax_rate","check_rate"]);
const names:Record<string,string>={commission:"Commission",fixed:"Fixed pay",cash:"Cash",check:"Check",card:"Card",credit_card:"Card",other:"Other",monthly:"Monthly",semi_monthly:"Twice monthly",biweekly:"Every two weeks",fixed_amount:"Fixed amount",percentage:"Percentage",open:"Open",closed:"Completed",cancelled:"Cancelled",canceled:"Cancelled",void:"Voided",voided:"Voided",refunded:"Refunded"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord=(value:unknown):value is Values=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const array=(value:unknown):Values[]=>Array.isArray(value)?value.filter(isRecord):[];
export function financialHistoryText(value:unknown,fallback=""){const text=typeof value==="string"?value.trim():typeof value==="number"?String(value):"";return text&&!uuid.test(text)?text:fallback;}
function numeric(value:unknown){return value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value))?Number(value):null;}
function money(value:unknown){const number=numeric(value);return number===null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(number);}
function number(value:unknown){const n=numeric(value);return n===null?"—":new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(n);}
function format(field:string,value:unknown,values:Values={}){
 if(value===null||value===undefined||value==="")return "—";
 if(typeof value==="boolean")return value?"Yes":"No";
 if(monetary.has(field))return money(value);
 if(percentages.has(field))return `${number(value)}%`;
 if(field==="discount_value")return values.discount_type==="percentage"?`${number(value)}%`:money(value);
 if(typeof value==="object")return "Recorded details";
 const text=financialHistoryText(value,"—");return names[text]??text;
}
function valuesChanged(before:Values,after:Values,source:string){
 return Object.keys(labels).flatMap(key=>{
  if(source==="ticket"&&key==="discount_value"&&(before.discount_amount!==undefined||after.discount_amount!==undefined))return [];
  if(source==="payroll_period_staff_inputs"&&key==="bonus_amount"&&before[key]==null&&numeric(after[key])===0)return [];
  const a=format(key,before[key],before),b=format(key,after[key],after);
  return a===b?[]:[{label:source==="ticket"&&key==="tax_rate"?"Ticket tax":labels[key],before:a,after:b}];
 });
}
const detailText=(detail:FinancialChangeDetail)=>`${detail.label}: ${detail.before} → ${detail.after}`;
function shorten(value:string,max=110){return value.length>max?value.slice(0,max-1)+"…":value;}
function parts(value:unknown){return Array.isArray(value)?value.map(item=>money(isRecord(item)?item.amount:item)).join(" + "):"—";}
function lineName(line:Values){return financialHistoryText(line.service_name??line.service_name_snapshot,"Service");}
function lineKey(line:Values,index:number){const key=line.id??line.line_id;return typeof key==="string"&&key?key:`position:${index}`;}
function serviceChanges(before:Values,after:Values,own:boolean){
 const prior=array(before.lines),next=array(after.lines),oldMap=new Map(prior.map((row,index)=>[lineKey(row,index),row]));
 const nextMap=new Map(next.map((row,index)=>[lineKey(row,index),row]));
 const groups:FinancialChangeGroup[]=[],summaries:string[]=[];
 for(const key of new Set([...oldMap.keys(),...nextMap.keys()])){
  const a=oldMap.get(key),b=nextMap.get(key);
  if(!a&&b){const label=own?"Service added to your work":"Service added";groups.push({title:lineName(b),details:[{label,before:"—",after:`${lineName(b)} · ${money(b.service_total)}`}]});summaries.push(`${lineName(b)} added${own?" to your work":""}: ${money(b.service_total)}`);continue;}
  if(a&&!b){const label=own?"Service removed from your work":"Service removed";groups.push({title:lineName(a),details:[{label,before:`${lineName(a)} · ${money(a.service_total)}`,after:"—"}]});summaries.push(`${lineName(a)} removed${own?" from your work":""}: ${money(a.service_total)}`);continue;}
  if(!a||!b)continue;
  const details:FinancialChangeDetail[]=[];
  const add=(label:string,oldValue:string,newValue:string)=>{if(oldValue!==newValue)details.push({label,before:oldValue,after:newValue});};
  add("Service name",lineName(a),lineName(b));
  add("Service amount",money(a.service_total),money(b.service_total));
  if((a.unit_price!==undefined||b.unit_price!==undefined)&&!(numeric(a.quantity)===1&&numeric(b.quantity)===1&&money(a.unit_price)===money(a.service_total)&&money(b.unit_price)===money(b.service_total)))add("Unit price",money(a.unit_price),money(b.unit_price));
  if(a.quantity!==undefined||b.quantity!==undefined)add("Quantity",number(a.quantity),number(b.quantity));
  if(!own)add("Staff",financialHistoryText(a.staff_name,"Unassigned"),financialHistoryText(b.staff_name,"Unassigned"));
  if((Array.isArray(a.parts)&&a.parts.length>1)||(Array.isArray(b.parts)&&b.parts.length>1)||Array.isArray(a.parts)!==Array.isArray(b.parts)||(Array.isArray(a.parts)&&Array.isArray(b.parts)&&a.parts.length!==b.parts.length))add("Service split",parts(a.parts),parts(b.parts));
  if(a.notes!==undefined||b.notes!==undefined)add("Service note",financialHistoryText(a.notes,"—"),financialHistoryText(b.notes,"—"));
  if(details.length){groups.push({title:lineName(b),details});for(const detail of details){
   if(detail.label==="Unit price"&&details.some(d=>d.label==="Service amount"&&d.before===detail.before&&d.after===detail.after))continue;
   const label=detail.label==="Service amount"?lineName(b):detail.label==="Staff"?`${lineName(b)} staff`:detail.label==="Service split"?`${lineName(b)} split`:detail.label==="Service note"?`${lineName(b)} note`:detail.label;
   summaries.push(detail.label==="Service note"?`${label} updated`:`${label}: ${detail.before} → ${detail.after}`);
  }}
 }
 return {groups,summaries};
}
function paymentChanges(before:Values,after:Values){
 const prior=new Map(array(before.payments).map((p,i)=>[typeof p.id==="string"?p.id:`position:${i}`,p]));
 const next=new Map(array(after.payments).map((p,i)=>[typeof p.id==="string"?p.id:`position:${i}`,p]));
 const details:FinancialChangeDetail[]=[],summaries:string[]=[];
 for(const key of new Set([...prior.keys(),...next.keys()])){
  const a=prior.get(key),b=next.get(key);const payment=b??a!;
  const method=format("method",payment.method),value=money(payment.amount);
  if(!a){details.push({label:"Ticket payment recorded",before:"—",after:`${method} ${value}`});summaries.push(`Ticket payment recorded: ${method} ${value}`);}
  else if(!b){details.push({label:"Ticket payment removed",before:`${method} ${value}`,after:"—"});summaries.push(`Ticket payment removed: ${method} ${value}`);}
  else if(format("method",a.method)!==format("method",b.method)||money(a.amount)!==money(b.amount)){details.push({label:"Ticket payment",before:`${format("method",a.method)} ${money(a.amount)}`,after:`${format("method",b.method)} ${money(b.amount)}`});summaries.push(detailText(details.at(-1)!));}
 }
 return {details,summaries};
}
function ticketFlags(before:Values,after:Values){
 const changes=after.ticket_changes??before.ticket_changes;
 const flags=Array.isArray(changes)?changes.filter((v):v is string=>typeof v==="string"):isRecord(changes)?Object.keys(changes).filter(key=>changes[key]===true):[];
 const text:Record<string,string>={discount:"Ticket discount changed",discount_changed:"Ticket discount changed",tax:"Ticket tax changed",tax_changed:"Ticket tax changed",note:"Ticket note updated",notes:"Ticket note updated",note_changed:"Ticket note updated",service_name:"Service name changed",service_name_changed:"Service name changed",service_price:"Service price changed",service_amount:"Service price changed",service_added:"Service added",service_removed:"Service removed",service_split:"Service split changed",service_note:"Service note updated",staff_assignment:"Staff allocation changed",tip:"Tip allocation changed",status:"Ticket status changed",payment:"Ticket payment changed"};
 return [...new Set(flags.flatMap(flag=>text[flag]?[text[flag]]:[]))];
}
export function isFinancialInputCreation(change:PayrollLiveChange){
 const action=(change as PayrollLiveChange&{event_action?:string}).event_action;
 return change.source_table==="ticket"&&action!=="draft"&&(action==="created"||Object.keys(change.before_values??{}).length===0);
}
export function hasMeaningfulFinancialInputChange(change:PayrollLiveChange){return !(change.source_table==="ticket"&&(change as PayrollLiveChange&{event_action?:string}).event_action==="draft")&&!isFinancialInputCreation(change)&&(change.source_table!=="payroll_period_staff_inputs"||valuesChanged(change.before_values??{},change.after_values??{},change.source_table).length>0);}
export function describeFinancialInputChange(change:PayrollLiveChange):FinancialChangePresentation{
 const before=change.before_values??{},after=change.after_values??{},source=change.source_table,own=Boolean(change.staff_id);
 const ticket=financialHistoryText(after.ticket_number??before.ticket_number);
 let title=({ticket:ticket?`Ticket ${ticket}`:"Ticket change",staff_day:"Daily gross / tip changed",daily_report:"Daily Report changed",payroll_settings:"Pay settings changed",pos_daily_closings:"Earlier Daily Report change",pos_ticket_staff_earnings:"Earlier service / tip change",staff_payroll_settings:"Earlier pay settings change",salon_payroll_settings:"Pay schedule changed",payroll_period_staff_inputs:"Payroll period inputs changed",payroll_live_recorded_payments:"Payroll payment recorded",payroll_recorded_payments:"Payroll payment recorded"} as Record<string,string>)[source]??"Recorded input change";
 if(Object.keys(before).length===0||(change as PayrollLiveChange&{event_action?:string}).event_action==="created"){if(source==="payroll_settings"||source==="staff_payroll_settings")title="Pay settings configured";if(source==="daily_report"||source==="pos_daily_closings")title="Daily Report entered";}
 if((source==="daily_report"||source==="pos_daily_closings")&&before.entered!==true&&after.entered===true)title="Daily Report entered";
 const payrollPayment=source==="payroll_live_recorded_payments"||source==="payroll_recorded_payments";
 let details=payrollPayment?[]:valuesChanged(before,after,source);
 const groups:FinancialChangeGroup[]=[];let summaryParts:string[]=[];
 if(source==="ticket"){
  const services=serviceChanges(before,after,own),payments=paymentChanges(before,after);groups.push(...services.groups);
  if(array(before.lines).length===1&&array(after.lines).length===1)details=details.filter(detail=>detail.label!=="Service sales"||!services.groups.some(group=>group.details.some(line=>line.label==="Service amount"&&line.before===detail.before&&line.after===detail.after)));
  summaryParts.push(...services.summaries);
  const hasService=services.groups.length>0;
  const meaningful=details.filter(detail=>!(hasService&&detail.label==="Service sales")&&!(payments.details.length&&detail.label==="Ticket payments"));
  summaryParts.push(...meaningful.map(detail=>detail.label==="Ticket note"?"Ticket note updated":detailText(detail)));
  summaryParts.push(...payments.summaries);groups.push(...(payments.details.length?[{title:"Ticket payment changes",details:payments.details}]:[]));
  const explained=new Set<string>();
  for(const detail of [...details,...services.groups.flatMap(group=>group.details)]){
   const category=({"Service name":"Service name","Service amount":"Service price","Unit price":"Service price","Service split":"Service split","Service note":"Service note",Staff:"Staff allocation",Tips:"Tip allocation","Customer discount":"Ticket discount","Discount type":"Ticket discount","Discount":"Ticket discount","Ticket tax":"Ticket tax","Ticket status":"Ticket status","Ticket note":"Ticket note"} as Record<string,string>)[detail.label];if(category)explained.add(category);
   if(detail.label.startsWith("Service added"))explained.add("Service added");if(detail.label.startsWith("Service removed"))explained.add("Service removed");
  }
  if(payments.details.length)explained.add("Ticket payment");
  for(const flag of ticketFlags(before,after)){const category=flag.replace(/ changed$| updated$/g,"");if(!explained.has(category)&&!summaryParts.some(text=>text.toLowerCase().includes(category.toLowerCase())))summaryParts.push(flag);}
 }else if(payrollPayment){
  const cash=after.cash_amount??after.cash_paid,check=after.check_amount??after.check_paid;
  summaryParts=[cash!==undefined?`Cash ${money(cash)}`:"",check!==undefined?`Check ${money(check)}`:""].filter(Boolean);
  for(const [label,key] of [["Cash paid","cash_amount"],["Check paid","check_amount"],["Paid at","paid_at"]] as const)if(after[key]!==undefined)details.push({label,before:"—",after:key==="paid_at"?financialHistoryText(after[key],"—"):money(after[key])});
 }else summaryParts=details.map(detail=>detail.label==="Note"?"Note updated":detailText(detail));
 if(!own){
  for(const projection of change.staff_projections??[]){
   const projectionDetails=valuesChanged(projection.before_values,projection.after_values,source);
   if(!projectionDetails.length)continue;
   if((change.staff_projections?.length??0)===1&&JSON.stringify(projection.before_values)===JSON.stringify(before)&&JSON.stringify(projection.after_values)===JSON.stringify(after))continue;
   const staff=financialHistoryText(projection.staff_name,"Staff");groups.push({title:staff,details:projectionDetails});
   if(!summaryParts.length)summaryParts.push(...projectionDetails.map(detail=>`${staff} · ${detailText(detail)}`));
  }
 }
 if(source==="payroll_settings"&&summaryParts.length===1&&details[0]?.label==="Effective from")title="Pay settings effective date changed";
 const incomplete=!summaryParts.length;
 const summary=incomplete?(source.startsWith("pos_")||source==="staff_payroll_settings"?"Earlier input change; detailed before / after values were not recorded.":"The saved record does not contain enough detail to explain this change."):summaryParts.slice(0,3).map(text=>shorten(text)).join(" · ")+(summaryParts.length>3?` · +${summaryParts.length-3} more changes`:"");
 return {title,summary,details,groups,incomplete};
}

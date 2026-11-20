"use client";

import { Fragment, useId, useMemo, useState, type ReactNode } from "react";
import { WorkspaceText, useWorkspaceTranslation } from "@/components/workspace-language";
import type { TaxLine } from "@/types/tax-workspace";
import styles from "./tax-figures-sheet.module.css";

const componentKeys = ["check_wage", "cash_wage", "tip", "bonus"] as const;
const componentLabels = { check_wage: "Check wages", cash_wage: "Cash wages", tip: "Tip", bonus: "Bonus" };
type FigureKey = "check_wage" | "cash_wage" | "reported_wage" | "tip" | "bonus" | "gross" | "tax" | "check_net" | "cash_net";
type Column = { key: FigureKey; label: string; shortLabel: string; group: "gross" | "tax" | "net"; strong?: boolean };
const baseColumns: Column[] = [
  { key: "check_wage", label: "Check wages before withholding", shortLabel: "Check wages", group: "gross" },
  { key: "cash_wage", label: "Cash wages before withholding", shortLabel: "Cash wages", group: "gross" },
  { key: "tip", label: "Tip before withholding", shortLabel: "Tip", group: "gross" },
  { key: "bonus", label: "Bonus before withholding", shortLabel: "Bonus", group: "gross" },
  { key: "gross", label: "Total reported", shortLabel: "Total reported", group: "gross", strong: true },
  { key: "tax", label: "Withheld by salon", shortLabel: "Withheld", group: "tax" },
  { key: "check_net", label: "Check after withholding", shortLabel: "Check net", group: "net", strong: true },
  { key: "cash_net", label: "Cash after withholding", shortLabel: "Cash net", group: "net" },
];
const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatTaxFigure = (amount: number | null | undefined) => amount == null || !Number.isFinite(amount) ? "—" : formatter.format(amount);
const known = (line: TaxLine) => line.breakdown?.state === "published";

/** Display only the published shared DTO. Never derive hidden component values. */
export function taxSheetFigure(line: TaxLine, key: FigureKey): number | null {
  const detail = known(line) ? line.breakdown : undefined;
  if (key === "check_wage" || key === "cash_wage") return detail?.components[key].shown ? detail.components[key].gross : null;
  if (key === "tip" || key === "bonus") return detail ? detail.components[key].shown ? detail.components[key].gross : null : line[key];
  if (key === "reported_wage") return line.reported_wage;
  if (key === "gross") return detail ? detail.totals.gross : line.reported_gross;
  if (key === "tax") return detail ? detail.totals.tax : line.tax;
  if (key === "check_net") return detail ? detail.totals.check_net : line.actual_check;
  return detail?.totals.cash_net ?? null;
}

export function taxSheetTotal(lines: TaxLine[], key: FigureKey): number | null {
  let cents = 0;
  for (const line of lines) {
    const amount = taxSheetFigure(line, key);
    if (amount == null || !Number.isFinite(amount)) return null;
    cents += Math.round(amount * 100);
  }
  return cents / 100;
}

function ComponentBreakdown({ line }: { line: TaxLine }) {
  const historical = !known(line);
  const detail = historical ? undefined : line.breakdown;
  return <div className={styles.breakdown} data-tax-breakdown={line.staff_id}>
    <div className={styles.detailHeading}><strong>{line.name} <span>·</span> <WorkspaceText text="Component details" /></strong><span><WorkspaceText text={historical ? "Historical component detail unavailable" : "Already included in the totals above"} /></span></div>
    {historical && <p className={styles.historicalNote}><WorkspaceText text="This historical report does not include item details. Its original reported figures remain above; a dash means the historical split is unavailable." /></p>}
    <div className={styles.detailScroll}>
      <table className={styles.detailTable} aria-label={`${line.name} component breakdown`}>
        <thead>
          <tr><th scope="col" rowSpan={2}><WorkspaceText text="Component" /></th><th scope="col" rowSpan={2}><WorkspaceText text="Before withholding" /></th><th scope="col" rowSpan={2}><WorkspaceText text="Apply tax" /></th><th scope="col" rowSpan={2}><WorkspaceText text="Rate" /></th><th scope="col" rowSpan={2}><WorkspaceText text="Withheld" /></th><th scope="col" rowSpan={2}><WorkspaceText text="After withholding" /></th><th scope="colgroup" colSpan={3}><WorkspaceText text="Check" /></th><th scope="colgroup" colSpan={3}><WorkspaceText text="Cash" /></th></tr>
          <tr>{["check", "cash"].map(channel => <Fragment key={channel}><th scope="col"><WorkspaceText text="Before withholding" /></th><th scope="col"><WorkspaceText text="Withheld" /></th><th scope="col"><WorkspaceText text="Net amount" /></th></Fragment>)}</tr>
        </thead>
        <tbody>{componentKeys.map(key => {
          const part = detail?.components[key];
          const shown = Boolean(part?.shown);
          return <tr key={key} data-tax-component={key} data-shared={historical ? "unknown" : String(shown)}>
            <th scope="row"><WorkspaceText text={componentLabels[key]} />{!historical && !shown && <small><WorkspaceText text="Not shared" /></small>}</th>
            <td>{formatTaxFigure(shown ? part?.gross : null)}</td>
            <td>{!shown || part?.tax_applied == null ? "—" : <WorkspaceText text={part.tax_applied ? "Yes" : "No"} />}</td>
            <td>{!shown || !part?.tax_applied ? "—" : part.tax_rate != null && Number.isFinite(part.tax_rate) ? `${part.tax_rate}%` : <WorkspaceText text="Mixed rates" />}</td>
            <td>{formatTaxFigure(shown ? part?.tax : null)}</td><td>{formatTaxFigure(shown ? part?.net : null)}</td>
            {(["check_gross", "check_tax", "check_net", "cash_gross", "cash_tax", "cash_net"] as const).map(field => <td key={field} className={field.endsWith("_net") ? styles.netValue : undefined}>{formatTaxFigure(shown ? part?.[field] : null)}</td>)}
          </tr>;
        })}</tbody>
        <tfoot><tr><th scope="row"><WorkspaceText text="Total shared" /></th><td>{formatTaxFigure(detail?.totals.gross)}</td><td>—</td><td>—</td><td>{formatTaxFigure(detail?.totals.tax)}</td><td>{formatTaxFigure(detail?.totals.net)}</td>{(["check_gross", "check_tax", "check_net", "cash_gross", "cash_tax", "cash_net"] as const).map(field => <td key={field}>{formatTaxFigure(detail?.totals[field])}</td>)}</tr></tfoot>
      </table>
    </div>
    <p className={styles.detailNote}><WorkspaceText text="Visibility and Apply tax are independent. A shared amount can have no salon withholding. A dash can mean not shared, mixed rates, or unavailable historical detail." /></p>
  </div>;
}

export function TaxFiguresSheet({ lines, label, renderActions, renderExpandedActions, changedStaffIds }: {
  lines: TaxLine[];
  label?: string;
  renderActions?: (line: TaxLine) => ReactNode;
  renderExpandedActions?: (line: TaxLine) => ReactNode;
  changedStaffIds?: ReadonlySet<string>;
}) {
  const translate = useWorkspaceTranslation();
  const id = useId();
  const [sheet, setSheet] = useState<"report" | "details">("report");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showCash, setShowCash] = useState(true);
  const [showActions, setShowActions] = useState(true);
  const [selected, setSelected] = useState<{ staffId: string; key: FigureKey } | null>(null);
  const historical = useMemo(() => lines.some(line => !known(line)), [lines]);
  const columns = useMemo(() => {
    const all = historical ? [baseColumns[0], baseColumns[1], { key: "reported_wage", label: "Wages reported", shortLabel: "Wages reported", group: "gross" } as Column, ...baseColumns.slice(2)] : baseColumns;
    return showCash ? all : all.filter(column => column.key !== "cash_net");
  }, [historical, showCash]);
  const totals = useMemo(() => new Map(columns.map(column => [column.key, taxSheetTotal(lines, column.key)])), [columns, lines]);
  const lineIndex = useMemo(() => new Map(lines.map(line => [line.staff_id, line])), [lines]);
  const current = selected ? lineIndex.get(selected.staffId) : undefined;
  const currentColumn = columns.find(column => column.key === selected?.key);
  const allExpanded = lines.length > 0 && lines.every(line => expanded.has(line.staff_id));
  const actionsVisible = Boolean(renderActions && showActions);
  const count = 2 + columns.length + Number(actionsVisible);
  const toggle = (staffId: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(staffId)) next.delete(staffId); else next.add(staffId); return next; });
  const rowId = (line: TaxLine) => `${id}-detail-${line.staff_id}`;
  const groupCount = (group: Column["group"]) => columns.filter(column => column.group === group).length;

  return <section className={styles.sheet} data-tax-figures-sheet>
    <div className={styles.tools}>
      <span className={styles.sheetLabel}>{label || <WorkspaceText text="Published tax figures" />}</span>
      <button type="button" className={styles.textButton} onClick={() => setExpanded(allExpanded ? new Set() : new Set(lines.map(line => line.staff_id)))}><WorkspaceText text={allExpanded ? "Collapse all" : "Expand all"} /></button>
      <details className={styles.columnPicker}><summary><WorkspaceText text="Visible columns" /></summary><div><label><input type="checkbox" checked={showCash} onChange={event => setShowCash(event.target.checked)} /><WorkspaceText text="Cash net" /></label>{renderActions && <label><input type="checkbox" checked={showActions} onChange={event => setShowActions(event.target.checked)} /><WorkspaceText text="Paystub" /></label>}</div></details>
    </div>
    <div className={styles.cellBar} aria-label={translate("Selected tax figure")} aria-live="polite"><span className={styles.address}>{current && currentColumn ? `${String.fromCharCode(66 + columns.indexOf(currentColumn))}${lines.indexOf(current) + 2}` : "—"}</span><span className={styles.fx}>fx</span><span>{current && currentColumn ? <>{current.name} <span>·</span> <WorkspaceText text={currentColumn.label} /> <strong>{formatTaxFigure(taxSheetFigure(current, currentColumn.key))}</strong></> : <WorkspaceText text="Select a figure to inspect it. Select an employee to expand the breakdown." />}</span></div>
    <div className={styles.gridWrap} role="region" aria-label={translate("Tax figures spreadsheet")} tabIndex={0}>
      <div role="tabpanel" id={`${id}-report-panel`} aria-labelledby={`${id}-report-tab`} hidden={sheet !== "report"}>{sheet === "report" ? <table className={styles.grid} aria-label={translate("Reported tax figures by employee")}>
        <colgroup><col className={styles.numberColumn} /><col className={styles.employeeColumn} />{columns.map(column => <col key={column.key} />)}{actionsVisible && <col className={styles.actionColumn} />}</colgroup>
        <thead>
          <tr className={styles.letters} aria-hidden="true"><th />{Array.from({ length: count - 1 }, (_, index) => <th key={index}>{String.fromCharCode(65 + index)}</th>)}</tr>
          <tr className={styles.groups}><th rowSpan={2} className={styles.rowNumber}>#</th><th rowSpan={2} className={styles.employeeHead} scope="col"><WorkspaceText text="Employee / legal name" /></th><th scope="colgroup" colSpan={groupCount("gross")}><WorkspaceText text="Before withholding · shared figures" /></th><th scope="colgroup" colSpan={groupCount("tax")}><WorkspaceText text="Withholding" /></th><th scope="colgroup" colSpan={groupCount("net")}><WorkspaceText text="Amount received" /></th>{actionsVisible && <th rowSpan={2} scope="col"><WorkspaceText text="Paystub" /></th>}</tr>
          <tr className={styles.headers}>{columns.map(column => <th scope="col" key={column.key} title={translate(column.label)}><WorkspaceText text={column.shortLabel} /></th>)}</tr>
        </thead>
        <tbody>{lines.map((line, index) => {
          const open = expanded.has(line.staff_id);
          return <Fragment key={line.staff_id}>
            <tr className={open ? styles.openRow : undefined} data-tax-line={line.staff_id}>
              <th className={styles.rowNumber} scope="row">{index + 2}</th>
              <td className={styles.employee}><button type="button" aria-expanded={open} aria-controls={rowId(line)} onClick={() => toggle(line.staff_id)} aria-label={`${translate(open ? "Collapse details for" : "Expand details for")} ${line.name}`}><span aria-hidden="true" className={styles.caret}>{open ? "▾" : "▸"}</span><span><strong>{line.name}</strong><small>{line.legal_name || <WorkspaceText text="Legal name not provided" />}</small>{changedStaffIds?.has(line.staff_id) && <small><WorkspaceText text="Updated amounts · review paystub" /></small>}</span></button>{!known(line) && <small className={styles.historyBadge}><WorkspaceText text="Historical report" /></small>}</td>
              {columns.map(column => <td key={column.key} data-tax-figure={column.key}><button type="button" className={`${styles.number} ${column.strong ? styles.strong : ""} ${selected?.staffId === line.staff_id && selected.key === column.key ? styles.selected : ""}`} aria-label={`${line.name} · ${translate(column.label)} · ${formatTaxFigure(taxSheetFigure(line, column.key))}`} onClick={() => setSelected({ staffId: line.staff_id, key: column.key })}>{formatTaxFigure(taxSheetFigure(line, column.key))}</button></td>)}
              {actionsVisible && <td className={styles.actionCell}>{renderActions?.(line)}</td>}
            </tr>
            {open && <tr className={styles.expandedRow} id={rowId(line)} data-tax-expanded={line.staff_id}><td colSpan={count}><ComponentBreakdown line={line} />{renderExpandedActions && <div className={styles.expandedActions}>{renderExpandedActions(line)}</div>}</td></tr>}
          </Fragment>;
        })}</tbody>
        <tfoot><tr><th colSpan={2}><WorkspaceText text="Total" /> · {lines.length} <WorkspaceText text="employees" /></th>{columns.map(column => <td key={column.key} data-tax-total={column.key}>{formatTaxFigure(totals.get(column.key))}</td>)}{actionsVisible && <td />}</tr></tfoot>
      </table> : null}</div>
      <div className={styles.detailSheet} role="tabpanel" id={`${id}-details-panel`} aria-labelledby={`${id}-details-tab`} hidden={sheet !== "details"}>{sheet === "details" ? lines.map(line => <ComponentBreakdown line={line} key={line.staff_id} />) : null}</div>
    </div>
    <div className={styles.sheetBar} role="tablist" aria-label={translate("Tax figure sheets")} onKeyDown={event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "report" : event.key === "End" ? "details" : sheet === "report" ? "details" : "report";
      setSheet(next);
      event.currentTarget.querySelector<HTMLButtonElement>(`#${CSS.escape(`${id}-${next}-tab`)}`)?.focus();
    }}>
      <button type="button" role="tab" id={`${id}-report-tab`} aria-selected={sheet === "report"} aria-controls={`${id}-report-panel`} tabIndex={sheet === "report" ? 0 : -1} onClick={() => setSheet("report")}><WorkspaceText text="Reported figures" /></button>
      <button type="button" role="tab" id={`${id}-details-tab`} aria-selected={sheet === "details"} aria-controls={`${id}-details-panel`} tabIndex={sheet === "details" ? 0 : -1} onClick={() => setSheet("details")}><WorkspaceText text="Check / Cash details" /></button>
      <span><WorkspaceText text="USD · figures are read only" /></span>
    </div>
    <p className={styles.sheetNote}><WorkspaceText text="Tip and bonus are included in Total reported and the Check / Cash amounts. Do not add them again. A dash means not shared or unavailable; incomplete totals also show a dash." /></p>
  </section>;
}

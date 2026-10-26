"use client";

import { WorkspaceText } from "@/components/workspace-language";
export function PayrollExportButton({ filename, columns, rows }: {
  filename: string;
  columns: string[];
  rows: Array<Array<string | number | null>>;
}) {
  return <button type="button" disabled={rows.length === 0}
    className="min-h-11 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 disabled:opacity-40"
    onClick={() => {
      const escape = (value: string | number | null) => {
        const text = value === null ? "" : String(value);
        // Text cells must not be interpreted as spreadsheet formulas.
        const safe = typeof value === "string" && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
        return `"${safe.replaceAll('"', '""')}"`;
      };
      const csv = [columns, ...rows].map(row => row.map(escape).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}><WorkspaceText text="Export CSV" /></button>;
}

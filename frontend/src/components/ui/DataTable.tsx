import type { ReactNode } from "react";
import { Skeleton } from "./feedback";

export type Column<T> = { label: string; className?: string; cell: (row: T) => ReactNode };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  busy = false,
  loading = false,
  empty = "Nothing to show yet.",
  className = "mt-6",
  minWidth = "min-w-[720px]",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  busy?: boolean;
  loading?: boolean;
  empty?: ReactNode;
  className?: string;
  minWidth?: string;
}) {
  return (
    <div className={`overflow-x-auto rounded-2xl border border-border bg-surface ${busy ? "opacity-70" : ""} ${className}`} aria-busy={busy || loading || undefined}>
      <table className={`w-full ${minWidth} border-collapse text-left text-sm`}>
        <thead className="sticky top-0">
          <tr className="border-b border-border bg-surface-2 text-xs uppercase tracking-wide text-fg-muted">
            {columns.map((column, index) => (
              <th key={`${column.label}-${index}`} scope="col" className={`whitespace-nowrap px-3 py-3 font-medium ${column.className ?? ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: 4 }, (_, row) => (
                <tr key={`loading-${row}`} className="border-b border-border/60 last:border-0">
                  {columns.map((column, index) => (
                    <td key={`${column.label}-${index}`} className="px-3 py-3">
                      <Skeleton className="h-4 w-full max-w-32" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr key={rowKey(row)} className="border-b border-border/60 transition-colors last:border-0 hover:bg-fg/[0.03]">
                  {columns.map((column, index) => (
                    <td key={`${column.label}-${index}`} className={`px-3 py-3 align-middle text-fg ${column.className ?? ""}`}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
          {!loading && rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-fg-muted">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

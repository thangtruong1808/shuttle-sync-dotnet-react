import { useState, type ReactNode } from "react";
import { Button } from "../../components/ui";

export const control =
  "w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-mist disabled:cursor-not-allowed disabled:opacity-60";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-mist/80">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100" role="alert">
      {message}
    </p>
  );
}

export function Success({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-xl border border-line/40 bg-line/10 px-3 py-2 text-sm text-line" role="status">
      {message}
    </p>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  }
  return { busy, run };
}

export type PageMove = number | "prev" | "next";

function pageWindow(current: number, pages: number): (number | "gap")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index + 1);
  const start = Math.max(2, current - 1);
  const end = Math.min(pages - 1, current + 1);
  const items: (number | "gap")[] = [1];
  if (start > 2) items.push("gap");
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < pages - 1) items.push("gap");
  items.push(pages);
  return items;
}

export function Pager({
  page,
  pageSize,
  total,
  busy = null,
  pending = null,
  locked = false,
  numbered = false,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  busy?: string | null;
  pending?: PageMove | null;
  locked?: boolean;
  numbered?: boolean;
  onPage: (page: number, key: "prev" | "next" | "page") => void;
}) {
  const pages = Math.max(1, Math.ceil(total / Math.max(pageSize, 1)));
  if (!numbered && total <= pageSize) return null;
  if (!numbered) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" loading={busy === "prev"} disabled={page <= 1 || busy !== null} onClick={() => onPage(page - 1, "prev")}>
          Previous
        </Button>
        <span className="text-sm text-mist/70">
          {page} / {pages}
        </span>
        <Button variant="secondary" loading={busy === "next"} disabled={page >= pages || busy !== null} onClick={() => onPage(page + 1, "next")}>
          Next
        </Button>
      </div>
    );
  }

  const moving = pending !== null || locked;
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-mist/70" aria-live="polite">
        Page {page} of {pages}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" loading={pending === "prev"} disabled={page <= 1 || moving} onClick={() => onPage(page - 1, "prev")}>
          Previous
        </Button>
        {pageWindow(page, pages).map((item, index) =>
          item === "gap" ? (
            <span key={`gap-${index}`} className="px-1 text-mist/40" aria-hidden="true">…</span>
          ) : (
            <Button
              key={item}
              variant={item === page ? "primary" : "secondary"}
              className="min-w-10 px-2.5"
              aria-label={`Page ${item}`}
              aria-current={item === page ? "page" : undefined}
              loading={pending === item}
              disabled={item === page || moving}
              onClick={() => onPage(item, "page")}
            >
              {item}
            </Button>
          ),
        )}
        <Button variant="secondary" loading={pending === "next"} disabled={page >= pages || moving} onClick={() => onPage(page + 1, "next")}>
          Next
        </Button>
      </div>
    </div>
  );
}

export const pageSizes = [10, 20, 50] as const;

export function PageSummary({
  page,
  pageSize,
  total,
  pendingSize = null,
  locked = false,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  pendingSize?: number | null;
  locked?: boolean;
  onPageSize: (size: number) => void;
}) {
  const size = Math.max(pageSize, 1);
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  const moving = pendingSize !== null || locked;
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-white" aria-live="polite">
        View {from}–{to} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {pageSizes.map((option) => (
          <Button
            key={option}
            variant={option === pageSize ? "primary" : "secondary"}
            aria-label={`View ${option} per page`}
            aria-pressed={option === pageSize}
            loading={pendingSize === option}
            disabled={option === pageSize || moving}
            onClick={() => onPageSize(option)}
          >
            {option}
          </Button>
        ))}
        <span className="text-sm text-mist/80">per page</span>
      </div>
    </div>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  busy = false,
}: {
  columns: { label: string; className?: string; cell: (row: T) => ReactNode }[];
  rows: T[];
  rowKey: (row: T) => string;
  busy?: boolean;
}) {
  return (
    <div className={`mt-6 overflow-x-auto rounded-2xl border border-white/10 ${busy ? "opacity-70" : ""}`} aria-busy={busy || undefined}>
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 bg-white/[0.04] text-xs uppercase tracking-wide text-mist/55">
            {columns.map((column, index) => (
              <th key={`${column.label}-${index}`} scope="col" className={`whitespace-nowrap px-3 py-3 font-medium ${column.className ?? ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
              {columns.map((column, index) => (
                <td key={`${column.label}-${index}`} className={`px-3 py-3 align-middle text-mist ${column.className ?? ""}`}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tag({ value }: { value: string }) {
  return <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs capitalize text-mist">{value.replace(/_/g, " ")}</span>;
}

export function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-mist">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

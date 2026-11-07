import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert, Badge, Button } from "../../components/ui";

export const control =
  "min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base sm:text-sm text-fg shadow-sm outline-none transition-colors focus:border-accent-text focus:ring-2 focus:ring-accent-text/20 disabled:cursor-not-allowed disabled:opacity-60";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-fg/80">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export function Notice({ message }: { message: string | null }) {
  if (!message) return null;
  return <Alert tone="danger">{message}</Alert>;
}

export function Success({ message }: { message: string | null }) {
  if (!message) return null;
  return <Alert tone="success">{message}</Alert>;
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
        <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />} loading={busy === "prev"} disabled={page <= 1 || busy !== null} onClick={() => onPage(page - 1, "prev")}>
          Previous
        </Button>
        <span className="text-sm text-fg/70">
          {page} / {pages}
        </span>
        <Button variant="secondary" icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />} loading={busy === "next"} disabled={page >= pages || busy !== null} onClick={() => onPage(page + 1, "next")}>
          Next
        </Button>
      </div>
    );
  }

  const moving = pending !== null || locked;
  return (
    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-fg/70" aria-live="polite">
        Page {page} of {pages}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />} loading={pending === "prev"} disabled={page <= 1 || moving} onClick={() => onPage(page - 1, "prev")}>
          Previous
        </Button>
        {pageWindow(page, pages).map((item, index) =>
          item === "gap" ? (
            <span key={`gap-${index}`} className="px-1 text-fg/40" aria-hidden="true">…</span>
          ) : (
            <Button
              key={item}
              variant={item === page ? "primary" : "secondary"}
              className="min-w-11 px-2.5"
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
        <Button variant="secondary" icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />} loading={pending === "next"} disabled={page >= pages || moving} onClick={() => onPage(page + 1, "next")}>
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
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-border bg-inset px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium text-fg" aria-live="polite">
        View {from}–{to} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {pageSizes.map((option) => (
          <Button
            key={option}
            variant={option === pageSize ? "primary" : "secondary"}
            className="min-w-11 px-2.5"
            aria-label={`View ${option} per page`}
            aria-pressed={option === pageSize}
            loading={pendingSize === option}
            disabled={option === pageSize || moving}
            onClick={() => onPageSize(option)}
          >
            {option}
          </Button>
        ))}
        <span className="text-sm text-fg/80">per page</span>
      </div>
    </div>
  );
}

export { DataTable } from "../../components/ui";

export function Tag({ value }: { value: string }) {
  const tone = value === "confirmed" || value === "active" || value === "succeeded" || value === "paid" ? "success"
    : value === "pending" || value === "processing" ? "warning"
    : value === "cancelled" || value === "canceled" || value === "failed" || value === "no_show" || value === "expired" ? "danger"
    : "neutral";
  return <Badge tone={tone} className="capitalize">{value.replace(/_/g, " ")}</Badge>;
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
    <label className="flex min-h-11 cursor-pointer items-center gap-2 py-1 text-sm text-fg">
      <input type="checkbox" className="h-4 w-4 shrink-0 accent-accent-text" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

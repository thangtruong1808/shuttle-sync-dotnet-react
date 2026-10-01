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

export function Pager({
  page,
  pageSize,
  total,
  busy,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  busy: string | null;
  onPage: (page: number, key: "prev" | "next") => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
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

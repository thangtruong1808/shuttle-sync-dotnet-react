import type { ReactNode } from "react";

export const summaryAside =
  "rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5 lg:sticky lg:top-24";

export const summaryLines = "grid gap-1.5 text-sm tabular-nums text-fg-muted";

export function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:p-5">
      <h2 className="flex items-center gap-3 font-display text-lg font-semibold text-fg">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-fg">{index}</span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function PayBar({ total, children }: { total?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="h-28 lg:hidden" aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 p-4 backdrop-blur lg:static lg:z-auto lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        {total ? <div className="mb-2 flex items-center justify-between gap-3 text-sm font-semibold tabular-nums text-fg lg:hidden">{total}</div> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{children}</div>
      </div>
    </>
  );
}

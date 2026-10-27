import { useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState, ErrorState } from "../../components/format";
import { PageHeader, Skeleton } from "../../components/ui";
import { dashboardVenues, type Venue } from "../venues/venueApi";
import { DashError, type DashPage } from "./dashboardApi";
import { DataTable, PageSummary, Pager, Success, useBusy, type PageMove } from "./dashboardUi";

export function useVenueOptions() {
  const [venues, setVenues] = useState<Venue[]>([]);
  useEffect(() => {
    dashboardVenues().then(setVenues).catch(() => setVenues([]));
  }, []);
  return venues;
}

export function Shell<T>({
  title,
  refreshKey,
  load,
  render,
  columns,
  rowKey,
  extra,
  locked = false,
  onSettled,
}: {
  title: string;
  refreshKey: string;
  load: (page: number, pageSize: number) => Promise<DashPage<T>>;
  render?: (item: T, done: (message: string) => void) => ReactNode;
  columns?: { label: string; className?: string; cell: (item: T, done: (message: string) => void) => ReactNode }[];
  rowKey?: (item: T) => string;
  extra?: ReactNode;
  locked?: boolean;
  onSettled?: () => void;
}) {
  const [page, setPage] = useState(1);
  const [seen, setSeen] = useState(refreshKey);
  const [data, setData] = useState<DashPage<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState<PageMove | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [pendingSize, setPendingSize] = useState<number | null>(null);
  const { busy, run } = useBusy();
  const loadRef = useRef(load);
  const settledRef = useRef(onSettled);
  loadRef.current = load;
  settledRef.current = onSettled;
  if (seen !== refreshKey) {
    setSeen(refreshKey);
    setPage(1);
    setPending(null);
  }

  useEffect(() => {
    let active = true;
    setError(null);
    loadRef.current(page, pageSize)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "The list could not be loaded.");
      })
      .finally(() => {
        if (!active) return;
        setRetrying(false);
        setPending(null);
        setPendingSize(null);
        settledRef.current?.();
      });
    return () => {
      active = false;
    };
  }, [attempt, page, pageSize, refreshKey]);

  const done = (note: string) => {
    setSuccess(note);
    setAttempt((value) => value + 1);
  };
  const table = columns && rowKey;

  return (
    <div>
      <PageHeader title={title} />
      <div className="mt-4"><Success message={success} /></div>
      {extra}
      {table && data && !error ? (
        <PageSummary
          page={page}
          pageSize={pageSize}
          total={data.total}
          pendingSize={pendingSize}
          locked={locked || pending !== null}
          onPageSize={(size) => {
            if (size === pageSize || pendingSize !== null || pending !== null || locked) return;
            setPendingSize(size);
            setPending(null);
            setPage(1);
            setPageSize(size);
          }}
        />
      ) : null}
      {error ? (
        <div className="mt-6"><ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /></div>
      ) : data === null ? (
        <div className="mt-6" aria-busy="true"><span className="sr-only">Loading {title}</span><Skeleton className="h-40" /></div>
      ) : data.items.length === 0 ? (
        <div className="mt-6"><EmptyState title="Nothing here" body="Records will show up after they exist." /></div>
      ) : table ? (
        <DataTable busy={pending !== null || pendingSize !== null || locked} rows={data.items} rowKey={rowKey} columns={columns.map((column) => ({ ...column, cell: (item: T) => column.cell(item, done) }))} />
      ) : (
        <ul className="mt-6 grid gap-2">{data.items.map((item) => render?.(item, done))}</ul>
      )}
      {!error && data && data.total > 0 ? (
        table ? (
          <Pager
            numbered
            page={page}
            pageSize={data.pageSize}
            total={data.total}
            pending={pending}
            locked={locked || pendingSize !== null}
            onPage={(next, key) => {
              if (next === page || pending !== null || pendingSize !== null || locked) return;
              setPending(key === "page" ? next : key);
              setPage(next);
            }}
          />
        ) : (
          <Pager page={page} pageSize={data.pageSize} total={data.total} busy={busy} onPage={(next, key) => { void run(key === "page" ? "next" : key, async () => setPage(next)); }} />
        )
      ) : null}
    </div>
  );
}

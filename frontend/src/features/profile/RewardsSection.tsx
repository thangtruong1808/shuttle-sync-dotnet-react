import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { Clock, History } from "lucide-react";
import type { AppDispatch } from "../../app/store";
import { Badge, DataTable, PageHeader, Skeleton, StatCard } from "../../components/ui";
import { EmptyState, ErrorState, formatVenueDateTime, formatVenueDay, formatVenueRange } from "../../components/format";
import { loadCurrentUser } from "../auth/authSlice";
import { myRewards, type Page, type PendingReward, type RewardRow } from "./profileApi";
import { ListPager } from "./ListPager";

export function RewardsSection() {
  const dispatch = useDispatch<AppDispatch>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(5);
  const [data, setData] = useState<(Page<RewardRow> & { balance: number; pending: number; pendingItems: PendingReward[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pageMove, setPageMove] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    myRewards(page, pageSize)
      .then((next) => {
        if (active) {
          setData(next);
          setError(null);
          void dispatch(loadCurrentUser());
        }
      })
      .catch(() => {
        if (active) setError("Rewards could not be loaded.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setPageMove(null);
        }
      });
    return () => {
      active = false;
    };
  }, [page, pageSize, attempt, dispatch]);

  return (
    <div>
      <PageHeader title="Reward points" description="Available points can be used now. Pending points wait for a court, a public social, a friend, or your next completed visit after a comeback note." />
      {error ? (
        <div className="mt-4"><ErrorState message={error} loading={loading} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} /></div>
      ) : loading && pageMove === null ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-busy="true"><span className="sr-only">Loading rewards</span><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Available" value={data.balance} hint="Ready to use on a booking." />
            <StatCard label="Pending" value={data.pending ?? 0} hint="Waiting until the session ends." />
          </div>
          <h2 className="mt-8 flex items-center gap-2 font-display text-2xl text-fg"><Clock className="h-5 w-5 text-accent-text" aria-hidden="true" />Pending</h2>
          <RewardTable
            caption="Pending reward points"
            rows={slicePage(data.pendingItems ?? [], pendingPage, pendingPageSize).map((item) => ({
              id: `${item.kind}-${item.id}`,
              kind: item.kind,
              when: item.kind === "Comeback" ? "Waiting" : formatVenueDay(item.startTime, item.timeZone),
              whenNote: item.kind === "Comeback" ? "After your next completed visit" : "After the session ends",
              venueName: item.venueName,
              courtName: item.kind === "Comeback" ? "Comeback reward" : item.courtName,
              session: item.kind === "Comeback" ? "Joins your balance then" : formatVenueRange(item.startTime, item.endTime, item.timeZone),
              points: item.points,
              courtCount: item.courtCount,
              cancelledCourts: item.cancelledCourts,
              cancelledCourtNames: item.cancelledCourtNames,
              status: "Pending",
            }))}
            emptyTitle="No points are waiting"
            emptyBody="A court, public social, or friend spot with an incentive shows up here until that session ends."
          />
          <ListPager
            page={pendingPage}
            pageSize={pendingPageSize}
            total={(data.pendingItems ?? []).length}
            loading={false}
            pageMove={null}
            onPage={(next) => setPendingPage(next)}
            onPageSize={(size) => { setPendingPageSize(size); setPendingPage(1); }}
          />
          <h2 className="mt-8 flex items-center gap-2 font-display text-2xl text-fg"><History className="h-5 w-5 text-accent-text" aria-hidden="true" />History</h2>
          <RewardTable
            caption="Reward point history"
            rows={data.items.map((row) => ({
              id: row.id,
              kind: row.kind || "Reward",
              when: formatVenueDateTime(row.awardedAt, row.timeZone),
              venueName: row.venueName,
              courtName: row.courtName,
              session: formatVenueRange(row.startTime, row.endTime, row.timeZone),
              points: row.points,
              courtCount: row.courtCount,
              cancelledCourts: row.cancelledCourts,
              cancelledCourtNames: row.cancelledCourtNames,
              status: "Added",
            }))}
            emptyTitle="No points yet"
            emptyBody="Points appear here after a session with an active incentive ends."
          />
          <ListPager
            page={page}
            pageSize={data.pageSize || pageSize}
            total={data.total}
            loading={loading}
            pageMove={pageMove}
            onPage={(next, move) => { setLoading(true); setPageMove(move); setPage(next); }}
            onPageSize={(size) => { setLoading(true); setPageMove(`size-${size}`); setPageSize(size); setPage(1); }}
          />
        </>
      ) : null}
    </div>
  );
}

function slicePage<T>(items: T[], page: number, pageSize: number) {
  const start = Math.max(0, (page - 1) * pageSize);
  return items.slice(start, start + pageSize);
}

type RewardTableRow = {
  id: string;
  kind: string;
  when: string;
  whenNote?: string;
  venueName: string;
  courtName: string;
  session: string;
  points: number;
  status: string;
  courtCount?: number;
  cancelledCourts?: number;
  cancelledCourtNames?: string | null;
};

function RewardCourts({ row }: { row: RewardTableRow }) {
  const courts = row.courtCount ?? 1;
  if (courts <= 1) return <p className="text-sm text-fg/75">{row.courtName}</p>;
  return (
    <div className="max-w-[16rem]">
      <p className="text-sm font-medium text-fg">{courts} courts</p>
      <p className="text-xs leading-5 text-fg/60">{row.courtName}</p>
    </div>
  );
}

function RewardPoints({ row, align = "left" }: { row: RewardTableRow; align?: "left" | "right" }) {
  const courts = row.courtCount ?? 1;
  const cancelled = row.cancelledCourts ?? 0;
  return (
    <div className={`max-w-[14rem] ${align === "right" ? "shrink-0 text-right" : ""}`}>
      <p className="whitespace-nowrap font-semibold text-accent-text">+{row.points}</p>
      {courts > 1 ? <p className="whitespace-nowrap text-xs text-fg/60">Total for {courts} courts</p> : null}
      {cancelled > 0 ? (
        <p className="text-xs leading-5 text-amber-700 dark:text-amber-300">
          {cancelled} {cancelled === 1 ? "court" : "courts"} cancelled, no points{row.cancelledCourtNames ? `: ${row.cancelledCourtNames}` : ""}
        </p>
      ) : null}
    </div>
  );
}

function RewardTable({
  caption,
  rows,
  emptyTitle,
  emptyBody,
}: {
  caption: string;
  rows: RewardTableRow[];
  emptyTitle: string;
  emptyBody: string;
}) {
  if (rows.length === 0) {
    return <div className="mt-4"><EmptyState title={emptyTitle} body={emptyBody} /></div>;
  }
  return (
    <div>
      <h3 className="sr-only">{caption}</h3>
      <DataTable
        className="mt-4"
        minWidth="min-w-[52rem]"
        rows={rows}
        rowKey={(row) => row.id}
        columns={[
          { label: "Type", cell: (row) => row.kind },
          {
            label: "When",
            cell: (row) => row.whenNote ? (<><span className="block whitespace-nowrap">{row.when}</span><span className="block text-xs text-fg-muted">{row.whenNote}</span></>) : row.when,
          },
          { label: "Venue", cell: (row) => row.venueName },
          { label: "Court", cell: (row) => <RewardCourts row={row} /> },
          { label: "Session", cell: (row) => row.session },
          { label: "Status", cell: (row) => <Badge tone={row.status === "Added" ? "success" : row.status === "Pending" ? "warning" : "neutral"}>{row.status}</Badge> },
          { label: "Points", cell: (row) => <RewardPoints row={row} /> },
        ]}
      />
    </div>
  );
}

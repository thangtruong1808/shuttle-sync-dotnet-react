import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { CalendarClock, ChevronLeft, ChevronRight, Clock, CreditCard, History, LogOut, Undo2 } from "lucide-react";
import type { AppDispatch, RootState } from "../../app/store";
import { Button, Skeleton } from "../../components/ui";
import { EmptyState, ErrorState, formatVenueDateTime, formatVenueDay, formatVenueRange } from "../../components/format";
import { externalLogins, type ExternalLogin } from "../auth/authApi";
import { fetchSessions, loadCurrentUser, logoutOthers, revokeSession } from "../auth/authSlice";
import { myPayments, myRewards, type Page, type PaymentRow, type PendingReward, type RewardRow } from "./profileApi";

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
      <h1 className="font-display text-3xl text-white">Reward points</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mist/75">Available points can be used now. Pending points are set aside for a court, a public social, or a friend, and they join your balance after that session ends.</p>
      {error ? (
        <div className="mt-4"><ErrorState message={error} loading={loading} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} /></div>
      ) : loading && pageMove === null ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2" aria-busy="true"><span className="sr-only">Loading rewards</span><Skeleton className="h-28" /><Skeleton className="h-28" /></div>
      ) : data ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <article className="rounded-3xl border border-white/10 bg-pine/80 p-4">
              <p className="text-sm text-mist/70">Available</p>
              <p className="mt-1 font-display text-4xl text-line">{data.balance}</p>
              <p className="mt-1 text-sm text-mist/65">Ready to use on a booking.</p>
            </article>
            <article className="rounded-3xl border border-line/30 bg-line/10 p-4">
              <p className="text-sm font-medium text-line">Pending</p>
              <p className="mt-1 font-display text-4xl text-white">{data.pending ?? 0}</p>
              <p className="mt-1 text-sm text-mist/75">Waiting until the session ends.</p>
            </article>
          </div>
          <h2 className="mt-8 flex items-center gap-2 font-display text-2xl text-white"><Clock className="h-5 w-5 text-line" aria-hidden="true" />Pending</h2>
          <RewardTable
            caption="Pending reward points"
            rows={slicePage(data.pendingItems ?? [], pendingPage, pendingPageSize).map((item) => ({
              id: `${item.kind}-${item.id}`,
              kind: item.kind,
              when: formatVenueDay(item.startTime, item.timeZone),
              whenNote: "After the session ends",
              venueName: item.venueName,
              courtName: item.courtName,
              session: formatVenueRange(item.startTime, item.endTime, item.timeZone),
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
          <h2 className="mt-8 flex items-center gap-2 font-display text-2xl text-white"><History className="h-5 w-5 text-line" aria-hidden="true" />History</h2>
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

export function PaymentsSection() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [data, setData] = useState<Page<PaymentRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pageMove, setPageMove] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    myPayments(page, pageSize)
      .then((next) => {
        if (active) {
          setData(next);
          setError(null);
        }
      })
      .catch(() => {
        if (active) setError("Payments could not be loaded.");
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
  }, [page, pageSize, attempt]);

  return (
    <div>
      <h1 className="font-display text-3xl text-white">Payments and refunds</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mist/75">Every card charge and refund for your courts and public socials. Refunds go back to the card you paid with and can take 5–10 business days to appear.</p>
      {error ? (
        <div className="mt-4"><ErrorState message={error} loading={loading} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} /></div>
      ) : loading && pageMove === null ? (
        <div className="mt-4 space-y-3" aria-busy="true"><span className="sr-only">Loading payments</span><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : data && data.items.length > 0 ? (
        <>
          <PaymentTable rows={data.items} />
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
      ) : (
        <div className="mt-4"><EmptyState title="No payments yet" body="Card charges and refunds for your courts and public socials will be listed here." /></div>
      )}
    </div>
  );
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: currency || "AUD" }).format(amount);
}

function paymentSession(row: PaymentRow) {
  if (!row.startTime || !row.endTime || Number.isNaN(Date.parse(row.startTime))) {
    return "—";
  }
  return `${formatVenueDay(row.startTime, row.timeZone)}, ${formatVenueRange(row.startTime, row.endTime, row.timeZone)}`;
}

function paymentStatus(row: PaymentRow) {
  const status = row.status.toLowerCase();
  if (status === "succeeded" || status === "paid" || status === "completed") {
    return { label: row.kind === "refund" ? "Refunded" : "Paid", tone: "bg-line/15 text-line" };
  }
  if (status === "pending" || status === "processing" || status === "requires_action") {
    return { label: "Processing", tone: "bg-amber-400/15 text-amber-200" };
  }
  if (status === "failed" || status === "canceled" || status === "cancelled") {
    return { label: status === "failed" ? "Failed" : "Cancelled", tone: "bg-rose-500/15 text-rose-200" };
  }
  if (status.includes("refund")) {
    return { label: status.startsWith("partial") ? "Partly refunded" : "Refunded", tone: "bg-sky-400/15 text-sky-200" };
  }
  const label = status.replace(/_/g, " ");
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone: "bg-white/10 text-mist" };
}

function PaymentStatusCell({ row }: { row: PaymentRow }) {
  const status = paymentStatus(row);
  const refunded = row.refundedAmount ?? 0;
  if (row.kind === "refund" || refunded <= 0 || !row.status.toLowerCase().includes("refund")) {
    return <span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>;
  }
  const kept = Math.max(0, row.amount - refunded);
  return (
    <span className="block whitespace-nowrap">
      <span className="font-semibold text-sky-200">{formatMoney(refunded, row.currency)} refunded</span>
      <span className="mt-0.5 block text-xs text-mist/60">
        {status.label}
        {kept > 0 ? ` · ${formatMoney(kept, row.currency)} kept` : ""}
      </span>
    </span>
  );
}

function PaymentTable({ rows }: { rows: PaymentRow[] }) {
  return (
    <div className="mt-4">
      <ul className="grid gap-3 md:hidden">
        {rows.map((row) => {
          const refund = row.kind === "refund";
          return (
            <li key={`${row.kind}-${row.id}`} className="rounded-2xl border border-white/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${refund ? "text-sky-200" : "text-line"}`}>
                    {refund ? <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> : <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />}
                    {refund ? "Refund" : "Payment"}{row.source ? ` · ${row.source}` : ""}
                  </p>
                  <p className="mt-1 font-medium text-white">{row.venueName}</p>
                  <p className="text-sm text-mist/75">{row.courtNames || "Court to be assigned"}</p>
                </div>
                <p className={`shrink-0 font-semibold ${refund ? "text-sky-200" : "text-white"}`}>{refund ? "+" : ""}{formatMoney(row.amount, row.currency)}</p>
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-mist/75"><CalendarClock className="h-4 w-4 shrink-0 text-mist/60" aria-hidden="true" />{paymentSession(row)}</p>
              <p className="text-sm text-mist/60">{refund ? "Refunded" : ["succeeded", "refunded", "partially_refunded"].includes(row.status.toLowerCase()) ? "Charged" : "Started"} {formatVenueDateTime(row.occurredAt, row.timeZone)}</p>
              <div className="mt-2">
                <PaymentStatusCell row={row} />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <caption className="sr-only">Payments and refunds</caption>
          <thead className="text-mist/60">
            <tr>
              <th className="py-2 pr-3 font-medium">Type</th>
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 font-medium">Venue and court</th>
              <th className="py-2 pr-3 font-medium">Session</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const refund = row.kind === "refund";
              return (
                <tr key={`${row.kind}-${row.id}`} className="border-t border-white/10 align-top">
                  <td className="py-3 pr-3">
                    <span className={`flex items-center gap-1.5 font-medium ${refund ? "text-sky-200" : "text-white"}`}>
                      {refund ? <Undo2 className="h-4 w-4" aria-hidden="true" /> : <CreditCard className="h-4 w-4 text-line" aria-hidden="true" />}
                      {refund ? "Refund" : "Payment"}
                    </span>
                    <span className="mt-0.5 block text-xs text-mist/60">{row.source}</span>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3">{formatVenueDateTime(row.occurredAt, row.timeZone)}</td>
                  <td className="py-3 pr-3">
                    <span className="block text-white">{row.venueName}</span>
                    <span className="mt-0.5 block text-xs text-mist/70">
                      {row.courtNames || "Court to be assigned"}
                      {row.courtCount > 1 ? ` · ${row.courtCount} courts` : ""}
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3">{paymentSession(row)}</td>
                  <td className="py-3 pr-3">
                    <PaymentStatusCell row={row} />
                  </td>
                  <td className={`whitespace-nowrap py-3 text-right font-semibold ${refund ? "text-sky-200" : "text-white"}`}>{refund ? "+" : ""}{formatMoney(row.amount, row.currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SecuritySection() {
  const dispatch = useDispatch<AppDispatch>();
  const sessions = useSelector((state: RootState) => state.auth.sessions);
  const sessionsStatus = useSelector((state: RootState) => state.auth.sessionsStatus);
  const [logins, setLogins] = useState<ExternalLogin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    void dispatch(fetchSessions());
    externalLogins().then(setLogins).catch(() => setError("Linked accounts could not be loaded."));
  }, [dispatch]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-white">Security</h1>
        <h2 className="mt-6 text-lg font-semibold text-white">Linked accounts</h2>
        {error ? (
          <div className="mt-3">
            <ErrorState
              message={error}
              loading={pending === "logins"}
              onRetry={() => {
                setPending("logins");
                externalLogins()
                  .then((items) => {
                    setLogins(items);
                    setError(null);
                  })
                  .catch(() => setError("Linked accounts could not be loaded."))
                  .finally(() => setPending((current) => (current === "logins" ? null : current)));
              }}
            />
          </div>
        ) : logins === null ? (
          <div className="mt-3" aria-busy="true"><span className="sr-only">Loading linked accounts</span><Skeleton className="h-12" /></div>
        ) : null}
        {logins && logins.length === 0 ? <p className="mt-2 text-sm text-mist/70">No Google or GitHub account is linked.</p> : null}
        <ul className="mt-3 space-y-2">
          {(logins ?? []).map((login) => (
            <li key={login.provider} className="rounded-xl border border-white/10 px-3 py-2 text-sm">
              <span className="font-medium capitalize text-white">{login.provider}</span>
              <span className="ml-2 text-mist/65">{login.emailAtLink}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-white">Devices</h2>
          <Button
            variant="secondary"
            icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
            loading={pending === "others"}
            disabled={pending !== null && pending !== "others" && pending !== "logins"}
            onClick={() => {
              setPending("others");
              void dispatch(logoutOthers()).finally(() => setPending(null));
            }}
          >
            Sign out all other devices
          </Button>
        </div>
        {sessionsStatus === "loading" ? (
          <div className="mt-3" aria-busy="true"><Skeleton className="h-20" /></div>
        ) : sessions.length === 0 ? (
          <div className="mt-3"><EmptyState title="No active devices" body="Sessions appear after you sign in." /></div>
        ) : (
          <ul className="mt-3 space-y-3">
            {sessions.map((session) => (
              <li key={session.id} className="rounded-2xl border border-white/10 px-4 py-3 text-sm">
                <p className="font-medium text-white">{session.isCurrent ? "This device" : "Other device"}</p>
                <p className="mt-1 text-mist/65">{session.userAgent ?? "Unknown browser"}</p>
                <p className="text-mist/65">{session.ipAddress ?? "Unknown address"} · {new Date(session.lastUsedAt).toLocaleString()}</p>
                <Button
                  className="mt-3"
                  variant="danger"
                  icon={<LogOut className="h-4 w-4" aria-hidden="true" />}
                  loading={pending === session.id}
                  disabled={pending !== null && pending !== session.id && pending !== "logins"}
                  onClick={() => {
                    setPending(session.id);
                    void dispatch(revokeSession(session.id)).finally(() => setPending(null));
                  }}
                >
                  Sign out this device
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const rewardPageSizes = [5, 10, 20, 50] as const;

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
  if (courts <= 1) return <p className="text-sm text-mist/75">{row.courtName}</p>;
  return (
    <div className="max-w-[16rem]">
      <p className="text-sm font-medium text-white">{courts} courts</p>
      <p className="text-xs leading-5 text-mist/60">{row.courtName}</p>
    </div>
  );
}

function RewardPoints({ row, align = "left" }: { row: RewardTableRow; align?: "left" | "right" }) {
  const courts = row.courtCount ?? 1;
  const cancelled = row.cancelledCourts ?? 0;
  return (
    <div className={`max-w-[14rem] ${align === "right" ? "shrink-0 text-right" : ""}`}>
      <p className="whitespace-nowrap font-semibold text-line">+{row.points}</p>
      {courts > 1 ? <p className="whitespace-nowrap text-xs text-mist/60">Total for {courts} courts</p> : null}
      {cancelled > 0 ? (
        <p className="text-xs leading-5 text-amber-300">
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
    <div className="mt-4">
      <ul className="grid gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl border border-white/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-line">{row.kind}</p>
                <p className="mt-1 font-medium text-white">{row.venueName}</p>
                <RewardCourts row={row} />
              </div>
              <RewardPoints row={row} align="right" />
            </div>
            <p className="mt-2 text-sm text-mist/70">{row.session}</p>
            <p className="text-sm text-mist/60">{row.when}{row.whenNote ? <span className="block text-xs text-mist/50">{row.whenNote}</span> : null}</p>
            <p className="mt-2">
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === "Added" ? "bg-line/15 text-line" : "bg-white/10 text-mist"}`}>{row.status}</span>
            </p>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-mist/60">
          <tr>
            <th className="py-2 pr-3 font-medium">Type</th>
            <th className="py-2 pr-3 font-medium">When</th>
            <th className="py-2 pr-3 font-medium">Venue</th>
            <th className="py-2 pr-3 font-medium">Court</th>
            <th className="py-2 pr-3 font-medium">Session</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 font-medium">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-white/10">
              <td className="py-3 pr-3 text-white">{row.kind}</td>
              <td className="pr-3">
                {row.whenNote ? (
                  <>
                    <span className="block whitespace-nowrap text-white">{row.when}</span>
                    <span className="block text-xs text-mist/55">{row.whenNote}</span>
                  </>
                ) : row.when}
              </td>
              <td className="pr-3">{row.venueName}</td>
              <td className="py-3 pr-3"><RewardCourts row={row} /></td>
              <td className="whitespace-nowrap pr-3">{row.session}</td>
              <td className="pr-3">
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === "Added" ? "bg-line/15 text-line" : "bg-white/10 text-mist"}`}>{row.status}</span>
              </td>
              <td className="py-3"><RewardPoints row={row} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

export function ListPager({
  page,
  pageSize,
  total,
  unit,
  loading,
  pageMove,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  unit?: string;
  loading: boolean;
  pageMove: string | null;
  onPage: (page: number, move: string) => void;
  onPageSize: (size: number) => void;
}) {
  const size = Math.max(pageSize, 1);
  const pages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(page, pages);
  const from = total === 0 ? 0 : (safePage - 1) * size + 1;
  const to = Math.min(total, safePage * size);
  const windowStart = Math.max(1, safePage - 2);
  const windowEnd = Math.min(pages, windowStart + 4);
  const numbers = Array.from({ length: windowEnd - windowStart + 1 }, (_, index) => windowStart + index);
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-white" aria-live="polite">View {from}–{to} of {total}{unit ? ` ${unit}` : ""}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {rewardPageSizes.map((option) => (
            <Button
              key={option}
              variant={option === pageSize ? "primary" : "secondary"}
              aria-label={`View ${option} per page`}
              aria-pressed={option === pageSize}
              loading={pageMove === `size-${option}`}
              disabled={option === pageSize || loading}
              onClick={() => onPageSize(option)}
            >
              {option}
            </Button>
          ))}
          <span className="text-sm text-mist/80">per page</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "prev"} disabled={safePage <= 1 || loading} onClick={() => onPage(safePage - 1, "prev")}>Previous</Button>
        {numbers.map((number) => (
          <Button
            key={number}
            variant={number === safePage ? "primary" : "secondary"}
            className="min-w-10 px-2.5"
            aria-label={`Page ${number}`}
            aria-current={number === safePage ? "page" : undefined}
            loading={loading && pageMove === `page-${number}`}
            disabled={number === safePage || loading}
            onClick={() => onPage(number, `page-${number}`)}
          >
            {number}
          </Button>
        ))}
        <Button variant="secondary" icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "next"} disabled={safePage >= pages || loading} onClick={() => onPage(safePage + 1, "next")}>Next</Button>
        <span className="text-sm text-mist/70">Page {safePage} of {pages}</span>
      </div>
    </div>
  );
}
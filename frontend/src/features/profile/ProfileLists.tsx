import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { ChevronLeft, ChevronRight, Clock, History, LogOut } from "lucide-react";
import type { AppDispatch, RootState } from "../../app/store";
import { Button, Skeleton } from "../../components/ui";
import { EmptyState, ErrorState, formatVenueDateTime, formatVenueRange } from "../../components/format";
import { externalLogins, type ExternalLogin } from "../auth/authApi";
import { fetchSessions, loadCurrentUser, logoutOthers, revokeSession } from "../auth/authSlice";
import { myPayments, myRewards, type Page, type PaymentRow, type PendingReward, type RewardRow } from "./profileApi";

export function RewardsSection() {
  const dispatch = useDispatch<AppDispatch>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(20);
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
              when: "After the session ends",
              venueName: item.venueName,
              courtName: item.courtName,
              session: formatVenueRange(item.startTime, item.endTime, item.timeZone),
              points: item.points,
              status: "Pending",
            }))}
            emptyTitle="No points are waiting"
            emptyBody="A court, public social, or friend spot with an incentive shows up here until that session ends."
          />
          <RewardPages
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
              status: "Added",
            }))}
            emptyTitle="No points yet"
            emptyBody="Points appear here after a session with an active incentive ends."
          />
          <RewardPages
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
  const [data, setData] = useState<Page<PaymentRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pageMove, setPageMove] = useState<"prev" | "next" | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    myPayments(page)
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
  }, [page, attempt]);

  return (
    <div>
      <h1 className="font-display text-3xl text-white">Payments and refunds</h1>
      {error ? (
        <div className="mt-4"><ErrorState message={error} loading={loading} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} /></div>
      ) : loading && pageMove === null ? (
        <div className="mt-4" aria-busy="true"><span className="sr-only">Loading payments</span><Skeleton className="h-24" /></div>
      ) : data && data.items.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {data.items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 px-4 py-3">
              <div>
                <p className="font-medium text-white">{item.venueName}</p>
                <p className="text-sm text-mist/65">{new Date(item.occurredAt).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <span className="rounded-full bg-white/10 px-2 py-1 text-xs uppercase text-mist">{item.kind} · {item.status}</span>
                <p className="mt-1 font-semibold">{new Intl.NumberFormat("en-AU", { style: "currency", currency: item.currency }).format(item.amount)}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4"><EmptyState title="No payments yet" body="Stripe charges and refunds will be listed here." /></div>
      )}
      {data && !error ? <Pager page={page} pageSize={data.pageSize} total={data.total} loading={loading} pageMove={pageMove} onPage={(next, move) => { setLoading(true); setPageMove(move); setPage(next); }} /> : null}
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

const rewardPageSizes = [10, 20, 50] as const;

function slicePage<T>(items: T[], page: number, pageSize: number) {
  const start = Math.max(0, (page - 1) * pageSize);
  return items.slice(start, start + pageSize);
}

function RewardTable({
  caption,
  rows,
  emptyTitle,
  emptyBody,
}: {
  caption: string;
  rows: { id: string; kind: string; when: string; venueName: string; courtName: string; session: string; points: number; status: string }[];
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
                <p className="text-sm text-mist/75">{row.courtName}</p>
              </div>
              <p className="shrink-0 font-semibold text-line">+{row.points}</p>
            </div>
            <p className="mt-2 text-sm text-mist/70">{row.session}</p>
            <p className="text-sm text-mist/60">{row.when}</p>
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
              <td className="pr-3">{row.when}</td>
              <td className="pr-3">{row.venueName}</td>
              <td className="pr-3">{row.courtName}</td>
              <td className="whitespace-nowrap pr-3">{row.session}</td>
              <td className="pr-3">
                <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.status === "Added" ? "bg-line/15 text-line" : "bg-white/10 text-mist"}`}>{row.status}</span>
              </td>
              <td className="font-semibold text-line">+{row.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function RewardPages({
  page,
  pageSize,
  total,
  loading,
  pageMove,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
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
        <p className="text-sm font-medium text-white" aria-live="polite">View {from}–{to} of {total}</p>
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

function Pager({
  page,
  pageSize,
  total,
  loading = false,
  pageMove = null,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  pageMove?: "prev" | "next" | null;
  onPage: (page: number, move: "prev" | "next") => void;
}) {
  if (total <= pageSize) {
    return null;
  }
  const pages = Math.ceil(total / pageSize);
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "prev"} disabled={page <= 1 || loading} onClick={() => onPage(page - 1, "prev")}>Previous</Button>
      <span>Page {page} of {pages}</span>
      <Button variant="secondary" icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "next"} disabled={page >= pages || loading} onClick={() => onPage(page + 1, "next")}>Next</Button>
    </div>
  );
}

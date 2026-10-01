import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "../../app/store";
import { Button, Skeleton } from "../../components/ui";
import { EmptyState, ErrorState, formatVenueDateTime, formatVenueRange } from "../../components/format";
import { externalLogins, type ExternalLogin } from "../auth/authApi";
import { fetchSessions, logoutOthers, revokeSession } from "../auth/authSlice";
import { myPayments, myRewards, type Page, type PaymentRow, type RewardRow } from "./profileApi";

export function RewardsSection() {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(Page<RewardRow> & { balance: number }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    myRewards(page)
      .then(setData)
      .catch(() => setError("Rewards could not be loaded."))
      .finally(() => setLoading(false));
  }, [page, attempt]);

  return (
    <div>
      <h1 className="font-display text-3xl text-white">Reward points</h1>
      {loading ? (
        <div className="mt-4" aria-busy="true"><span className="sr-only">Loading rewards</span><Skeleton className="h-24" /></div>
      ) : error ? (
        <div className="mt-4"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
      ) : data ? (
        <>
          <p className="mt-2 text-lg font-semibold text-line">{data.balance} points</p>
          {data.items.length === 0 ? (
            <div className="mt-4"><EmptyState title="No points yet" body="Points appear here after a session with an active incentive ends." /></div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <caption className="sr-only">Reward point history</caption>
                <thead className="text-mist/60">
                  <tr>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Venue</th>
                    <th className="py-2 font-medium">Court</th>
                    <th className="py-2 font-medium">Session</th>
                    <th className="py-2 font-medium">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => (
                    <tr key={row.id} className="border-t border-white/10">
                      <td className="py-3">{formatVenueDateTime(row.awardedAt, row.timeZone)}</td>
                      <td>{row.venueName}</td>
                      <td>{row.courtName}</td>
                      <td>{formatVenueRange(row.startTime, row.endTime, row.timeZone)}</td>
                      <td className="font-semibold text-line">+{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
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

  useEffect(() => {
    setLoading(true);
    myPayments(page)
      .then(setData)
      .catch(() => setError("Payments could not be loaded."))
      .finally(() => setLoading(false));
  }, [page, attempt]);

  return (
    <div>
      <h1 className="font-display text-3xl text-white">Payments and refunds</h1>
      {loading ? (
        <div className="mt-4" aria-busy="true"><span className="sr-only">Loading payments</span><Skeleton className="h-24" /></div>
      ) : error ? (
        <div className="mt-4"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
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
      {data ? <Pager page={page} pageSize={data.pageSize} total={data.total} onPage={setPage} /> : null}
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
        {error ? <div className="mt-3"><ErrorState message={error} onRetry={() => externalLogins().then(setLogins).catch(() => setError("Linked accounts could not be loaded."))} /></div> : null}
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
            loading={pending === "others"}
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
                  loading={pending === session.id}
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

function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  if (total <= pageSize) {
    return null;
  }
  const pages = Math.ceil(total / pageSize);
  return (
    <div className="mt-4 flex items-center gap-3 text-sm">
      <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span>Page {page} of {pages}</span>
      <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, CreditCard, Eye, UserPlus, X } from "lucide-react";
import type { AppDispatch } from "../../app/store";
import { Button, Skeleton, Spinner } from "../../components/ui";
import { EmptyState, ErrorState, Money, formatVenueDateTime, formatVenueRange } from "../../components/format";
import { loadCurrentUser } from "../auth/authSlice";
import { addHoldCourts, venueAvailability } from "../venues/venueApi";
import { cancelBooking, myBookings, myCourtWeeks, type BookingRow, type CancelResult, type CourtWeekCourt, type Page } from "./profileApi";

const tabs = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
] as const;

function formatWeekDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timeZone || "Australia/Melbourne",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function overlaps(start: string, end: string, otherStart: string, otherEnd: string) {
  return new Date(otherStart).getTime() < new Date(end).getTime() && new Date(otherEnd).getTime() > new Date(start).getTime();
}

function CourtWeekCard({ courts, onChanged }: { courts: CourtWeekCourt[]; onChanged: () => void }) {
  const first = courts[0];
  const [checked, setChecked] = useState(() => new Set(courts.map((court) => court.courtId)));
  const [choices, setChoices] = useState<{ id: string; name: string }[] | null>(null);
  const [loadingCourts, setLoadingCourts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPaid, setConfirmPaid] = useState(false);
  const held = new Set(courts.map((court) => court.courtId));
  const removed = courts.filter((court) => !checked.has(court.courtId));
  const added = [...checked].filter((id) => !held.has(id));
  const selected = courts.filter((court) => checked.has(court.courtId));
  const total = selected.reduce((sum, court) => sum + court.price, 0) + added.length * first.price;
  const dirty = removed.length > 0 || added.length > 0;
  const pending = selected.filter((court) => court.status === "pending");
  const options = choices ?? courts.map((court) => ({ id: court.courtId, name: court.courtName }));
  const due = new Date(new Date(first.startTime).getTime() - 24 * 60 * 60 * 1000);
  const dueSoon = pending.length > 0 && due.getTime() <= Date.now();

  async function loadCourts() {
    setLoadingCourts(true);
    setError(null);
    try {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: first.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(first.startTime));
      const availability = await venueAvailability(first.venueSlug, day, "", "");
      setChoices(availability.courts
        .filter((court) => held.has(court.id) || !court.bookings.some((booking) => overlaps(first.startTime, first.endTime, booking.startTime, booking.endTime)))
        .map((court) => ({ id: court.id, name: court.courtName })));
    } catch {
      setError("Courts could not be loaded.");
    } finally {
      setLoadingCourts(false);
    }
  }

  async function save() {
    if (removed.some((court) => court.status === "confirmed") && !confirmPaid) {
      setConfirmPaid(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (const court of removed) {
        await cancelBooking(court.bookingId);
      }
      if (added.length > 0) {
        await addHoldCourts(first.venueSlug, first.groupId, first.startTime, first.endTime, added);
      }
      setConfirmPaid(false);
      onChanged();
    } catch {
      setError("This week could not be updated.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-2xl border border-white/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-white">{first.venueName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-mist/60">This week</p>
          <p className="mt-1 font-semibold text-white"><Money amount={total} currency={first.currency} /></p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 text-sm min-[420px]:grid-cols-2">
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <dt className="text-mist/60">Date</dt>
          <dd className="font-medium text-white">{formatWeekDate(first.startTime, first.timeZone)}</dd>
        </div>
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <dt className="text-mist/60">Time</dt>
          <dd className="font-medium text-white">{formatVenueRange(first.startTime, first.endTime, first.timeZone)}</dd>
        </div>
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <dt className="text-mist/60">Courts</dt>
          <dd className="font-medium text-white">{checked.size} {checked.size === 1 ? "court" : "courts"} ticked</dd>
        </div>
        <div className="rounded-xl bg-black/20 px-3 py-2">
          <dt className="text-mist/60">{pending.length === 0 ? "Status" : "Pay before"}</dt>
          <dd className="font-medium text-white">{pending.length === 0 ? "Paid" : dueSoon ? "This session is inside 24 hours. Pay now to keep it." : formatVenueDateTime(due.toISOString(), first.timeZone)}</dd>
        </div>
      </dl>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {options.map((court) => {
          const row = courts.find((item) => item.courtId === court.id);
          return (
            <li key={court.id}>
              <label className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-mist">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-line"
                  checked={checked.has(court.id)}
                  disabled={saving || loadingCourts}
                  onChange={() => {
                    setConfirmPaid(false);
                    setChecked((current) => {
                      const next = new Set(current);
                      if (next.has(court.id)) next.delete(court.id);
                      else next.add(court.id);
                      return next;
                    });
                  }}
                />
                <span className="min-w-0">{court.name}</span>
                <span className="ml-auto text-xs text-mist/60">{row ? (row.status === "confirmed" ? "Paid" : "Held") : "Add"}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm text-mist/75">No deposit. Pay the courts you keep before 24 hours of this session, or they are released automatically. Untick a court to drop it. The total updates from the courts you leave ticked.</p>
      {confirmPaid ? <p className="mt-2 text-sm text-mist" role="status">Paid courts you untick are cancelled under the cancellation policy.</p> : null}
      {error ? <p className="mt-2 text-sm text-mist" role="alert">{error}</p> : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {choices === null ? (
          <Button type="button" variant="secondary" className="w-full sm:w-auto" loading={loadingCourts} disabled={saving} onClick={() => void loadCourts()}>Add a court</Button>
        ) : null}
        {dirty ? (
          <Button type="button" className="w-full sm:w-auto" loading={saving} onClick={() => void save()}>{confirmPaid ? "Confirm update" : "Update this week"}</Button>
        ) : pending.length > 0 ? (
          <Link to={`/${first.venueSlug}/book/group/${first.groupId}?bookings=${pending.map((court) => court.bookingId).join(",")}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lime-300 sm:w-auto">
            <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
            Pay this week
          </Link>
        ) : (
          <p className="text-sm text-line">This week is paid.</p>
        )}
      </div>
    </li>
  );
}

function cancelNotice(result: CancelResult) {
  const money = new Intl.NumberFormat("en-AU", { style: "currency", currency: result.currency }).format(result.refundAmount);
  const parts = [`Cancelled. Refund amount: ${money}.`];
  if (result.feePercent > 0) {
    parts.push(`A ${Number(result.feePercent.toFixed(2))}% late fee was kept.`);
  }
  if (result.pointsRestored > 0) {
    parts.push(`${result.pointsRestored} points were returned.`);
  }
  return parts.join(" ");
}

export function BookingsSection() {
  const dispatch = useDispatch<AppDispatch>();
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("upcoming");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<BookingRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageMove, setPageMove] = useState<"prev" | "next" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<CourtWeekCourt[][] | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    myBookings(tab, page)
      .then((next) => {
        if (active) {
          setData(next);
          setError(null);
          void dispatch(loadCurrentUser());
        }
      })
      .catch(() => {
        if (active) setError("Bookings could not be loaded.");
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
  }, [tab, page, attempt, dispatch]);

  useEffect(() => {
    if (tab !== "upcoming") {
      return;
    }
    let active = true;
    myCourtWeeks()
      .then((result) => {
        if (!active) return;
        const grouped = new Map<string, CourtWeekCourt[]>();
        for (const row of result.weeks) {
          const key = `${row.groupId}|${row.startTime}`;
          grouped.set(key, [...(grouped.get(key) ?? []), row]);
        }
        setWeeks([...grouped.values()]);
      })
      .catch(() => {
        if (active) setWeeks([]);
      });
    return () => {
      active = false;
    };
  }, [tab, attempt]);

  async function onCancel(id: string) {
    setPendingId(id);
    setNotice(null);
    try {
      const result = await cancelBooking(id);
      setNotice(cancelNotice(result));
      void dispatch(loadCurrentUser());
      setConfirmId(null);
      setAttempt((value) => value + 1);
    } catch {
      setNotice("This booking could not be cancelled.");
    } finally {
      setPendingId(null);
    }
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div>
      <h1 className="font-display text-3xl text-white">My bookings</h1>
      <div className="mt-4 flex gap-2" role="tablist" aria-label="Booking status">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-busy={loading && pageMove === null && tab === item.id}
            disabled={loading}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${tab === item.id ? "bg-line text-ink" : "border border-white/10 text-mist"}`}
            onClick={() => {
              if (item.id === tab) {
                return;
              }
              setError(null);
              setPageMove(null);
              setLoading(true);
              setTab(item.id);
              setPage(1);
            }}
          >
            {loading && pageMove === null && tab === item.id ? <Spinner className="h-3.5 w-3.5" /> : null}
            {item.label}
          </button>
        ))}
      </div>
      {notice ? <p className="mt-4 text-sm text-mist" role="status">{notice}</p> : null}
      {error ? (
        <div className="mt-4"><ErrorState message={error} loading={loading} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} /></div>
      ) : loading && pageMove === null ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          <span className="sr-only">Loading bookings</span>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : (
        <>
      {tab === "upcoming" && weeks && weeks.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {weeks.map((courts) => <CourtWeekCard key={`${courts[0].groupId}-${courts[0].startTime}`} courts={courts} onChanged={() => setAttempt((value) => value + 1)} />)}
        </ul>
      ) : null}
      {data && data.items.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {data.items.map((booking) => (
            <li key={booking.id} className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-white">{booking.venueName}</p>
                  <p className="text-sm text-mist/70">{booking.status === "waitlist" ? "Waitlist · waiting for a place" : `${booking.courtName} · Court ${booking.courtNumber}`}</p>
                  <p className="text-sm text-mist/70">{formatVenueDateTime(booking.startTime, booking.timeZone)}</p>
                  <p className="text-sm text-mist/70">{formatVenueRange(booking.startTime, booking.endTime, booking.timeZone)}</p>
                </div>
                <div className="text-right">
                  <span className="rounded-full bg-white/10 px-2 py-1 text-xs uppercase tracking-wide text-mist">{booking.status}</span>
                  <p className="mt-2 font-semibold text-white"><Money amount={booking.totalAmount} currency={booking.currency} /></p>
                </div>
              </div>
              {booking.socialId && booking.canCancel && booking.status !== "waitlist" ? (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Link to={`/${booking.venueSlug}/social/${booking.socialId}`} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lime-300 sm:w-auto">
                    <UserPlus className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Add friends
                  </Link>
                  {confirmId === booking.id ? (
                    <>
                      <Button variant="danger" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} loading={pendingId === booking.id} onClick={() => void onCancel(booking.id)}>Confirm cancel</Button>
                      <Button variant="secondary" className="w-full sm:w-auto" disabled={pendingId === booking.id} onClick={() => setConfirmId(null)}>Keep booking</Button>
                    </>
                  ) : (
                    <Button variant="secondary" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} disabled={pendingId !== null} onClick={() => setConfirmId(booking.id)}>Cancel</Button>
                  )}
                </div>
              ) : booking.canCancel ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {confirmId === booking.id ? (
                    <>
                      <Button variant="danger" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} loading={pendingId === booking.id} onClick={() => void onCancel(booking.id)}>Confirm cancel</Button>
                      <Button variant="secondary" className="w-full sm:w-auto" disabled={pendingId === booking.id} onClick={() => setConfirmId(null)}>Keep booking</Button>
                    </>
                  ) : (
                    <Button variant="secondary" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} disabled={pendingId !== null} onClick={() => setConfirmId(booking.id)}>Cancel</Button>
                  )}
                </div>
              ) : null}
              {tab === "upcoming" && booking.socialId ? (
                <div className="mt-4">
                  <Button variant="secondary" className="w-full sm:w-auto" icon={<Eye className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpenId(openId === booking.id ? null : booking.id)}>
                    {openId === booking.id ? "Hide registration" : "View registration"}
                  </Button>
                  {openId === booking.id ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                      <p className="text-sm font-medium text-white">Your place</p>
                      <p className="text-sm text-mist/80">{booking.status === "waitlist" ? "Waitlist · waiting for a place" : `${booking.courtName} · Court ${booking.courtNumber}`}</p>
                      <p className="text-sm text-mist/70">{formatVenueRange(booking.startTime, booking.endTime, booking.timeZone)}</p>
                      <p className="mt-3 text-sm font-medium text-white">Friends</p>
                      {(booking.friends ?? []).length === 0 ? (
                        <p className="text-sm text-mist/70">No friends on this social.</p>
                      ) : (
                        <ul className="mt-1">
                          {(booking.friends ?? []).map((friend) => (
                            <li key={friend.id} className="text-sm text-mist/80">{friend.name} · {friend.courtName || "Waitlist"} · {friend.status}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : tab === "upcoming" && weeks && weeks.length > 0 ? null : (
        <div className="mt-4"><EmptyState title="No bookings here" body="Courts you book will show up in this list." /></div>
      )}
        </>
      )}
      {data && data.total > data.pageSize ? (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "prev"} disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPageMove("prev"); setPage((value) => value - 1); }}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button variant="secondary" icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "next"} disabled={page >= pages || loading} onClick={() => { setLoading(true); setPageMove("next"); setPage((value) => value + 1); }}>Next</Button>
        </div>
      ) : null}
    </div>
  );
}

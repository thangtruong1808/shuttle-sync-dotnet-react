import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Eye, UserPlus, X } from "lucide-react";
import type { AppDispatch } from "../../app/store";
import { Button, Skeleton, Spinner } from "../../components/ui";
import { EmptyState, ErrorState, Money, formatVenueDateTime, formatVenueRange } from "../../components/format";
import { loadCurrentUser } from "../auth/authSlice";
import { cancelBooking, myBookings, type BookingRow, type CancelResult, type Page } from "./profileApi";

const tabs = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
] as const;

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
      ) : data && data.items.length > 0 ? (
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
                confirmId === booking.id ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="danger" icon={<X className="h-4 w-4" aria-hidden="true" />} loading={pendingId === booking.id} onClick={() => void onCancel(booking.id)}>Confirm cancel</Button>
                    <Button variant="secondary" disabled={pendingId === booking.id} onClick={() => setConfirmId(null)}>Keep booking</Button>
                  </div>
                ) : (
                  <Button className="mt-3" variant="secondary" icon={<X className="h-4 w-4" aria-hidden="true" />} disabled={pendingId !== null} onClick={() => setConfirmId(booking.id)}>Cancel</Button>
                )
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
      ) : (
        <div className="mt-4"><EmptyState title="No bookings here" body="Courts you book will show up in this list." /></div>
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

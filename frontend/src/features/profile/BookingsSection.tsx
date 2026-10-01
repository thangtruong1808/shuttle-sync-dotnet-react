import { useEffect, useState } from "react";
import { Button, Skeleton } from "../../components/ui";
import { EmptyState, ErrorState, Money, formatVenueDateTime, formatVenueRange } from "../../components/format";
import { cancelBooking, myBookings, type BookingRow, type Page } from "./profileApi";

const tabs = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
] as const;

export function BookingsSection() {
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("upcoming");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page<BookingRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    myBookings(tab, page)
      .then(setData)
      .catch(() => setError("Bookings could not be loaded."))
      .finally(() => setLoading(false));
  }, [tab, page, attempt]);

  async function onCancel(id: string) {
    setPendingId(id);
    setNotice(null);
    try {
      const result = await cancelBooking(id);
      setNotice(`Cancelled. Refund amount: ${new Intl.NumberFormat("en-AU", { style: "currency", currency: result.currency }).format(result.refundAmount)}.`);
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
            className={`rounded-full px-3 py-1.5 text-sm ${tab === item.id ? "bg-line text-ink" : "border border-white/10 text-mist"}`}
            onClick={() => {
              setTab(item.id);
              setPage(1);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {notice ? <p className="mt-4 text-sm text-mist" role="status">{notice}</p> : null}
      {loading ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          <span className="sr-only">Loading bookings</span>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : error ? (
        <div className="mt-4"><ErrorState message={error} onRetry={() => setAttempt((value) => value + 1)} /></div>
      ) : data && data.items.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {data.items.map((booking) => (
            <li key={booking.id} className="rounded-2xl border border-white/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-white">{booking.venueName}</p>
                  <p className="text-sm text-mist/70">{booking.courtName} · Court {booking.courtNumber}</p>
                  <p className="text-sm text-mist/70">{formatVenueDateTime(booking.startTime, booking.timeZone)}</p>
                  <p className="text-sm text-mist/70">{formatVenueRange(booking.startTime, booking.endTime, booking.timeZone)}</p>
                </div>
                <div className="text-right">
                  <span className="rounded-full bg-white/10 px-2 py-1 text-xs uppercase tracking-wide text-mist">{booking.status}</span>
                  <p className="mt-2 font-semibold text-white"><Money amount={booking.totalAmount} currency={booking.currency} /></p>
                </div>
              </div>
              {booking.canCancel ? (
                confirmId === booking.id ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="danger" loading={pendingId === booking.id} onClick={() => void onCancel(booking.id)}>Confirm cancel</Button>
                    <Button variant="secondary" onClick={() => setConfirmId(null)}>Keep booking</Button>
                  </div>
                ) : (
                  <Button className="mt-3" variant="secondary" onClick={() => setConfirmId(booking.id)}>Cancel</Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4"><EmptyState title="No bookings here" body="Courts you book will show up in this list." /></div>
      )}
      {data && data.total > data.pageSize ? (
        <div className="mt-4 flex items-center gap-3 text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Next</Button>
        </div>
      ) : null}
    </div>
  );
}

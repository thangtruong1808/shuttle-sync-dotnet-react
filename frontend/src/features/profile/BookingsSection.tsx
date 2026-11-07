import { useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { Link, useSearchParams } from "react-router-dom";
import { Eye, UserPlus, X } from "lucide-react";
import type { AppDispatch } from "../../app/store";
import { Button, PageHeader, Skeleton, Spinner, buttonClass } from "../../components/ui";
import { EmptyState, ErrorState, formatVenueRange } from "../../components/format";
import { loadCurrentUser } from "../auth/authSlice";
import { useVenues } from "../../components/layout/SiteLayout";
import { venueForPage } from "../venues/venueApi";
import { cancelBooking, myBookings, myCourtWeeks, type BookingRow, type CourtWeekCourt, type Page } from "./profileApi";
import { RecommendationBanner } from "./RecommendationNotice";
import { ListPager } from "./ProfileLists";
import { cancelNotice, holdFilters, visibleSeries, weekOfYear, type HoldFilter } from "./bookingWeek";
import { SeriesCard } from "./BookingSeriesCard";
import { BookingSummary, SessionGroupCard, sessionGroups, sessionKey } from "./BookingSessionCard";

const tabs = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
] as const;

export function BookingsSection() {
  const { venues, defaultSlug } = useVenues();
  const [params] = useSearchParams();
  const venue = venueForPage(venues, params.get("venue") ?? undefined, defaultSlug);
  if (venues === null) {
    return (
      <div>
        <PageHeader title="My bookings" />
        <RecommendationBanner />
        <div className="mt-4 space-y-3" aria-busy="true">
          <span className="sr-only">Loading bookings</span>
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      </div>
    );
  }
  return <VenueBookings key={venue?.slug ?? "all"} venueSlug={venue?.slug ?? null} venueName={venue?.name ?? null} />;
}

function VenueBookings({ venueSlug, venueName }: { venueSlug: string | null; venueName: string | null }) {
  const [params] = useSearchParams();
  const weekSaved = params.get("weekSaved") === "1";
  const dispatch = useDispatch<AppDispatch>();
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("upcoming");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [data, setData] = useState<Page<BookingRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageMove, setPageMove] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [weeks, setWeeks] = useState<CourtWeekCourt[][] | null>(null);
  const [topUps, setTopUps] = useState<CourtWeekCourt[]>([]);
  const [holdFilter, setHoldFilter] = useState<HoldFilter>("all");
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [seriesPage, setSeriesPage] = useState(1);
  const [seriesPageSize, setSeriesPageSize] = useState(5);
  const series = weeks ? visibleSeries(weeks, holdFilter) : [];
  const seriesPageNow = Math.min(seriesPage, Math.max(1, Math.ceil(series.length / seriesPageSize)));

  useEffect(() => {
    let active = true;
    setLoading(true);
    myBookings(tab, page, venueSlug, pageSize)
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
  }, [tab, page, pageSize, attempt, dispatch, venueSlug]);

  useEffect(() => {
    if (tab !== "upcoming") {
      return;
    }
    let active = true;
    myCourtWeeks()
      .then((result) => {
        if (!active) return;
        const grouped = new Map<string, CourtWeekCourt[]>();
        const moves: CourtWeekCourt[] = [];
        for (const row of result.weeks) {
          if (venueSlug && row.venueSlug !== venueSlug) continue;
          if (row.cancelReason?.startsWith("week-topup|")) {
            moves.push(row);
            continue;
          }
          const stamp = weekOfYear(row.startTime, row.timeZone);
          const key = `${row.groupId}|${stamp.year}-W${stamp.week}`;
          grouped.set(key, [...(grouped.get(key) ?? []), row]);
        }
        setTopUps(moves);
        setWeeks([...grouped.values()]);
      })
      .catch(() => {
        if (active) setWeeks([]);
      });
    return () => {
      active = false;
    };
  }, [tab, attempt, venueSlug]);

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

  return (
    <div>
      <PageHeader title="My bookings" />
      {weekSaved ? <p className="mt-3 rounded-xl border border-accent-text/40 bg-accent/10 px-3 py-2 text-sm text-accent-text" role="status">This week was updated. New courts stay on this card.</p> : null}
      {venueName ? <p className="mt-1 text-sm leading-relaxed text-fg/75">Showing bookings at <span className="font-semibold text-fg">{venueName}</span>. Choose another venue in the menu above to see its bookings.</p> : null}
      <RecommendationBanner />
      <div className="inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-surface-2 p-1" role="tablist" aria-label="Booking status">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-busy={loading && pageMove === null && tab === item.id}
            disabled={loading}
            className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${tab === item.id ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg"}`}
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
      {notice ? <p className="mt-4 text-sm text-fg" role="status">{notice}</p> : null}
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
        <>
          <h2 className="mt-6 font-display text-2xl text-fg">Court bookings</h2>
          <div className="mt-3 inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-surface-2 p-1" role="tablist" aria-label="Court hold view">
            {holdFilters.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={holdFilter === item.id}
                className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${holdFilter === item.id ? "bg-surface text-fg shadow-card" : "text-fg-muted hover:text-fg"}`}
                onClick={() => { setHoldFilter(item.id); setSeriesPage(1); }}
              >
                {item.label}
              </button>
            ))}
          </div>
          {series.length === 0 ? (
            <p className="mt-4 text-sm text-fg">No court holds match this view.</p>
          ) : (
            <>
            <ul className="mt-4 space-y-3">
              {series.slice((seriesPageNow - 1) * seriesPageSize, seriesPageNow * seriesPageSize).map((group) => (
                <SeriesCard
                  key={group[0][0].groupId}
                  weeks={group}
                  topUps={topUps.filter((row) => row.groupId === group[0][0].groupId)}
                  open={openSeries === group[0][0].groupId}
                  onToggle={() => setOpenSeries((current) => current === group[0][0].groupId ? null : group[0][0].groupId)}
                  openWeek={openWeek}
                  onOpenWeek={setOpenWeek}
                  onChanged={() => setAttempt((value) => value + 1)}
                />
              ))}
            </ul>
            <ListPager
              page={seriesPageNow}
              pageSize={seriesPageSize}
              total={series.length}
              loading={false}
              pageMove={null}
              onPage={(next) => setSeriesPage(next)}
              onPageSize={(size) => { setSeriesPageSize(size); setSeriesPage(1); }}
            />
            </>
          )}
        </>
      ) : null}
      {data && data.items.length > 0 ? (
        <>
        {tab === "upcoming" && weeks && weeks.length > 0 ? (
          <h2 className="mt-8 font-display text-2xl text-fg">{data.items.every((item) => item.socialId) ? "Public socials" : "Other bookings"}</h2>
        ) : null}
        <ul className="mt-4 space-y-3">
          {(tab === "upcoming" ? data.items.map((item) => [item]) : sessionGroups(data.items)).map((group) => {
            if (group.length > 1) {
              const key = sessionKey(group[0]);
              return (
                <SessionGroupCard
                  key={key}
                  bookings={group}
                  tab={tab}
                  open={openGroups.has(key)}
                  onToggle={() => setOpenGroups((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })}
                />
              );
            }
            const booking = group[0];
            return (
            <li key={booking.id} className="rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none">
              <BookingSummary booking={booking} tab={tab} />
              {booking.socialId && booking.canCancel && booking.status !== "waitlist" ? (
                <div className="mt-4 flex flex-col gap-2 rounded-xl border border-border bg-inset p-2 sm:flex-row sm:items-center">
                  <Link to={`/${booking.venueSlug}/social/${booking.socialId}`} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg hover:bg-lime-300 sm:w-auto">
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
                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-inset p-2 sm:flex-row sm:flex-wrap">
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
                    <div className="mt-3 rounded-2xl border border-fg/10 bg-inset p-3">
                      <p className="text-sm font-medium text-fg">Your place</p>
                      <p className="text-sm text-fg/80">{booking.status === "waitlist" ? "Waitlist · waiting for a place" : `${booking.courtName} · Court ${booking.courtNumber}`}</p>
                      <p className="text-sm text-fg/70">{formatVenueRange(booking.startTime, booking.endTime, booking.timeZone)}</p>
                      <p className="mt-3 text-sm font-medium text-fg">Friends</p>
                      {(booking.friends ?? []).length === 0 ? (
                        <p className="text-sm text-fg/70">No friends on this social.</p>
                      ) : (
                        <ul className="mt-1">
                          {(booking.friends ?? []).map((friend) => (
                            <li key={friend.id} className="break-words text-sm text-fg/80">{friend.name} · {friend.courtName || "Waitlist"} · {friend.status}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
            );
          })}
        </ul>
        </>
      ) : tab === "upcoming" && weeks && weeks.length > 0 ? null : (
        <div className="mt-4">
          <EmptyState
            title={emptyCopy[tab].title}
            body={emptyCopy[tab].body(venueName)}
            action={tab === "upcoming" && venueSlug ? <Link to={`/${venueSlug}/book`} className={buttonClass("primary", "sm")}>Book a court</Link> : undefined}
          />
        </div>
      )}
        </>
      )}
      {data && !error && data.total > 0 ? (
        <ListPager
          page={page}
          pageSize={data.pageSize || pageSize}
          total={data.total}
          unit={tab === "upcoming" ? undefined : "sessions"}
          loading={loading}
          pageMove={pageMove}
          onPage={(next, move) => { setLoading(true); setPageMove(move); setPage(next); }}
          onPageSize={(size) => { setLoading(true); setPageMove(`size-${size}`); setPageSize(size); setPage(1); }}
        />
      ) : null}
    </div>
  );
}

const emptyCopy: Record<(typeof tabs)[number]["id"], { title: string; body: (venueName: string | null) => string }> = {
  upcoming: {
    title: "Nothing coming up",
    body: (venueName) => venueName ? `Courts and public socials you book at ${venueName} will show up here.` : "Courts and public socials you book will show up here.",
  },
  past: {
    title: "No past bookings yet",
    body: () => "Sessions move here after they finish, with any reward points you earned.",
  },
  cancelled: {
    title: "No cancelled bookings",
    body: () => "Bookings you cancel, and holds that expire before payment, are listed here with any refund.",
  },
};


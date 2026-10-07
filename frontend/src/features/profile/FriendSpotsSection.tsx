import { useEffect, useState } from "react";
import { ChevronDown, ChevronsUpDown, Clock, CreditCard, Gift, MapPin, Pencil, Save, ShieldCheck, TriangleAlert, Undo2, Users, X } from "lucide-react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "../../app/store";
import { Button, Skeleton, Spinner } from "../../components/ui";
import { EmptyState, ErrorState, Money, formatVenueDateTime, formatVenueRange, initials } from "../../components/format";
import { loadCurrentUser } from "../auth/authSlice";
import { AuthRequestError } from "../auth/authApi";
import { cancelBooking, myFriendSpots, renameFriend, type CancelResult, type FriendSpot, type Page } from "./profileApi";
import { ListPager } from "./ProfileLists";

const tabs = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
] as const;

type Tab = (typeof tabs)[number]["id"];

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

function groupBySocial(items: FriendSpot[]) {
  const groups: FriendSpot[][] = [];
  for (const spot of items) {
    const current = groups[groups.length - 1];
    if (current && current[0]?.socialId === spot.socialId) {
      current.push(spot);
    } else {
      groups.push([spot]);
    }
  }
  return groups;
}

function spotStatus(status: string, tab: Tab) {
  if (status === "confirmed") return tab === "past" ? { label: "Played", tone: "bg-line/15 text-line" } : { label: "On court", tone: "bg-line/15 text-line" };
  if (status === "waitlist") return { label: "Waitlist", tone: "bg-sky-400/15 text-sky-200" };
  if (status === "pending") return { label: "Waiting for payment", tone: "bg-amber-400/15 text-amber-200" };
  if (status === "cancelled") return { label: "Cancelled", tone: "bg-rose-500/15 text-rose-200" };
  return { label: "Expired", tone: "bg-white/10 text-mist" };
}

function startsIn(iso: string) {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return "Starting now";
  if (minutes < 60) return `Starts in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Starts in ${hours} ${hours === 1 ? "hour" : "hours"}`;
  const days = Math.round(hours / 24);
  return `Starts in ${days} ${days === 1 ? "day" : "days"}`;
}

function duration(start: string, end: string) {
  const minutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

const emptyCopy: Record<Tab, { title: string; body: string }> = {
  upcoming: { title: "No friend spots yet", body: "Friends you add to a public social stay listed here, including after you cancel your own place." },
  past: { title: "No past friend spots", body: "Friends who played a session that has already ended will show up here, with any reward points earned." },
  cancelled: { title: "No cancelled friend spots", body: "Friend spots you cancel will show up here, with the refund and any points returned." },
};

export function FriendSpotsSection() {
  const dispatch = useDispatch<AppDispatch>();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [data, setData] = useState<Page<FriendSpot> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pageMove, setPageMove] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);
    myFriendSpots(tab, page, pageSize)
      .then((next) => {
        if (active) {
          setData(next);
          setError(null);
          void dispatch(loadCurrentUser());
        }
      })
      .catch(() => {
        if (active) setError("Friend spots could not be loaded.");
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
  }, [tab, page, pageSize, attempt, dispatch]);

  async function onSaveName(id: string) {
    const name = draftName.trim();
    if (name.length === 0) {
      setNotice("Enter a friend's name.");
      return;
    }
    setSavingId(id);
    setNotice(null);
    try {
      await renameFriend(id, name);
      setEditingId(null);
      setNotice("Name saved.");
      setAttempt((value) => value + 1);
    } catch (reason) {
      setNotice(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This friend's name could not be saved." : "This friend's name could not be saved.");
    } finally {
      setSavingId(null);
    }
  }

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
      setNotice("This friend spot could not be cancelled.");
    } finally {
      setPendingId(null);
    }
  }

  const groups = data ? groupBySocial(data.items) : [];
  const allOpen = groups.length > 0 && groups.every((spots) => openIds.has(spots[0].socialId));

  function toggle(socialId: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(socialId)) next.delete(socialId);
      else next.add(socialId);
      return next;
    });
  }

  return (
    <div>
      <h1 className="font-display text-3xl text-white">Friend spots</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mist/70">
        Places you hold for friends on a public social. They stay on the court even when you cancel your own registration.
      </p>
      <div className="mt-4 flex gap-2 overflow-auto" role="tablist" aria-label="Friend spot status">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-busy={loading && pageMove === null && tab === item.id}
            disabled={loading}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${tab === item.id ? "bg-line text-ink" : "border border-white/10 text-mist"}`}
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
          <span className="sr-only">Loading friend spots</span>
          <Skeleton className="h-36" />
          <Skeleton className="h-36" />
        </div>
      ) : groups.length > 0 ? (
        <>
        <div className="mt-4 flex justify-end">
          <Button
            variant="secondary"
            icon={<ChevronsUpDown className="h-4 w-4" aria-hidden="true" />}
            onClick={() => setOpenIds(allOpen ? new Set() : new Set(groups.map((spots) => spots[0].socialId)))}
          >
            {allOpen ? "Collapse all" : "Expand all"}
          </Button>
        </div>
        <ul className="mt-3 space-y-4">
          {groups.map((spots) => {
            const session = spots[0];
            const zone = session.timeZone || "Australia/Melbourne";
            const start = new Date(session.startTime);
            const freeUntil = new Date(start.getTime() - 24 * 60 * 60 * 1000);
            const soon = start.getTime() - Date.now() < 24 * 60 * 60 * 1000;
            const lateFee = session.lateFeePercent ?? 0;
            const live = spots.filter((spot) => spot.status === "confirmed" || spot.status === "waitlist");
            const paidTotal = live.reduce((sum, spot) => sum + spot.amount, 0);
            const canCancelAny = spots.some((spot) => spot.canCancel);
            const open = openIds.has(session.socialId);
            const counts = new Map<string, { label: string; tone: string; count: number }>();
            for (const spot of spots) {
              const status = spotStatus(spot.status, tab);
              const current = counts.get(status.label);
              counts.set(status.label, { ...status, count: (current?.count ?? 0) + 1 });
            }
            return (
              <li key={session.socialId} className="rounded-3xl border border-white/10 bg-black/20">
                <div className="flex gap-3 p-4 pb-3 sm:gap-4 sm:p-5 sm:pb-3">
                  <div className="flex w-14 shrink-0 flex-col items-center justify-center self-start rounded-xl border border-white/10 bg-white/[0.04] py-2 text-center sm:w-16">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-line">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, weekday: "short" }).format(start)}</span>
                    <span className="font-display text-2xl leading-none text-white">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, day: "numeric" }).format(start)}</span>
                    <span className="text-[11px] uppercase text-mist/70">{new Intl.DateTimeFormat("en-AU", { timeZone: zone, month: "short" }).format(start)}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-xs font-medium text-mist">
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        Public social
                      </span>
                      {tab === "upcoming" ? (
                        <>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${soon ? "bg-amber-400/15 text-amber-200" : "bg-white/5 text-mist/80"}`}>{startsIn(session.startTime)}</span>
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${session.youLeft ? "bg-amber-400/15 text-amber-200" : "bg-line/15 text-line"}`}>
                            {session.youLeft ? "Your place was cancelled" : "You're registered too"}
                          </span>
                        </>
                      ) : null}
                    </div>
                    <h2 className="mt-2 truncate font-medium text-white">{session.venueName}</h2>
                    <p className="flex items-center gap-1.5 text-sm text-mist/80">
                      <Clock className="h-3.5 w-3.5 shrink-0 text-mist/60" aria-hidden="true" />
                      {formatVenueRange(session.startTime, session.endTime, session.timeZone)}
                      <span className="text-mist/55">· {duration(session.startTime, session.endTime)}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="inline-flex items-center gap-1 font-medium text-white">
                        <Users className="h-3.5 w-3.5 text-line" aria-hidden="true" />
                        {spots.length} {spots.length === 1 ? "friend" : "friends"}
                      </span>
                      {[...counts.values()].map((item) => (
                        <span key={item.label} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${item.tone}`}>{item.count} {item.label.toLowerCase()}</span>
                      ))}
                      {live.length > 0 && paidTotal > 0 ? <span className="text-mist/70">· <Money amount={paidTotal} currency={session.currency} /> paid</span> : null}
                    </div>
                    {tab === "upcoming" && canCancelAny ? (
                      freeUntil.getTime() > Date.now() ? (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-mist/65"><ShieldCheck className="h-3.5 w-3.5 shrink-0 text-line" aria-hidden="true" />Free cancellation until {formatVenueDateTime(freeUntil.toISOString(), session.timeZone)}</p>
                      ) : lateFee > 0 ? (
                        <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-200/90"><TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Cancelling a paid friend now keeps {lateFee}% of their payment.</p>
                      ) : null
                    ) : null}
                  </div>
                </div>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`friends-${session.socialId}`}
                  className="flex w-full items-center justify-between gap-2 border-t border-white/10 px-4 py-3 text-sm font-medium text-line transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-line sm:px-5"
                  onClick={() => toggle(session.socialId)}
                >
                  <span>{open ? "Hide friends" : `Show ${spots.length === 1 ? "1 friend" : `all ${spots.length} friends`}`}</span>
                  <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
                </button>
                {open ? (
                <ul id={`friends-${session.socialId}`} className="space-y-2 px-4 pb-4 sm:px-5 sm:pb-5">
                  {spots.map((spot) => (
                    <li key={spot.id} className="rounded-2xl border border-white/10 bg-pine/50 px-3 py-3">
                      {editingId === spot.id ? (
                        <form
                          className="flex flex-col gap-2 sm:flex-row sm:items-end"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void onSaveName(spot.id);
                          }}
                        >
                          <label className="min-w-0 flex-1 text-sm text-mist/80">
                            Friend name
                            <input
                              value={draftName}
                              maxLength={80}
                              disabled={savingId === spot.id}
                              className="mt-1 w-full rounded-2xl border border-white/15 bg-black/20 px-3 py-2 text-white outline-none focus:border-line disabled:opacity-60"
                              onChange={(event) => setDraftName(event.target.value)}
                            />
                          </label>
                          <Button type="submit" className="w-full sm:w-auto" icon={<Save className="h-4 w-4" aria-hidden="true" />} loading={savingId === spot.id}>Save name</Button>
                          <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={savingId === spot.id} onClick={() => setEditingId(null)}>Cancel</Button>
                        </form>
                      ) : (
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <SpotDetails spot={spot} tab={tab} />
                          {spot.canRename || spot.canCancel ? (
                            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                              {spot.canRename ? (
                                <Button variant="secondary" className="w-full sm:w-auto" icon={<Pencil className="h-4 w-4" aria-hidden="true" />} disabled={pendingId !== null || savingId !== null} onClick={() => { setEditingId(spot.id); setDraftName(spot.name); setConfirmId(null); }}>Edit name</Button>
                              ) : null}
                              {spot.canCancel ? (
                                confirmId === spot.id ? (
                                  <>
                                    <Button variant="danger" className="w-full sm:w-auto" loading={pendingId === spot.id} onClick={() => void onCancel(spot.id)}>Confirm cancel</Button>
                                    <Button variant="secondary" className="w-full sm:w-auto" disabled={pendingId === spot.id} onClick={() => setConfirmId(null)}>Keep friend</Button>
                                  </>
                                ) : (
                                  <Button variant="secondary" className="w-full sm:w-auto" icon={<X className="h-4 w-4" aria-hidden="true" />} disabled={pendingId !== null || savingId !== null} onClick={() => setConfirmId(spot.id)}>Cancel friend</Button>
                                )
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
        </>
      ) : (
        <div className="mt-4"><EmptyState title={emptyCopy[tab].title} body={emptyCopy[tab].body} /></div>
      )}
      {data && !error && data.total > 0 ? (
        <ListPager
          page={page}
          pageSize={data.pageSize || pageSize}
          total={data.total}
          unit={data.total === 1 ? "session" : "sessions"}
          loading={loading}
          pageMove={pageMove}
          onPage={(next, move) => { setLoading(true); setPageMove(move); setPage(next); }}
          onPageSize={(size) => { setLoading(true); setPageMove(`size-${size}`); setPageSize(size); setPage(1); }}
        />
      ) : null}
    </div>
  );
}

function SpotDetails({ spot, tab }: { spot: FriendSpot; tab: Tab }) {
  const status = spotStatus(spot.status, tab);
  const subtotal = spot.subtotalAmount ?? spot.amount;
  const discount = spot.discountAmount ?? 0;
  const pointsUsed = spot.pointsRedeemed ?? 0;
  const fee = spot.cancelFeePercent ?? 0;
  const refund = spot.wasPaid ? Math.round(spot.amount * (100 - fee)) / 100 : 0;
  const pointsBack = fee > 0 ? Math.floor((pointsUsed * (100 - fee)) / 100) : pointsUsed;
  const place = spot.status === "waitlist"
    ? "Waiting for a place on court"
    : spot.courtNumber > 0
      ? spot.courtName.trim().toLowerCase() === `court ${spot.courtNumber}` ? spot.courtName : `${spot.courtName} · Court ${spot.courtNumber}`
      : "No court";

  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-line/15 text-sm font-semibold text-line">
        {initials(spot.name, spot.name)}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate font-medium text-white">{spot.name}</p>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status.tone}`}>{status.label}</span>
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-mist/75"><MapPin className="h-3.5 w-3.5 shrink-0 text-mist/60" aria-hidden="true" />{place}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-semibold text-white"><Money amount={spot.amount} currency={spot.currency} /></span>
          {subtotal > spot.amount ? <span className="text-xs text-mist/55 line-through"><Money amount={subtotal} currency={spot.currency} /></span> : null}
          {discount > 0 ? <span className="text-xs text-line">Promo −<Money amount={discount} currency={spot.currency} /></span> : null}
          {pointsUsed > 0 ? <span className="text-xs text-line">{pointsUsed} pts used</span> : null}
        </p>
        <div className="mt-1 space-y-0.5 text-xs text-mist/65">
          {tab === "past" && (spot.pointsEarned ?? 0) > 0 ? (
            <p className="flex items-center gap-1.5 text-line"><Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />+{spot.pointsEarned} reward points earned</p>
          ) : null}
          {tab === "cancelled" ? (
            <>
              {spot.status === "expired" ? (
                <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />The hold ended before payment, so nothing was charged.</p>
              ) : spot.cancelledAt ? (
                <p className="flex items-center gap-1.5"><X className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Cancelled {formatVenueDateTime(spot.cancelledAt, spot.timeZone)}</p>
              ) : null}
              {spot.status === "cancelled" && spot.wasPaid ? (
                <p className="flex items-center gap-1.5 text-sky-200"><Undo2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Refunded <Money amount={refund} currency={spot.currency} />{fee > 0 ? ` · ${fee}% late-cancel fee kept` : " · full refund"}
                </p>
              ) : spot.status === "cancelled" && spot.wasPaid === false ? (
                <p className="flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Not charged</p>
              ) : null}
              {spot.status === "cancelled" && pointsBack > 0 ? (
                <p className="flex items-center gap-1.5 text-line"><Gift className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{pointsBack} points returned to your balance</p>
              ) : null}
            </>
          ) : null}
          {spot.addedAt ? <p>Added {formatVenueDateTime(spot.addedAt, spot.timeZone)}</p> : null}
        </div>
      </div>
    </div>
  );
}

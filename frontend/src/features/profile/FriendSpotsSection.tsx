import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Save, X } from "lucide-react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "../../app/store";
import { Button, Skeleton, Spinner } from "../../components/ui";
import { EmptyState, ErrorState, Money, formatVenueDay, formatVenueRange, initials } from "../../components/format";
import { loadCurrentUser } from "../auth/authSlice";
import { AuthRequestError } from "../auth/authApi";
import { cancelBooking, myFriendSpots, renameFriend, type CancelResult, type FriendSpot, type Page } from "./profileApi";

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

function statusLabel(status: string) {
  if (status === "confirmed") return "On court";
  if (status === "waitlist") return "Waitlist";
  if (status === "pending") return "Waiting for payment";
  if (status === "cancelled") return "Cancelled";
  return "Expired";
}

export function FriendSpotsSection() {
  const dispatch = useDispatch<AppDispatch>();
  const [tab, setTab] = useState<(typeof tabs)[number]["id"]>("upcoming");
  const [page, setPage] = useState(1);
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
  const [pageMove, setPageMove] = useState<"prev" | "next" | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    myFriendSpots(tab, page)
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
  }, [tab, page, attempt, dispatch]);

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

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const groups = data ? groupBySocial(data.items) : [];
  const emptyCopy = tab === "upcoming"
    ? { title: "No friend spots yet", body: "Friends you add to a public social stay listed here, including after you cancel your own place." }
    : tab === "past"
      ? { title: "No past friend spots", body: "Friends who played a session that has already ended will show up here." }
      : { title: "No cancelled friend spots", body: "Friend spots you cancel will show up here." };

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
        <ul className="mt-4 space-y-4">
          {groups.map((spots) => {
            const session = spots[0];
            return (
              <li key={session.socialId} className="rounded-3xl border border-white/10 bg-black/20 p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-mist/50">Public social</p>
                    <h2 className="mt-1 truncate font-medium text-white">{session.venueName}</h2>
                    <p className="text-sm text-mist/70">
                      {formatVenueDay(session.startTime, session.timeZone)}
                      {" · "}
                      {formatVenueRange(session.startTime, session.endTime, session.timeZone)}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${session.youLeft ? "bg-line/15 text-line" : "bg-white/10 text-mist"}`}>
                    {session.youLeft ? "Your place was cancelled" : "You're registered too"}
                  </span>
                </div>
                <p className="mt-3 text-sm text-mist/70">
                  {spots.length} friend spot{spots.length === 1 ? "" : "s"}
                  {session.youLeft ? " still on this social." : " on this social."}
                </p>
                <ul className="mt-3 space-y-2">
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
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-line/15 text-sm font-semibold text-line">
                              {initials(spot.name, spot.name)}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-white">{spot.name}</p>
                              <p className="truncate text-sm text-mist/70">
                                {spot.status === "waitlist" ? "Waitlist · waiting for a place" : `${spot.courtName} · Court ${spot.courtNumber}`}
                                {" · "}
                                {statusLabel(spot.status)}
                                {spot.status === "confirmed" ? <> · <Money amount={spot.amount} currency={spot.currency} /></> : null}
                              </p>
                            </div>
                          </div>
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
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="mt-4"><EmptyState title={emptyCopy.title} body={emptyCopy.body} /></div>
      )}
      {data && data.total > data.pageSize ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <Button variant="secondary" icon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "prev"} disabled={page <= 1 || loading} onClick={() => { setLoading(true); setPageMove("prev"); setPage((value) => value - 1); }}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button variant="secondary" icon={<ChevronRight className="h-4 w-4" aria-hidden="true" />} loading={loading && pageMove === "next"} disabled={page >= pages || loading} onClick={() => { setLoading(true); setPageMove("next"); setPage((value) => value + 1); }}>Next</Button>
        </div>
      ) : null}
    </div>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, PickerInput, Spinner } from "../../components/ui";
import { applyWeekChange, weekAvailability, weekOpenTimes, WeekChangeError, type WeekFacts, type WeekSlot } from "../profile/profileApi";
import { WeekReason } from "../profile/WeekReason";

export function WeekExtendPage({ slug, groupId, search }: { slug: string; groupId: string; search: string }) {
  const navigate = useNavigate();
  const params = new URLSearchParams(search);
  const startTime = params.get("start") ?? "";
  const [date, setDate] = useState(params.get("date") ?? "");
  const locked = (params.get("courts") ?? "").split(",").filter(Boolean);
  const [courts, setCourts] = useState<{ id: string; courtName: string; yours: boolean; free: boolean }[] | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [times, setTimes] = useState<WeekSlot[] | null>(null);
  const [held, setHeld] = useState(false);
  const [loadingCourts, setLoadingCourts] = useState(true);
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [picked, setPicked] = useState<WeekSlot | null>(null);
  const [block, setBlock] = useState<{ fallback: string; facts: WeekFacts } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const selected = courts ? [...locked, ...extra.filter((id) => courts.some((court) => court.id === id))] : locked;

  useEffect(() => {
    let live = true;
    setLoadingCourts(true);
    weekAvailability(groupId, startTime)
      .then((result) => {
        if (live) setCourts(result.courts);
      })
      .catch(() => {
        if (live) setLoadError("Courts could not be loaded.");
      })
      .finally(() => {
        if (live) setLoadingCourts(false);
      });
    return () => {
      live = false;
    };
  }, [groupId, startTime]);

  useEffect(() => {
    if (!date || selected.length === 0) return;
    let live = true;
    setLoadingTimes(true);
    weekOpenTimes(groupId, startTime, date, selected)
      .then((result) => {
        if (!live) return;
        setTimes(result.times);
        setHeld(result.heldForRecurring.length > 0 && result.times.length === 0);
        setPicked((current) => current && result.times.some((slot) => slot.start === current.start && slot.date === current.date) ? current : null);
      })
      .catch(() => {
        if (live) setLoadError("Open times could not be loaded.");
      })
      .finally(() => {
        if (live) setLoadingTimes(false);
      });
    return () => {
      live = false;
    };
  }, [date, groupId, startTime, selected.join(",")]);

  async function confirm(slot: WeekSlot, acceptPriceIncrease = false) {
    if (acceptPriceIncrease) setAccepting(true);
    else setBusy(true);
    setBlock(null);
    try {
      const saved = await applyWeekChange(groupId, {
        startTime,
        date: slot.date,
        start: slot.start,
        end: slot.end,
        courtIds: selected,
        acceptPriceIncrease,
      });
      const payIds = saved.payNow ? saved.payBookingIds : saved.addedBookingIds;
      if ((saved.payNow || saved.topUpAmount > 0) && payIds.length > 0) {
        navigate(`/${slug}/book/group/${groupId}?bookings=${payIds.join(",")}`);
        return;
      }
      navigate(`/profile/bookings?venue=${encodeURIComponent(slug)}&weekSaved=1`);
    } catch (reason) {
      if (reason instanceof WeekChangeError) {
        setPicked(slot);
        setBlock({ fallback: reason.fallback, facts: reason.facts });
        if (reason.facts.alternatives.length > 0) setTimes(reason.facts.alternatives);
      } else {
        setLoadError("This week could not be updated.");
      }
    } finally {
      setBusy(false);
      setAccepting(false);
    }
  }

  return (
    <main className="w-full px-4 py-4 sm:px-6 lg:px-8">
      <Link to={`/profile/bookings?venue=${encodeURIComponent(slug)}`} className="text-sm text-line hover:underline">Back to my bookings</Link>
      <h1 className="mt-3 font-display text-3xl text-white">Add a court</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mist/75">Courts already on this week stay ticked. Tick another free court, then pick a time that works for every ticked court. This updates the same week.</p>
      {loadError ? <p className="mt-3 text-sm text-rose-100" role="alert">{loadError}</p> : null}
      {loadingCourts || !courts ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-mist" aria-busy="true"><Spinner className="h-4 w-4" /> Loading courts</p>
      ) : (
        <form className="mt-4 grid max-w-3xl gap-4" onSubmit={(event) => { event.preventDefault(); if (picked) void confirm(picked); }}>
          <fieldset>
            <legend className="mb-2 text-sm text-mist/70">Courts</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {courts.map((court) => {
                const checked = court.yours || extra.includes(court.id);
                const unavailable = !court.yours && !court.free;
                return (
                  <label key={court.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${unavailable ? "cursor-not-allowed border-white/5 text-mist/40" : "border-white/10 text-white"}`}>
                    <input
                      type="checkbox"
                      className="accent-line"
                      checked={checked}
                      disabled={busy || court.yours || unavailable}
                      onChange={() => {
                        setBlock(null);
                        setExtra((current) => current.includes(court.id) ? current.filter((id) => id !== court.id) : [...current, court.id]);
                      }}
                    />
                    <span className={unavailable ? "line-through" : ""}>{court.courtName}</span>
                    {court.yours ? <span className="ml-auto text-xs text-mist/60">This week</span> : unavailable ? <span className="ml-auto text-xs text-mist/50">Booked</span> : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="text-sm text-mist">
            <span className="mb-1 block text-mist/70">Date</span>
            <PickerInput type="date" required value={date} disabled={busy} onChange={(event) => { setDate(event.target.value); setBlock(null); }} className="w-full max-w-xs rounded-xl border border-[#102117]/15 bg-[#f4fbf6] px-3 py-2.5 text-[#102117] [color-scheme:light]" />
          </label>
          <div>
            <p className="text-sm text-mist/70">Times that fit every ticked court</p>
            {loadingTimes || times === null ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-mist" aria-busy="true"><Spinner className="h-4 w-4" /> Loading times</p>
            ) : times.length === 0 ? (
              <p className="mt-2 text-sm text-mist" role="status">{held ? "That time is held for a later week because you keep weeks ahead. Choose another date, or cancel that held week and book again." : "No open time on this date fits every court you ticked. Untick a court or pick another date."}</p>
            ) : (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {times.map((slot) => (
                  <button key={`${slot.date}-${slot.start}`} type="button" aria-pressed={picked?.start === slot.start && picked.date === slot.date} disabled={busy} className={`rounded-xl border px-3 py-2 text-left text-sm disabled:opacity-60 ${picked?.start === slot.start && picked.date === slot.date ? "border-line bg-line/15 text-white" : "border-white/10 text-mist"}`} onClick={() => { setPicked(slot); setBlock(null); }}>
                    {slot.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {block ? <WeekReason facts={block.facts} fallback={block.fallback} /> : null}
          {block?.facts.code === "PRICE_INCREASE" && picked ? (
            <Button type="button" className="w-full sm:w-auto" loading={accepting} disabled={busy && !accepting} onClick={() => void confirm(picked, true)}>Accept the difference and move</Button>
          ) : (
            <Button type="submit" className="w-full sm:w-auto" loading={busy} disabled={!picked || busy}>Update this week</Button>
          )}
        </form>
      )}
    </main>
  );
}

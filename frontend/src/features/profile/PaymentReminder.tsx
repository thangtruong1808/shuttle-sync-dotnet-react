import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Bell } from "lucide-react";
import type { RootState } from "../../app/store";
import { formatVenueDateTime, formatVenueRange } from "../../components/format";
import { Button } from "../../components/ui";
import { AuthRequestError } from "../auth/authApi";
import { deleteUnpaidHold, refreshUnpaidHolds, unpaidHoldListeners as listeners, unpaidHolds, type UnpaidHold } from "./profileApi";

function useUnpaidHolds() {
  const status = useSelector((state: RootState) => state.auth.status);
  const location = useLocation();
  const [items, setItems] = useState<UnpaidHold[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated") {
      setItems([]);
      return;
    }
    let live = true;
    unpaidHolds()
      .then((page) => {
        if (live) setItems(page.items);
      })
      .catch(() => {
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, [status, location.pathname, tick]);

  return items;
}

export function PaymentBell() {
  const items = useUnpaidHolds();
  if (items.length === 0) return null;
  const label = items.length === 1
    ? "1 unfinished payment. Complete it or delete it."
    : `${items.length} unfinished payments. Complete them or delete them.`;
  return (
    <NavLink
      to="/profile/bookings"
      title={label}
      aria-label={label}
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-amber-300/40 text-amber-100 hover:bg-amber-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-line"
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-amber-300 px-1 text-[10px] font-bold text-ink">
        {items.length}
      </span>
    </NavLink>
  );
}

function noticeText(item: UnpaidHold) {
  const when = formatVenueRange(item.startTime, item.endTime, item.timeZone);
  const courts = `${item.courtCount} ${item.courtCount === 1 ? "court" : "courts"}`;
  if (item.checkoutStarted) {
    return `Payment for ${item.venueName}, ${when} (${courts}) is not finished. Complete the payment, or delete this week.`;
  }
  return `${item.venueName}, ${when} (${courts}) is not paid yet. Pay before ${formatVenueDateTime(item.payBy, item.timeZone)}, or these courts are released.`;
}

function NoticeRow({ item }: { item: UnpaidHold }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteUnpaidHold(item.groupId, item.bookingIds);
      setConfirm(false);
      refreshUnpaidHolds();
    } catch (reason) {
      setError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This week could not be deleted." : "This week could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-amber-300/25 px-3 py-2.5 transition-colors hover:bg-amber-400/5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 leading-relaxed">
          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden="true" />
          <span>{noticeText(item)}</span>
        </p>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Link className="inline-flex items-center justify-center rounded-xl bg-amber-300 px-3 py-2 text-sm font-semibold text-ink hover:bg-amber-200" to={`/${item.venueSlug}/book/group/${item.groupId}?bookings=${item.bookingIds.join(",")}`}>
            {item.checkoutStarted ? "Complete payment" : "Pay this week"}
          </Link>
          {confirm && !busy ? (
            <Button type="button" variant="secondary" className="w-full sm:w-auto" onClick={() => setConfirm(false)}>Keep it</Button>
          ) : null}
          <Button type="button" variant="danger" className="w-full sm:w-auto" loading={busy} disabled={busy} onClick={() => void remove()}>
            {confirm ? "Confirm delete" : "Delete this week"}
          </Button>
        </div>
      </div>
      {confirm && !busy ? <p className="mt-2 text-sm text-amber-100">This releases the unpaid courts for this week only. Paid weeks stay, and Keep weeks ahead is turned off so this week is not added back.</p> : null}
      {error ? <p className="mt-2 rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium text-rose-100" role="alert">{error}</p> : null}
    </li>
  );
}

export function PaymentNotice() {
  const items = useUnpaidHolds();
  if (items.length === 0) return null;
  return (
    <section className="mb-4 rounded-2xl border border-amber-300/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-50" role="status" aria-label="Payments to finish">
      <p className="font-semibold text-amber-100">{items.length === 1 ? "1 week needs payment soon" : `${items.length} weeks need payment soon`}</p>
      <p className="mt-1 text-amber-50/80">Later weeks are still held. You only need to pay each week before 24 hours of that session.</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => <NoticeRow key={`${item.groupId}-${item.startTime}`} item={item} />)}
      </ul>
    </section>
  );
}

import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Bell } from "lucide-react";
import type { RootState } from "../../app/store";
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

export function PaymentNotice() {
  const items = useUnpaidHolds();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (items.length === 0) return null;
  const first = items[0];
  const text = items.length === 1
    ? `Payment for ${first.venueName} is not finished. Complete the payment, or delete this booking.`
    : `You have ${items.length} unfinished court payments. Complete a payment, or delete these bookings.`;

  async function remove() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const item of items) {
        await deleteUnpaidHold(item.groupId);
      }
      setConfirm(false);
      refreshUnpaidHolds();
    } catch (reason) {
      setError(reason instanceof AuthRequestError ? reason.fieldErrors.form?.[0] ?? "This booking could not be deleted." : "This booking could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-amber-300/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-50" role="status">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2">
          <Bell className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" aria-hidden="true" />
          <span>{text}</span>
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link className="inline-flex items-center justify-center rounded-xl bg-amber-300 px-3 py-2 text-sm font-semibold text-ink hover:bg-amber-200" to={`/${first.venueSlug}/book/group/${first.groupId}`}>
            Complete payment
          </Link>
          <Button type="button" variant="danger" className="w-full sm:w-auto" loading={busy} disabled={busy} onClick={() => void remove()}>
            {confirm ? "Confirm delete" : "Delete this booking"}
          </Button>
        </div>
      </div>
      {confirm && !busy ? <p className="text-sm text-amber-100">This releases every unpaid court. Paid weeks stay, and this booking will not add new unpaid weeks.</p> : null}
      {error ? <p className="rounded-xl border border-rose-300/50 bg-rose-500/15 px-3 py-2 text-sm font-medium text-rose-100" role="alert">{error}</p> : null}
    </div>
  );
}

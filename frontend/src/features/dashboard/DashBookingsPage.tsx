import { useState } from "react";
import { formatVenueDay, formatVenueRange, Money } from "../../components/format";
import { Button } from "../../components/ui";
import { DashError, listBookings, updateBookingStatus, type DashBooking } from "./dashboardApi";
import { control, Notice, Success, Tag, useBusy } from "./dashboardUi";
import { Shell, useVenueOptions } from "./OpsShell";

export function BookingsPage() {
  const venues = useVenueOptions();
  const [venueId, setVenueId] = useState("");
  const [status, setStatus] = useState("");
  const [applied, setApplied] = useState({ venueId: "", status: "" });
  const [tick, setTick] = useState(0);
  const [filtering, setFiltering] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <Shell
      title="Bookings"
      refreshKey={`${applied.venueId}:${applied.status}:${tick}`}
      load={(page, pageSize) => listBookings(applied.venueId, applied.status, page, pageSize)}
      locked={filtering}
      onSettled={() => setFiltering(false)}
      rowKey={(row: DashBooking) => row.id}
      extra={
        <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); setFiltering(true); setApplied({ venueId, status }); setTick((value) => value + 1); setNote("Filters applied."); }}>
          <select className={`${control} max-w-xs`} value={venueId} disabled={filtering} onChange={(event) => setVenueId(event.target.value)}>
            <option value="">All venues</option>
            {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
          <select className={`${control} max-w-[12rem]`} value={status} disabled={filtering} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any status</option>
            {["pending", "confirmed", "cancelled", "completed", "no_show", "expired"].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <Button type="submit" variant="secondary" loading={filtering}>Filter</Button>
          <Success message={note} />
        </form>
      }
      columns={[
        { label: "Player", cell: (row) => <span className="text-fg">{row.userEmail}</span> },
        { label: "Venue", cell: (row) => row.venueName },
        { label: "Type", cell: (row) => <Tag value={row.kind || "Court"} /> },
        { label: "Court", className: "whitespace-nowrap", cell: (row) => row.courtName },
        { label: "When", cell: (row) => <span className="whitespace-nowrap">{formatVenueDay(row.startTime, row.timeZone)}<span className="mt-0.5 block text-fg/70">{formatVenueRange(row.startTime, row.endTime, row.timeZone)}</span></span> },
        { label: "Status", cell: (row) => <Tag value={row.status} /> },
        { label: "Amount", className: "whitespace-nowrap", cell: (row) => <Money amount={row.totalAmount} currency={row.currency} /> },
        { label: "Actions", cell: (row, done) => <BookingActions row={row} onChanged={done} /> },
      ]}
    />
  );
}

function BookingActions({ row, onChanged }: { row: DashBooking; onChanged: (message: string) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const { busy, run } = useBusy();
  const isSocial = row.kind === "Drop-in social";
  const canCancel = row.status === "pending" || row.status === "confirmed" || (isSocial && row.status === "waitlist");
  const next = canCancel
    ? ["cancelled", ...(row.status === "confirmed" ? ["completed", "no_show"] : [])]
    : [];
  if (next.length === 0) return <span className="text-fg/50">—</span>;
  return (
    <div className="min-w-[11rem]">
      <div className="flex flex-wrap gap-2">
        {next.map((status) => (
          <Button key={status} variant="secondary" loading={busy === status} disabled={busy !== null && busy !== status} onClick={() => {
            void run(status, async () => {
              try {
                await updateBookingStatus(row.id, status);
                onChanged(`Booking marked ${status.replace(/_/g, " ")}.`);
              } catch (reason) {
                setMessage(reason instanceof DashError ? reason.message : "The status could not be changed.");
              }
            });
          }}>{status.replace(/_/g, " ")}</Button>
        ))}
      </div>
      <div className="mt-2"><Notice message={message} /></div>
    </div>
  );
}

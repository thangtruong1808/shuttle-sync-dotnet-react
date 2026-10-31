import { useState } from "react";
import { formatVenueDateTime, formatVenueDay, formatVenueRange, Money } from "../../components/format";
import { Button } from "../../components/ui";
import { listPayments, listRefunds, listWebhooks, type DashPage, type DashPayment, type DashWebhook } from "./dashboardApi";
import { control, Success, Tag } from "./dashboardUi";
import { Shell, useVenueOptions } from "./OpsShell";

export function PaymentsPage() {
  const [tab, setTab] = useState<"payments" | "refunds" | "webhooks">("payments");
  const venues = useVenueOptions();
  const [venueId, setVenueId] = useState("");
  const [applied, setApplied] = useState("");
  const [tick, setTick] = useState(0);
  const [filtering, setFiltering] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {(["payments", "refunds", "webhooks"] as const).map((item) => (
          <Button key={item} variant={tab === item ? "primary" : "secondary"} disabled={filtering} onClick={() => setTab(item)}>{item}</Button>
        ))}
      </div>
      {tab !== "webhooks" ? (
        <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); setFiltering(true); setApplied(venueId); setTick((value) => value + 1); setNote("Filters applied."); }}>
          <select className={`${control} max-w-xs`} value={venueId} disabled={filtering} onChange={(event) => setVenueId(event.target.value)}>
            <option value="">All venues</option>
            {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
          <Button type="submit" variant="secondary" loading={filtering}>Filter</Button>
          <Success message={note} />
        </form>
      ) : null}
      {tab === "payments" ? <MoneyList title="Payments" refreshKey={`payments:${applied}:${tick}`} locked={filtering} onSettled={() => setFiltering(false)} load={(page, pageSize) => listPayments(applied, page, pageSize)} /> : null}
      {tab === "refunds" ? <MoneyList title="Refunds" refreshKey={`refunds:${applied}:${tick}`} locked={filtering} onSettled={() => setFiltering(false)} load={(page, pageSize) => listRefunds(applied, page, pageSize)} /> : null}
      {tab === "webhooks" ? <WebhookList /> : null}
    </div>
  );
}

function MoneyList({ title, refreshKey, load, locked = false, onSettled }: { title: string; refreshKey: string; load: (page: number, pageSize: number) => Promise<DashPage<DashPayment>>; locked?: boolean; onSettled?: () => void }) {
  return (
    <Shell
      title={title}
      refreshKey={refreshKey}
      load={load}
      locked={locked}
      onSettled={onSettled}
      rowKey={(row) => row.id}
      columns={[
        { label: "Player", cell: (row) => <span className="text-fg">{row.userEmail || "—"}</span> },
        { label: "Venue", cell: (row) => row.venueName },
        { label: "Type", cell: (row) => <Tag value={row.kind || "Court"} /> },
        { label: "Court", cell: (row) => <CourtNames names={row.courtName} /> },
        {
          label: "Session",
          cell: (row) => row.startTime ? (
            <span className="whitespace-nowrap">
              {formatVenueDay(row.startTime, row.timeZone)}
              <span className="mt-0.5 block text-fg/70">{formatVenueRange(row.startTime, row.endTime, row.timeZone)}</span>
              {row.sessionCount > 1 ? <span className="mt-0.5 block text-fg/55">{row.sessionCount} sessions paid together</span> : null}
            </span>
          ) : "—",
        },
        { label: "Status", cell: (row) => <PaymentStatus row={row} /> },
        { label: "Amount", className: "whitespace-nowrap", cell: (row) => <Money amount={row.amount} currency={row.currency} /> },
        { label: "Recorded", className: "whitespace-nowrap", cell: (row) => formatVenueDateTime(row.occurredAt, row.timeZone || "UTC") },
      ]}
    />
  );
}

function PaymentStatus({ row }: { row: DashPayment }) {
  const refunded = row.refundedAmount ?? 0;
  if (refunded <= 0 || !["partially_refunded", "refunded"].includes(row.status)) return <Tag value={row.status} />;
  const kept = Math.max(0, row.amount - refunded);
  const label = row.status === "refunded" ? "Fully refunded" : "Partially refunded";
  return (
    <span className="block whitespace-nowrap">
      <span className="font-semibold text-amber-700 dark:text-amber-200"><Money amount={refunded} currency={row.currency} /> refunded</span>
      <span className="mt-0.5 block text-xs text-fg/60">
        {label}
        {kept > 0 ? <> · <Money amount={kept} currency={row.currency} /> kept</> : null}
      </span>
    </span>
  );
}

function CourtNames({ names }: { names: string }) {
  const courts = (names || "").split(",").map((name) => name.trim()).filter(Boolean);
  if (courts.length === 0) return <>—</>;
  if (courts.length === 1) return <span className="whitespace-nowrap">{courts[0]}</span>;
  return (
    <span className="block min-w-[8rem] max-w-[14rem]">
      <span className="whitespace-nowrap text-fg">{courts.length} courts</span>
      <span className="mt-0.5 block text-xs leading-5 text-fg/60">{courts.join(", ")}</span>
    </span>
  );
}

function WebhookList() {
  return (
    <Shell
      title="Webhooks"
      refreshKey="webhooks"
      load={(page, pageSize) => listWebhooks(page, pageSize)}
      rowKey={(row: DashWebhook) => row.id}
      columns={[
        { label: "Event", cell: (row) => <span className="text-fg">{row.eventType}</span> },
        { label: "Status", cell: (row) => <Tag value={row.status} /> },
        { label: "Received", className: "whitespace-nowrap", cell: (row) => formatVenueDateTime(row.createdAt, "UTC") },
      ]}
    />
  );
}

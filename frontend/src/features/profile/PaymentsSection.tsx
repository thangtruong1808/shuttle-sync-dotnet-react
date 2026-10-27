import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard, Undo2 } from "lucide-react";
import { DataTable, PageHeader, Skeleton, buttonClass } from "../../components/ui";
import { EmptyState, ErrorState, formatVenueDateTime, formatVenueDay, formatVenueRange } from "../../components/format";
import { useVenues } from "../../components/layout/SiteLayout";
import { myPayments, type Page, type PaymentRow } from "./profileApi";
import { ListPager } from "./ListPager";

export function PaymentsSection() {
  const { venues, defaultSlug } = useVenues();
  const venueSlug = defaultSlug ?? venues?.[0]?.slug ?? null;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [data, setData] = useState<Page<PaymentRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pageMove, setPageMove] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    myPayments(page, pageSize)
      .then((next) => {
        if (active) {
          setData(next);
          setError(null);
        }
      })
      .catch(() => {
        if (active) setError("Payments could not be loaded.");
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
  }, [page, pageSize, attempt]);

  return (
    <div>
      <PageHeader title="Payments and refunds" description="Every card charge and refund for your courts and public socials. Refunds go back to the card you paid with and can take 5–10 business days to appear." />
      {error ? (
        <div className="mt-4"><ErrorState message={error} loading={loading} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} /></div>
      ) : loading && pageMove === null ? (
        <div className="mt-4 space-y-3" aria-busy="true"><span className="sr-only">Loading payments</span><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>
      ) : data && data.items.length > 0 ? (
        <>
          <PaymentTable rows={data.items} />
          <ListPager
            page={page}
            pageSize={data.pageSize || pageSize}
            total={data.total}
            loading={loading}
            pageMove={pageMove}
            onPage={(next, move) => { setLoading(true); setPageMove(move); setPage(next); }}
            onPageSize={(size) => { setLoading(true); setPageMove(`size-${size}`); setPageSize(size); setPage(1); }}
          />
        </>
      ) : (
        <div className="mt-4">
          <EmptyState
            title="No payments yet"
            body="Card charges and refunds for your courts and public socials will be listed here."
            action={venueSlug ? <Link to={`/${venueSlug}/book`} className={buttonClass("primary", "sm")}>Book a court</Link> : undefined}
          />
        </div>
      )}
    </div>
  );
}

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: currency || "AUD" }).format(amount);
}

function paymentSession(row: PaymentRow) {
  if (!row.startTime || !row.endTime || Number.isNaN(Date.parse(row.startTime))) {
    return "—";
  }
  return `${formatVenueDay(row.startTime, row.timeZone)}, ${formatVenueRange(row.startTime, row.endTime, row.timeZone)}`;
}

function paymentStatus(row: PaymentRow) {
  const status = row.status.toLowerCase();
  if (status === "succeeded" || status === "paid" || status === "completed") {
    return { label: row.kind === "refund" ? "Refunded" : "Paid", tone: "bg-accent/15 text-accent-text" };
  }
  if (status === "pending" || status === "processing" || status === "requires_action") {
    return { label: "Processing", tone: "bg-amber-400/15 text-amber-700 dark:text-amber-200" };
  }
  if (status === "failed" || status === "canceled" || status === "cancelled") {
    return { label: status === "failed" ? "Failed" : "Cancelled", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-200" };
  }
  if (status.includes("refund")) {
    return { label: status.startsWith("partial") ? "Partly refunded" : "Refunded", tone: "bg-sky-400/15 text-sky-700 dark:text-sky-200" };
  }
  const label = status.replace(/_/g, " ");
  return { label: label.charAt(0).toUpperCase() + label.slice(1), tone: "bg-fg/10 text-fg" };
}

function PaymentStatusCell({ row }: { row: PaymentRow }) {
  const status = paymentStatus(row);
  const refunded = row.refundedAmount ?? 0;
  if (row.kind === "refund" || refunded <= 0 || !row.status.toLowerCase().includes("refund")) {
    return <span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>;
  }
  const kept = Math.max(0, row.amount - refunded);
  return (
    <span className="block whitespace-nowrap">
      <span className="font-semibold text-sky-700 dark:text-sky-200">{formatMoney(refunded, row.currency)} refunded</span>
      <span className="mt-0.5 block text-xs text-fg/60">
        {status.label}
        {kept > 0 ? ` · ${formatMoney(kept, row.currency)} kept` : ""}
      </span>
    </span>
  );
}

function PaymentTable({ rows }: { rows: PaymentRow[] }) {
  return (
    <DataTable
      className="mt-4"
      minWidth="min-w-[44rem]"
      rows={rows}
      rowKey={(row) => `${row.kind}-${row.id}`}
      columns={[
        {
          label: "Type",
          cell: (row) => (
            <>
              <span className={`flex items-center gap-1.5 font-medium ${row.kind === "refund" ? "text-sky-700 dark:text-sky-200" : "text-fg"}`}>
                {row.kind === "refund" ? <Undo2 className="h-4 w-4" aria-hidden="true" /> : <CreditCard className="h-4 w-4 text-accent-text" aria-hidden="true" />}
                {row.kind === "refund" ? "Refund" : "Payment"}
              </span>
              <span className="mt-0.5 block text-xs text-fg-muted">{row.source}</span>
            </>
          ),
        },
        { label: "Date", cell: (row) => formatVenueDateTime(row.occurredAt, row.timeZone) },
        {
          label: "Venue and court",
          cell: (row) => (
            <>
              <span className="block text-fg">{row.venueName}</span>
              <span className="mt-0.5 block text-xs text-fg-muted">{row.courtNames || "Court to be assigned"}{row.courtCount > 1 ? ` · ${row.courtCount} courts` : ""}</span>
            </>
          ),
        },
        { label: "Session", cell: (row) => paymentSession(row) },
        { label: "Status", cell: (row) => <PaymentStatusCell row={row} /> },
        {
          label: "Amount",
          className: "text-right",
          cell: (row) => <span className={`font-semibold tabular-nums ${row.kind === "refund" ? "text-sky-700 dark:text-sky-200" : "text-fg"}`}>{row.kind === "refund" ? "+" : ""}{formatMoney(row.amount, row.currency)}</span>,
        },
      ]}
    />
  );
}

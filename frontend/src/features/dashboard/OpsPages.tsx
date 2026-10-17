import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../../app/store";
import { EmptyState, ErrorState, formatVenueDateTime, formatVenueDay, formatVenueRange, Money } from "../../components/format";
import { Button, PickerInput, Skeleton, Spinner } from "../../components/ui";
import { dashboardVenues, type Venue } from "../venues/venueApi";
import {
  DashError,
  listActivity,
  listAwards,
  listBookings,
  listPayments,
  listPromotions,
  deletePromotion,
  listRedemptions,
  listRefunds,
  listWebhooks,
  savePromotion,
  updateBookingStatus,
  type DashActivity,
  type DashAward,
  type DashBooking,
  type DashPage,
  type DashPayment,
  type DashPromo,
  type DashRedemption,
  type DashWebhook,
} from "./dashboardApi";
import { Check, control, DataTable, Field, Notice, PageSummary, Pager, Success, Tag, useBusy, type PageMove } from "./dashboardUi";

function activityPage(detail: string | null): string {
  if (!detail) return "—";
  try {
    const parsed = JSON.parse(detail) as { title?: string; path?: string };
    return parsed.title || parsed.path || detail;
  } catch {
    return detail;
  }
}

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function activitySection(path: string | null | undefined): string {
  const part = (path ?? "").replace(/^\/dashboard\/?/, "").split(/[/?#]/)[0];
  if (!part) return "Overview";
  return part.replace(/-/g, " ");
}

function activityPath(row: DashActivity): string | null {
  if (row.path) return row.path;
  try {
    return (JSON.parse(row.detail ?? "") as { path?: string }).path ?? null;
  } catch {
    return null;
  }
}

function timeOnPage(start: string, next: string | null | undefined): string {
  if (next === undefined) return "—";
  if (!next) return "Last page viewed";
  const seconds = Math.round((new Date(next).getTime() - new Date(start).getTime()) / 1000);
  if (seconds < 0) return "—";
  if (seconds > 30 * 60) return "Over 30 min";
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} sec`;
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function useVenueOptions() {
  const [venues, setVenues] = useState<Venue[]>([]);
  useEffect(() => {
    dashboardVenues().then(setVenues).catch(() => setVenues([]));
  }, []);
  return venues;
}

export function Shell<T>({
  title,
  refreshKey,
  load,
  render,
  columns,
  rowKey,
  extra,
  locked = false,
  onSettled,
}: {
  title: string;
  refreshKey: string;
  load: (page: number, pageSize: number) => Promise<DashPage<T>>;
  render?: (item: T, done: (message: string) => void) => ReactNode;
  columns?: { label: string; className?: string; cell: (item: T, done: (message: string) => void) => ReactNode }[];
  rowKey?: (item: T) => string;
  extra?: ReactNode;
  locked?: boolean;
  onSettled?: () => void;
}) {
  const [page, setPage] = useState(1);
  const [seen, setSeen] = useState(refreshKey);
  const [data, setData] = useState<DashPage<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState<PageMove | null>(null);
  const [pageSize, setPageSize] = useState(10);
  const [pendingSize, setPendingSize] = useState<number | null>(null);
  const { busy, run } = useBusy();
  const loadRef = useRef(load);
  const settledRef = useRef(onSettled);
  loadRef.current = load;
  settledRef.current = onSettled;
  if (seen !== refreshKey) {
    setSeen(refreshKey);
    setPage(1);
    setPending(null);
  }

  useEffect(() => {
    let active = true;
    setError(null);
    loadRef.current(page, pageSize)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "The list could not be loaded.");
      })
      .finally(() => {
        if (!active) return;
        setRetrying(false);
        setPending(null);
        setPendingSize(null);
        settledRef.current?.();
      });
    return () => {
      active = false;
    };
  }, [attempt, page, pageSize, refreshKey]);

  const done = (note: string) => {
    setSuccess(note);
    setAttempt((value) => value + 1);
  };
  const table = columns && rowKey;

  return (
    <div>
      <h1 className="font-display text-3xl text-white">{title}</h1>
      <div className="mt-4"><Success message={success} /></div>
      {extra}
      {table && data && !error ? (
        <PageSummary
          page={page}
          pageSize={pageSize}
          total={data.total}
          pendingSize={pendingSize}
          locked={locked || pending !== null}
          onPageSize={(size) => {
            if (size === pageSize || pendingSize !== null || pending !== null || locked) return;
            setPendingSize(size);
            setPending(null);
            setPage(1);
            setPageSize(size);
          }}
        />
      ) : null}
      {error ? (
        <div className="mt-6"><ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /></div>
      ) : data === null ? (
        <div className="mt-6" aria-busy="true"><span className="sr-only">Loading {title}</span><Skeleton className="h-40" /></div>
      ) : data.items.length === 0 ? (
        <div className="mt-6"><EmptyState title="Nothing here" body="Records will show up after they exist." /></div>
      ) : table ? (
        <DataTable busy={pending !== null || pendingSize !== null || locked} rows={data.items} rowKey={rowKey} columns={columns.map((column) => ({ ...column, cell: (item: T) => column.cell(item, done) }))} />
      ) : (
        <ul className="mt-6 grid gap-2">{data.items.map((item) => render?.(item, done))}</ul>
      )}
      {!error && data && data.total > 0 ? (
        table ? (
          <Pager
            numbered
            page={page}
            pageSize={data.pageSize}
            total={data.total}
            pending={pending}
            locked={locked || pendingSize !== null}
            onPage={(next, key) => {
              if (next === page || pending !== null || pendingSize !== null || locked) return;
              setPending(key === "page" ? next : key);
              setPage(next);
            }}
          />
        ) : (
          <Pager page={page} pageSize={data.pageSize} total={data.total} busy={busy} onPage={(next, key) => { void run(key === "page" ? "next" : key, async () => setPage(next)); }} />
        )
      ) : null}
    </div>
  );
}

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
        { label: "Player", cell: (row) => <span className="text-white">{row.userEmail}</span> },
        { label: "Venue", cell: (row) => row.venueName },
        { label: "Type", cell: (row) => <Tag value={row.kind || "Court"} /> },
        { label: "Court", className: "whitespace-nowrap", cell: (row) => row.courtName },
        { label: "When", cell: (row) => <span className="whitespace-nowrap">{formatVenueDay(row.startTime, row.timeZone)}<span className="mt-0.5 block text-mist/70">{formatVenueRange(row.startTime, row.endTime, row.timeZone)}</span></span> },
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
  const courtBooking = (row.kind || "Court") === "Court";
  const next = courtBooking && (row.status === "pending" || row.status === "confirmed")
    ? ["cancelled", ...(row.status === "confirmed" ? ["completed", "no_show"] : [])]
    : [];
  if (next.length === 0) return <span className="text-mist/50">—</span>;
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

function localDate(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Promotions always run 00:01–23:59 on the chosen calendar days (local). */
function promoRangeIso(fromDate: string, toDate: string): { validFrom: string; validTo: string } {
  return {
    validFrom: new Date(`${fromDate}T00:01:00`).toISOString(),
    validTo: new Date(`${toDate}T23:59:00`).toISOString(),
  };
}

function todayLocalDate(): string {
  return localDate(new Date().toISOString());
}

function addLocalDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00`);
  next.setDate(next.getDate() + days);
  return localDate(next.toISOString());
}

export function PromotionsPage() {
  const admin = useSelector((state: RootState) => state.auth.user?.role) === "admin";
  const venues = useVenueOptions();
  const [venueId, setVenueId] = useState("");
  const [applied, setApplied] = useState("");
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: "",
    discountType: "percent",
    discountValue: "10",
    maxUses: "",
    maxUsesPerUser: "1",
    validFrom: todayLocalDate(),
    validTo: addLocalDays(todayLocalDate(), 365),
    isActive: true,
    venueId: "",
  });
  const { busy, run } = useBusy();

  return (
    <Shell
      title="Promotions"
      refreshKey={`${applied}:${revision}`}
      load={(page) => listPromotions(applied, page)}
      extra={
        <div className="mt-4 grid gap-4">
          <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void run("filter", async () => { setApplied(venueId); setNote("Filters applied."); }); }}>
            <select className={`${control} max-w-xs`} value={venueId} onChange={(event) => setVenueId(event.target.value)}>
              <option value="">All codes</option>
              {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
            </select>
            <Button type="submit" variant="secondary" loading={busy === "filter"}>Filter</Button>
            <Success message={note} />
          </form>
          <form
            className="grid gap-3 rounded-2xl border border-white/10 p-4 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              setMessage(null);
              setNote(null);
              void run("save", async () => {
                try {
                  const range = promoRangeIso(form.validFrom, form.validTo);
                  await savePromotion({
                    venueId: form.venueId || null,
                    code: form.code,
                    discountType: form.discountType,
                    discountValue: Number(form.discountValue),
                    maxUses: null,
                    maxUsesPerUser: 1000000,
                    validFrom: range.validFrom,
                    validTo: range.validTo,
                    isActive: form.isActive,
                  });
                  setRevision((value) => value + 1);
                  setNote("Promotion created.");
                  setForm((current) => ({
                    ...current,
                    code: "",
                    discountValue: "10",
                    validFrom: todayLocalDate(),
                    validTo: addLocalDays(todayLocalDate(), 365),
                  }));
                } catch (reason) {
                  setMessage(reason instanceof DashError ? reason.message : "The code could not be saved.");
                }
              });
            }}
          >
            <Field label="Code"><input className={control} value={form.code} disabled={busy !== null} onChange={(event) => setForm({ ...form, code: event.target.value })} required /></Field>
            <Field label="Venue">
              <select className={control} value={form.venueId} disabled={busy !== null} onChange={(event) => setForm({ ...form, venueId: event.target.value })} required={!admin}>
                {admin ? <option value="">Global</option> : null}
                {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select className={control} value={form.discountType} disabled={busy !== null} onChange={(event) => setForm({ ...form, discountType: event.target.value })}>
                <option value="percent">percent</option>
                <option value="fixed">fixed</option>
              </select>
            </Field>
            <Field label="Value"><input className={control} type="number" min={0} step="0.01" value={form.discountValue} disabled={busy !== null} onChange={(event) => setForm({ ...form, discountValue: event.target.value })} /></Field>
            <Field label="Valid from">
              <PickerInput className={control} type="date" value={form.validFrom} disabled={busy !== null} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} required />
              <span className="mt-1 block text-xs text-mist/60">Starts at 00:01 on this day.</span>
            </Field>
            <Field label="Valid to">
              <PickerInput className={control} type="date" value={form.validTo} disabled={busy !== null} onChange={(event) => setForm({ ...form, validTo: event.target.value })} required />
              <span className="mt-1 block text-xs text-mist/60">Ends at 23:59 on this day.</span>
            </Field>
            <Check label="Active" checked={form.isActive} disabled={busy !== null} onChange={(checked) => setForm({ ...form, isActive: checked })} />
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
              <Notice message={message} />
              <Button type="submit" loading={busy === "save"} disabled={busy !== null && busy !== "save"}>Create code</Button>
            </div>
          </form>
        </div>
      }
      render={(row: DashPromo, reload) => <PromoRow key={row.id} row={row} admin={admin} venues={venues} onChanged={reload} />}
    />
  );
}

function promoForm(row: DashPromo) {
  return {
    code: row.code,
    discountType: row.discountType,
    discountValue: String(row.discountValue),
    validFrom: localDate(row.validFrom),
    validTo: localDate(row.validTo),
    isActive: row.isActive,
    venueId: row.venueId ?? "",
  };
}

function PromoRow({ row, admin, venues, onChanged }: { row: DashPromo; admin: boolean; venues: Venue[]; onChanged: (message: string) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [form, setForm] = useState(() => promoForm(row));
  const { busy, run } = useBusy();
  const venueName = venues.find((venue) => venue.id === row.venueId)?.name ?? (row.venueId ? "One venue" : "All venues");

  return (
    <li className="rounded-2xl border border-white/10 p-3 text-sm text-mist transition-colors hover:bg-white/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-white">{row.code}</span>
        <span>{row.discountType} {row.discountValue} · {row.usedCount} used · {row.isActive ? "active" : "inactive"} · {venueName}</span>
        <span>{localDate(row.validFrom)} 00:01 → {localDate(row.validTo)} 23:59</span>
        {admin ? (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {confirming ? (
              <>
                <Button variant="danger" className="w-full sm:w-auto" loading={busy === "delete"} disabled={busy !== null && busy !== "delete"} onClick={() => {
                  void run("delete", async () => {
                    try {
                      await deletePromotion(row.id);
                      onChanged("Promotion deleted.");
                    } catch (reason) {
                      setMessage(reason instanceof DashError ? reason.message : "The code could not be deleted.");
                      setConfirming(false);
                    }
                  });
                }}>Delete this code</Button>
                <Button variant="secondary" className="w-full sm:w-auto" disabled={busy !== null} onClick={() => setConfirming(false)}>Keep it</Button>
              </>
            ) : (
              <>
                <Button variant="secondary" className="w-full sm:w-auto" disabled={busy !== null} onClick={() => {
                  setMessage(null);
                  setForm(promoForm(row));
                  setEditing((open) => !open);
                  setConfirming(false);
                }}>{editing ? "Close" : "Edit"}</Button>
                <Button variant="danger" className="w-full sm:w-auto" disabled={busy !== null} onClick={() => { setEditing(false); setConfirming(true); setMessage(null); }}>Delete</Button>
              </>
            )}
          </div>
        ) : null}
      </div>
      {editing ? (
        <form
          className="mt-3 grid gap-3 border-t border-white/10 pt-3 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            void run("save", async () => {
              try {
                const range = promoRangeIso(form.validFrom, form.validTo);
                await savePromotion({
                  venueId: form.venueId || null,
                  code: form.code,
                  discountType: form.discountType,
                  discountValue: Number(form.discountValue),
                  maxUses: row.maxUses,
                  maxUsesPerUser: row.maxUsesPerUser,
                  validFrom: range.validFrom,
                  validTo: range.validTo,
                  isActive: form.isActive,
                }, row.id);
                setEditing(false);
                onChanged("Promotion updated.");
              } catch (reason) {
                setMessage(reason instanceof DashError ? reason.message : "The code could not be updated.");
              }
            });
          }}
        >
          <Field label="Code"><input className={control} value={form.code} disabled={busy !== null} onChange={(event) => setForm({ ...form, code: event.target.value })} required /></Field>
          <Field label="Venue">
            <select className={control} value={form.venueId} disabled={busy !== null} onChange={(event) => setForm({ ...form, venueId: event.target.value })}>
              <option value="">All venues</option>
              {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className={control} value={form.discountType} disabled={busy !== null} onChange={(event) => setForm({ ...form, discountType: event.target.value })}>
              <option value="percent">percent</option>
              <option value="fixed">fixed</option>
            </select>
          </Field>
          <Field label="Value"><input className={control} type="number" min={0} step="0.01" value={form.discountValue} disabled={busy !== null} onChange={(event) => setForm({ ...form, discountValue: event.target.value })} required /></Field>
          <Field label="Valid from">
            <PickerInput className={control} type="date" value={form.validFrom} disabled={busy !== null} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} required />
            <span className="mt-1 block text-xs text-mist/60">Starts at 00:01 on this day.</span>
          </Field>
          <Field label="Valid to">
            <PickerInput className={control} type="date" value={form.validTo} disabled={busy !== null} onChange={(event) => setForm({ ...form, validTo: event.target.value })} required />
            <span className="mt-1 block text-xs text-mist/60">Ends at 23:59 on this day.</span>
          </Field>
          <Check label="Active" checked={form.isActive} disabled={busy !== null} onChange={(checked) => setForm({ ...form, isActive: checked })} />
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Notice message={message} />
            <Button type="submit" className="w-full sm:w-auto" loading={busy === "save"} disabled={busy !== null && busy !== "save"}>Save changes</Button>
          </div>
        </form>
      ) : <Notice message={message} />}
    </li>
  );
}

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
      {tab === "payments" ? <MoneyList key={`${applied}:${tick}`} title="Payments" locked={filtering} onSettled={() => setFiltering(false)} load={(page, pageSize) => listPayments(applied, page, pageSize)} /> : null}
      {tab === "refunds" ? <MoneyList key={`r-${applied}:${tick}`} title="Refunds" locked={filtering} onSettled={() => setFiltering(false)} load={(page, pageSize) => listRefunds(applied, page, pageSize)} /> : null}
      {tab === "webhooks" ? <WebhookList /> : null}
    </div>
  );
}

function MoneyList({ title, load, locked = false, onSettled }: { title: string; load: (page: number, pageSize: number) => Promise<DashPage<DashPayment>>; locked?: boolean; onSettled?: () => void }) {
  return (
    <Shell
      title={title}
      refreshKey={title}
      load={load}
      locked={locked}
      onSettled={onSettled}
      rowKey={(row) => row.id}
      columns={[
        { label: "Player", cell: (row) => <span className="text-white">{row.userEmail || "—"}</span> },
        { label: "Venue", cell: (row) => row.venueName },
        { label: "Type", cell: (row) => <Tag value={row.kind || "Court"} /> },
        { label: "Court", cell: (row) => <CourtNames names={row.courtName} /> },
        {
          label: "Session",
          cell: (row) => row.startTime ? (
            <span className="whitespace-nowrap">
              {formatVenueDay(row.startTime, row.timeZone)}
              <span className="mt-0.5 block text-mist/70">{formatVenueRange(row.startTime, row.endTime, row.timeZone)}</span>
              {row.sessionCount > 1 ? <span className="mt-0.5 block text-mist/55">{row.sessionCount} sessions paid together</span> : null}
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
      <span className="font-semibold text-amber-200"><Money amount={refunded} currency={row.currency} /> refunded</span>
      <span className="mt-0.5 block text-xs text-mist/60">
        {label}
        {kept > 0 ? <> · <Money amount={kept} currency={row.currency} /> kept</> : null}
      </span>
    </span>
  );
}

function AwardPoints({ row }: { row: DashAward }) {
  const courts = row.courtCount ?? 1;
  const cancelled = row.cancelledCourts ?? 0;
  return (
    <span className="block min-w-[8rem] max-w-[14rem]">
      <span className="whitespace-nowrap font-semibold text-white">+{row.points} pts</span>
      {courts > 1 ? <span className="mt-0.5 block whitespace-nowrap text-xs text-mist/60">Total for {courts} courts</span> : null}
      {cancelled > 0 ? (
        <span className="mt-0.5 block text-xs leading-5 text-amber-300">
          {cancelled} {cancelled === 1 ? "court" : "courts"} cancelled, no points
          {row.cancelledCourtNames ? `: ${row.cancelledCourtNames}` : ""}
        </span>
      ) : null}
    </span>
  );
}

function CourtNames({ names }: { names: string }) {
  const courts = (names || "").split(",").map((name) => name.trim()).filter(Boolean);
  if (courts.length === 0) return <>—</>;
  if (courts.length === 1) return <span className="whitespace-nowrap">{courts[0]}</span>;
  return (
    <span className="block min-w-[8rem] max-w-[14rem]">
      <span className="whitespace-nowrap text-white">{courts.length} courts</span>
      <span className="mt-0.5 block text-xs leading-5 text-mist/60">{courts.join(", ")}</span>
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
        { label: "Event", cell: (row) => <span className="text-white">{row.eventType}</span> },
        { label: "Status", cell: (row) => <Tag value={row.status} /> },
        { label: "Received", className: "whitespace-nowrap", cell: (row) => formatVenueDateTime(row.createdAt, "UTC") },
      ]}
    />
  );
}

export function RewardsPage() {
  const [tab, setTab] = useState<"awards" | "redemptions">("awards");
  const venues = useVenueOptions();
  const [venueId, setVenueId] = useState("");
  const [applied, setApplied] = useState("");
  const [tick, setTick] = useState(0);
  const [filtering, setFiltering] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div>
      <div className="flex gap-2">
        <Button variant={tab === "awards" ? "primary" : "secondary"} disabled={filtering} onClick={() => setTab("awards")}>Awards</Button>
        <Button variant={tab === "redemptions" ? "primary" : "secondary"} disabled={filtering} onClick={() => setTab("redemptions")}>Redemptions</Button>
      </div>
      <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); setFiltering(true); setApplied(venueId); setTick((value) => value + 1); setNote("Filters applied."); }}>
        <select className={`${control} max-w-xs`} value={venueId} disabled={filtering} onChange={(event) => setVenueId(event.target.value)}>
          <option value="">All venues</option>
          {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
        </select>
        <Button type="submit" variant="secondary" loading={filtering}>Filter</Button>
        <Success message={note} />
      </form>
      {tab === "awards" ? (
        <Shell
          key={`${applied}:${tick}`}
          title="Reward awards"
          refreshKey={applied}
          load={(page, pageSize) => listAwards(applied, page, pageSize)}
          locked={filtering}
          onSettled={() => setFiltering(false)}
          rowKey={(row: DashAward) => row.id}
          columns={[
            { label: "Player", cell: (row) => <span className="text-white">{row.userEmail}</span> },
            { label: "Venue", cell: (row) => row.venueName },
            {
              label: "Source",
              cell: (row) => (
                <span className="block min-w-[8rem] max-w-[14rem]">
                  {row.source || "Court booking"}
                  {row.courtNames ? <span className="mt-0.5 block text-xs leading-5 text-mist/60">{row.courtNames}</span> : null}
                </span>
              ),
            },
            { label: "Points", cell: (row) => <AwardPoints row={row} /> },
            { label: "Session", cell: (row) => <span className="whitespace-nowrap">{formatVenueDay(row.startTime, row.timeZone)}<span className="mt-0.5 block text-mist/70">{formatVenueRange(row.startTime, row.endTime, row.timeZone)}</span></span> },
            { label: "Awarded", className: "whitespace-nowrap", cell: (row) => formatVenueDateTime(row.awardedAt, row.timeZone) },
          ]}
        />
      ) : (
        <Shell
          key={`red-${applied}:${tick}`}
          title="Redemptions"
          refreshKey={applied}
          load={(page, pageSize) => listRedemptions(applied, page, pageSize)}
          locked={filtering}
          onSettled={() => setFiltering(false)}
          rowKey={(row: DashRedemption) => row.id}
          columns={[
            { label: "Code", cell: (row) => <span className="text-white">{row.code}</span> },
            { label: "Player", cell: (row) => row.userEmail },
            { label: "Venue", cell: (row) => row.venueName },
            { label: "Discount", className: "whitespace-nowrap", cell: (row) => row.discountAmount },
            { label: "When", className: "whitespace-nowrap", cell: (row) => formatVenueDateTime(row.createdAt, "UTC") },
          ]}
        />
      )}
    </div>
  );
}

export function ActivityPage() {
  const admin = useSelector((state: RootState) => state.auth.user?.role) === "admin";
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ userId: "", from: "", to: "" });
  const [tick, setTick] = useState(0);
  const [filtering, setFiltering] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <Shell
      title="Activity"
      refreshKey={`${applied.userId}:${applied.from}:${applied.to}:${tick}`}
      load={(page, pageSize) => listActivity(applied.userId, applied.from, applied.to, page, pageSize)}
      locked={filtering}
      onSettled={() => setFiltering(false)}
      rowKey={(row: DashActivity) => row.id}
      extra={
        <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); setFiltering(true); setApplied({ userId: admin ? userId.trim() : "", from, to }); setTick((value) => value + 1); setNote("Filters applied."); }}>
          {admin ? <input className={`${control} max-w-xs`} placeholder="Staff user id" value={userId} disabled={filtering} onChange={(event) => setUserId(event.target.value)} /> : null}
          <PickerInput className={control} type="date" value={from} disabled={filtering} onChange={(event) => setFrom(event.target.value)} aria-label="From" />
          <PickerInput className={control} type="date" value={to} disabled={filtering} onChange={(event) => setTo(event.target.value)} aria-label="To" />
          <Button type="submit" variant="secondary" loading={filtering}>Filter</Button>
          <Success message={note} />
        </form>
      }
      columns={[
        {
          label: "Staff",
          cell: (row) => (
            <div className="min-w-0">
              <p className="font-medium text-white">{row.displayName || row.userEmail || "Staff"}</p>
              {row.displayName && row.userEmail ? <p className="text-xs text-mist/60">{row.userEmail}</p> : null}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {row.role ? <Tag value={row.role} /> : null}
                {admin && row.userId && (applied.userId !== row.userId || filtering) ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-line hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={filtering}
                    onClick={() => { setFiltering(true); setUserId(row.userId!); setApplied({ userId: row.userId!, from, to }); setTick((value) => value + 1); setNote(`Showing ${row.displayName || row.userEmail || "this staff member"} only.`); }}
                  >
                    {filtering && applied.userId === row.userId ? <Spinner className="h-3 w-3" /> : null}
                    Only this staff
                  </button>
                ) : null}
              </div>
            </div>
          ),
        },
        {
          label: "Page",
          cell: (row) => (
            <div className="min-w-0">
              <p className="text-white">{row.title || activityPage(row.detail)}</p>
              {activityPath(row) ? <p className="font-mono text-xs text-mist/55">{activityPath(row)}</p> : null}
            </div>
          ),
        },
        { label: "Section", className: "whitespace-nowrap", cell: (row) => <Tag value={activitySection(activityPath(row))} /> },
        { label: "Venue", className: "whitespace-nowrap", cell: (row) => row.venueName?.trim() ? <span className="text-white">{row.venueName}</span> : <span className="text-mist/50">N/A</span> },
        { label: "Time on page", className: "whitespace-nowrap", cell: (row) => timeOnPage(row.createdAt, row.nextViewAt) },
        { label: "IP address", className: "whitespace-nowrap", cell: (row) => <span className="font-mono text-xs">{row.ipAddress || "—"}</span> },
        {
          label: "When",
          className: "whitespace-nowrap",
          cell: (row) => (
            <div>
              <p>{formatVenueDateTime(row.createdAt, localZone)}</p>
              <p className="text-xs text-mist/55">{timeAgo(row.createdAt)}</p>
            </div>
          ),
        },
      ]}
    />
  );
}

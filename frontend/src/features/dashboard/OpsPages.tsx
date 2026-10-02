import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../../app/store";
import { EmptyState, ErrorState, formatVenueDateTime, formatVenueRange, Money } from "../../components/format";
import { Button, PickerInput, Skeleton } from "../../components/ui";
import { dashboardVenues, type Venue } from "../venues/venueApi";
import {
  DashError,
  listActivity,
  listAwards,
  listBookings,
  listPayments,
  listPromotions,
  listRecommendations,
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
  type DashRecommendation,
  type DashRedemption,
  type DashWebhook,
} from "./dashboardApi";
import { Check, control, Field, Notice, Pager, Success, useBusy } from "./dashboardUi";

function useVenueOptions() {
  const [venues, setVenues] = useState<Venue[]>([]);
  useEffect(() => {
    dashboardVenues().then(setVenues).catch(() => setVenues([]));
  }, []);
  return venues;
}

function Shell<T>({
  title,
  refreshKey,
  load,
  render,
  extra,
}: {
  title: string;
  refreshKey: string;
  load: (page: number) => Promise<DashPage<T>>;
  render: (item: T, done: (message: string) => void) => ReactNode;
  extra?: ReactNode;
}) {
  const [page, setPage] = useState(1);
  const [seen, setSeen] = useState(refreshKey);
  const [data, setData] = useState<DashPage<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const { busy, run } = useBusy();
  const loadRef = useRef(load);
  loadRef.current = load;
  if (seen !== refreshKey) {
    setSeen(refreshKey);
    setPage(1);
  }

  useEffect(() => {
    let active = true;
    setError(null);
    loadRef.current(page)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "The list could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, page, refreshKey]);

  return (
    <div>
      <h1 className="font-display text-3xl text-white">{title}</h1>
      <div className="mt-4"><Success message={success} /></div>
      {extra}
      {error ? (
        <div className="mt-6"><ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /></div>
      ) : data === null ? (
        <div className="mt-6" aria-busy="true"><span className="sr-only">Loading {title}</span><Skeleton className="h-40" /></div>
      ) : data.items.length === 0 ? (
        <div className="mt-6"><EmptyState title="Nothing here" body="Records will show up after they exist." /></div>
      ) : (
        <ul className="mt-6 grid gap-2">{data.items.map((item) => render(item, (note) => { setSuccess(note); setAttempt((value) => value + 1); }))}</ul>
      )}
      {data ? <Pager page={page} pageSize={data.pageSize} total={data.total} busy={busy} onPage={(next, key) => { void run(key, async () => setPage(next)); }} /> : null}
    </div>
  );
}

export function BookingsPage() {
  const venues = useVenueOptions();
  const [venueId, setVenueId] = useState("");
  const [status, setStatus] = useState("");
  const [applied, setApplied] = useState({ venueId: "", status: "" });
  const [note, setNote] = useState<string | null>(null);
  const { busy, run } = useBusy();
  return (
    <Shell
      title="Bookings"
      refreshKey={`${applied.venueId}:${applied.status}`}
      load={(page) => listBookings(applied.venueId, applied.status, page)}
      extra={
        <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void run("filter", async () => { setApplied({ venueId, status }); setNote("Filters applied."); }); }}>
          <select className={`${control} max-w-xs`} value={venueId} onChange={(event) => setVenueId(event.target.value)}>
            <option value="">All venues</option>
            {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
          <select className={`${control} max-w-[12rem]`} value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any status</option>
            {["pending", "confirmed", "cancelled", "completed", "no_show", "expired"].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <Button type="submit" variant="secondary" loading={busy === "filter"}>Filter</Button>
          <Success message={note} />
        </form>
      }
      render={(row: DashBooking, done) => <BookingRow key={row.id} row={row} onChanged={done} />}
    />
  );
}

function BookingRow({ row, onChanged }: { row: DashBooking; onChanged: (message: string) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const { busy, run } = useBusy();
  const next = row.status === "pending" || row.status === "confirmed"
    ? ["cancelled", ...(row.status === "confirmed" ? ["completed", "no_show"] : [])]
    : [];
  return (
    <li className="rounded-2xl border border-white/10 p-3 text-sm text-mist">
      <p className="text-white">{row.userEmail}</p>
      <p>{row.venueName} · {row.courtName}</p>
      <p>{formatVenueRange(row.startTime, row.endTime, row.timeZone)} · {row.status} · <Money amount={row.totalAmount} currency={row.currency} /></p>
      <div className="mt-2 flex flex-wrap gap-2">
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
          }}>{status}</Button>
        ))}
      </div>
      <Notice message={message} />
    </li>
  );
}

function localInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function PromotionsPage() {
  const admin = useSelector((state: RootState) => state.auth.user?.role) === "admin";
  const venues = useVenueOptions();
  const [venueId, setVenueId] = useState("");
  const [applied, setApplied] = useState("");
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", discountType: "percent", discountValue: "10", maxUses: "", maxUsesPerUser: "1", validFrom: "", validTo: "", isActive: true, venueId: "" });
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
                  await savePromotion({
                    venueId: form.venueId || null,
                    code: form.code,
                    discountType: form.discountType,
                    discountValue: Number(form.discountValue),
                    maxUses: null,
                    maxUsesPerUser: 1000000,
                    validFrom: new Date(form.validFrom).toISOString(),
                    validTo: new Date(form.validTo).toISOString(),
                    isActive: form.isActive,
                  });
                  setRevision((value) => value + 1);
                  setNote("Promotion created.");
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
            <Field label="Valid from"><PickerInput className={control} type="datetime-local" value={form.validFrom} disabled={busy !== null} onChange={(event) => setForm({ ...form, validFrom: event.target.value })} required /></Field>
            <Field label="Valid to"><PickerInput className={control} type="datetime-local" value={form.validTo} disabled={busy !== null} onChange={(event) => setForm({ ...form, validTo: event.target.value })} required /></Field>
            <Check label="Active" checked={form.isActive} disabled={busy !== null} onChange={(checked) => setForm({ ...form, isActive: checked })} />
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
              <Notice message={message} />
              <Button type="submit" loading={busy === "save"} disabled={busy !== null && busy !== "save"}>Create code</Button>
            </div>
          </form>
        </div>
      }
      render={(row: DashPromo, reload) => <PromoRow key={row.id} row={row} onChanged={reload} />}
    />
  );
}

function PromoRow({ row, onChanged }: { row: DashPromo; onChanged: (message: string) => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const { busy, run } = useBusy();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 p-3 text-sm text-mist">
      <span className="text-white">{row.code}</span>
      <span>{row.discountType} {row.discountValue} · {row.usedCount} used · {row.isActive ? "active" : "inactive"}</span>
      <span>{localInput(row.validFrom)} → {localInput(row.validTo)}</span>
      <Button variant="secondary" loading={busy === "toggle"} onClick={() => {
        void run("toggle", async () => {
          try {
            await savePromotion({ ...row, isActive: !row.isActive }, row.id);
            onChanged(row.isActive ? "Promotion deactivated." : "Promotion activated.");
          } catch (reason) {
            setMessage(reason instanceof DashError ? reason.message : "The code could not be updated.");
          }
        });
      }}>{row.isActive ? "Deactivate" : "Activate"}</Button>
      <Notice message={message} />
    </li>
  );
}

export function PaymentsPage() {
  const [tab, setTab] = useState<"payments" | "refunds" | "webhooks">("payments");
  const venues = useVenueOptions();
  const [venueId, setVenueId] = useState("");
  const [applied, setApplied] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const { busy, run } = useBusy();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {(["payments", "refunds", "webhooks"] as const).map((item) => (
          <Button key={item} variant={tab === item ? "primary" : "secondary"} onClick={() => setTab(item)}>{item}</Button>
        ))}
      </div>
      {tab !== "webhooks" ? (
        <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void run("filter", async () => { setApplied(venueId); setNote("Filters applied."); }); }}>
          <select className={`${control} max-w-xs`} value={venueId} onChange={(event) => setVenueId(event.target.value)}>
            <option value="">All venues</option>
            {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
          </select>
          <Button type="submit" variant="secondary" loading={busy === "filter"}>Filter</Button>
          <Success message={note} />
        </form>
      ) : null}
      {tab === "payments" ? <MoneyList key={applied} title="Payments" load={(page) => listPayments(applied, page)} /> : null}
      {tab === "refunds" ? <MoneyList key={`r-${applied}`} title="Refunds" load={(page) => listRefunds(applied, page)} /> : null}
      {tab === "webhooks" ? <WebhookList /> : null}
    </div>
  );
}

function MoneyList({ title, load }: { title: string; load: (page: number) => Promise<DashPage<DashPayment>> }) {
  return (
    <Shell
      title={title}
      refreshKey={title}
      load={load}
      render={(row: DashPayment) => (
        <li key={row.id} className="rounded-2xl border border-white/10 p-3 text-sm text-mist">
          <span className="text-white">{row.venueName}</span> · {row.kind || row.status} · <Money amount={row.amount} currency={row.currency} /> · {formatVenueDateTime(row.occurredAt, "UTC")}
        </li>
      )}
    />
  );
}

function WebhookList() {
  return (
    <Shell
      title="Webhooks"
      refreshKey="webhooks"
      load={(page) => listWebhooks(page)}
      render={(row: DashWebhook) => (
        <li key={row.id} className="rounded-2xl border border-white/10 p-3 text-sm text-mist">
          {row.eventType} · {row.status} · {formatVenueDateTime(row.createdAt, "UTC")}
        </li>
      )}
    />
  );
}

export function RewardsPage() {
  const [tab, setTab] = useState<"awards" | "redemptions">("awards");
  const venues = useVenueOptions();
  const [venueId, setVenueId] = useState("");
  const [applied, setApplied] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const { busy, run } = useBusy();
  return (
    <div>
      <div className="flex gap-2">
        <Button variant={tab === "awards" ? "primary" : "secondary"} onClick={() => setTab("awards")}>Awards</Button>
        <Button variant={tab === "redemptions" ? "primary" : "secondary"} onClick={() => setTab("redemptions")}>Redemptions</Button>
      </div>
      <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void run("filter", async () => { setApplied(venueId); setNote("Filters applied."); }); }}>
        <select className={`${control} max-w-xs`} value={venueId} onChange={(event) => setVenueId(event.target.value)}>
          <option value="">All venues</option>
          {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
        </select>
        <Button type="submit" variant="secondary" loading={busy === "filter"}>Filter</Button>
        <Success message={note} />
      </form>
      {tab === "awards" ? (
        <Shell key={applied} title="Reward awards" refreshKey={applied} load={(page) => listAwards(applied, page)} render={(row: DashAward) => (
          <li key={row.id} className="rounded-2xl border border-white/10 p-3 text-sm text-mist">
            {row.userEmail} · {row.venueName} · {row.points} pts · {formatVenueRange(row.startTime, row.endTime, row.timeZone)}
          </li>
        )} />
      ) : (
        <Shell key={`red-${applied}`} title="Redemptions" refreshKey={applied} load={(page) => listRedemptions(applied, page)} render={(row: DashRedemption) => (
          <li key={row.id} className="rounded-2xl border border-white/10 p-3 text-sm text-mist">
            {row.code} · {row.userEmail} · {row.venueName} · {row.discountAmount} · {formatVenueDateTime(row.createdAt, "UTC")}
          </li>
        )} />
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
  const [note, setNote] = useState<string | null>(null);
  const { busy, run } = useBusy();
  return (
    <Shell
      title="Activity"
      refreshKey={`${applied.userId}:${applied.from}:${applied.to}`}
      load={(page) => listActivity(applied.userId, applied.from, applied.to, page)}
      extra={
        <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void run("filter", async () => { setApplied({ userId: admin ? userId.trim() : "", from, to }); setNote("Filters applied."); }); }}>
          {admin ? <input className={`${control} max-w-xs`} placeholder="Staff user id" value={userId} onChange={(event) => setUserId(event.target.value)} /> : null}
          <PickerInput className={control} type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From" />
          <PickerInput className={control} type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To" />
          <Button type="submit" variant="secondary" loading={busy === "filter"}>Filter</Button>
          <Success message={note} />
        </form>
      }
      render={(row: DashActivity) => (
        <li key={row.id} className="rounded-2xl border border-white/10 p-3 text-sm text-mist">
          <span className="text-white">{row.displayName || row.userEmail || "Staff"}</span> viewed {row.detail} {row.venueName ? `· ${row.venueName}` : ""} · {formatVenueDateTime(row.createdAt, "UTC")}
        </li>
      )}
    />
  );
}

export function RecommendationsPage() {
  return (
    <Shell
      title="Recommendations"
      refreshKey="recommendations"
      load={(page) => listRecommendations(page)}
      render={(row: DashRecommendation) => (
        <li key={row.id} className="rounded-2xl border border-white/10 p-3 text-sm text-mist">
          {row.userEmail} · {row.recommendationType} · {row.venueName || "Any venue"} · {formatVenueDateTime(row.createdAt, "UTC")}
        </li>
      )}
    />
  );
}

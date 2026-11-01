import { useEffect, useState } from "react";
import { EmptyState, ErrorState, formatVenueDay, formatVenueRange } from "../../components/format";
import { Button, PickerInput, Skeleton } from "../../components/ui";
import { control, Field, Notice, Success, useBusy } from "./dashboardUi";
import { today, venueLocalDate, venueLocalTime } from "./venueDeskTime";
import {
  createClosure,
  DashError,
  deleteClosure,
  listClosures,
  listCourts,
  updateClosure,
  type DashClosure,
  type DashCourt,
} from "./dashboardApi";
export function Closures({ venueId, timeZone, venueName }: { venueId: string; timeZone?: string; venueName: string }) {
  const [courts, setCourts] = useState<DashCourt[]>([]);
  const [rows, setRows] = useState<DashClosure[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [draft, setDraft] = useState(() => ({ courtId: "", date: today(timeZone), toDate: today(timeZone), start: "09:00", end: "18:00", reason: "", everyDay: false }));
  const { busy, run } = useBusy();

  useEffect(() => {
    let active = true;
    Promise.all([listCourts(venueId), listClosures(venueId)])
      .then(([courtRows, closures]) => {
        if (!active) return;
        setCourts(courtRows);
        setRows(closures);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "Closures could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, venueId]);

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-3 rounded-2xl border border-fg/10 p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          setSuccess(null);
          const toDate = draft.toDate || draft.date;
          if (toDate < draft.date) {
            setMessage("The to date must be on or after the from date.");
            return;
          }
          void run("create", async () => {
            try {
              const warning = await createClosure(venueId, { courtId: draft.courtId || null, date: draft.date, toDate, start: draft.start, end: draft.end, reason: draft.reason, everyDay: draft.everyDay });
              setRows(await listClosures(venueId));
              setMessage(warning);
              setSuccess(draft.everyDay ? (toDate > draft.date ? `Closed every day from ${prettyDay(draft.date)} to ${prettyDay(toDate)}.` : `Closed every day from ${prettyDay(draft.date)} onward.`) : "Closure added.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The closure could not be saved.");
            }
          });
        }}
      >
        <div className="sm:col-span-2">
          <Field label="Court">
            <select className={control} value={draft.courtId} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, courtId: event.target.value })}>
              <option value="">{venueName}</option>
              {courts.map((court) => <option key={court.id} value={court.id}>{court.courtName}</option>)}
            </select>
          </Field>
        </div>
        <Field label="From date">
          <PickerInput className={control} type="date" required value={draft.date} disabled={busy !== null} onChange={(event) => {
            const date = event.target.value;
            setDraft({ ...draft, date, toDate: draft.toDate < date ? date : draft.toDate });
          }} />
        </Field>
        <Field label="To date">
          <PickerInput className={control} type="date" required value={draft.toDate} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, toDate: event.target.value })} />
        </Field>
        <Field label="Start">
          <PickerInput className={control} type="time" required value={draft.start} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
        </Field>
        <Field label="End">
          <PickerInput className={control} type="time" required value={draft.end} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
        </Field>
        <label className="flex items-start gap-2 text-sm text-fg sm:col-span-2">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-[#c6f54e]"
            checked={draft.everyDay}
            disabled={busy !== null}
            onChange={(event) => setDraft({ ...draft, everyDay: event.target.checked })}
          />
          <span>
            <span className="font-medium">Every day</span>
            <span className="mt-0.5 block text-fg/65">Closes these hours from the from date onward, for example 12:00 AM to 7:00 AM every morning. Leave the to date the same as the from date for no end date. A later to date is the last day. The hours in between stay open. Leave this off to close one continuous block.</span>
          </span>
        </label>
        <div className="sm:col-span-2">
          <Field label="Reason">
            <input className={control} type="text" placeholder="Early morning, public holiday, maintenance" value={draft.reason} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" loading={busy === "create"} disabled={busy !== null && busy !== "create"}>Add closure</Button>
        </div>
        <div className="sm:col-span-2 flex flex-wrap gap-2"><Notice message={message} /><Success message={success} /></div>
      </form>
      {error ? <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /> : rows === null ? <Skeleton className="h-24" /> : rows.length === 0 ? <EmptyState title="No closures" body="Closures block bookings for a court or the whole venue." /> : (
        <ul className="grid gap-2">
          {rows.map((row) => <ClosureRow key={row.id} venueId={venueId} venueName={venueName} courts={courts} row={row} onChanged={(note) => { setSuccess(note); setAttempt((value) => value + 1); }} />)}
        </ul>
      )}
    </div>
  );
}

function prettyDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function ClosureRow({ venueId, venueName, courts, row, onChanged }: { venueId: string; venueName: string; courts: DashCourt[]; row: DashClosure; onChanged: (message: string) => void }) {
  const zone = row.timeZone || "Australia/Melbourne";
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    courtId: row.courtId ?? "",
    date: row.fromDate || venueLocalDate(row.startTime, zone),
    toDate: row.untilDate || row.fromDate || venueLocalDate(row.endTime, zone),
    start: venueLocalTime(row.startTime, zone),
    end: venueLocalTime(row.endTime, zone),
    reason: row.reason ?? "",
    everyDay: Boolean(row.repeatsDaily),
  });
  const [message, setMessage] = useState<string | null>(null);
  const { busy, run } = useBusy();
  return (
    <li className="grid gap-3 rounded-2xl border border-fg/10 p-3 text-sm text-fg">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg">{row.courtName}</span>
        {row.repeatsDaily ? (
          <span>Every day from {prettyDay(row.fromDate || form.date)}{row.untilDate ? ` to ${prettyDay(row.untilDate)}` : ""}</span>
        ) : (
          <span>{formatVenueDay(row.startTime, zone)}</span>
        )}
        <span>{formatVenueRange(row.startTime, row.endTime, zone)}</span>
        <span>{row.reason}</span>
        <Button variant="secondary" disabled={busy !== null} onClick={() => { setMessage(null); setEditing((open) => !open); }}>Edit</Button>
        <Button variant="danger" loading={busy === "delete"} disabled={busy !== null && busy !== "delete"} onClick={() => {
          void run("delete", async () => {
            try {
              await deleteClosure(venueId, row.id);
              onChanged("Closure removed.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The closure could not be deleted.");
            }
          });
        }}>Delete</Button>
      </div>
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Court">
            <select className={control} value={form.courtId} disabled={busy !== null} onChange={(event) => setForm({ ...form, courtId: event.target.value })}>
              <option value="">{venueName}</option>
              {courts.map((court) => <option key={court.id} value={court.id}>{court.courtName}</option>)}
            </select>
          </Field>
          <Field label="From date">
            <PickerInput className={control} type="date" required value={form.date} disabled={busy !== null} onChange={(event) => {
              const date = event.target.value;
              setForm({ ...form, date, toDate: form.toDate < date ? date : form.toDate });
            }} />
          </Field>
          <Field label="To date">
            <PickerInput className={control} type="date" required value={form.toDate} disabled={busy !== null} onChange={(event) => setForm({ ...form, toDate: event.target.value })} />
          </Field>
          <Field label="Start">
            <PickerInput className={control} type="time" value={form.start} disabled={busy !== null} onChange={(event) => setForm({ ...form, start: event.target.value })} />
          </Field>
          <Field label="End">
            <PickerInput className={control} type="time" value={form.end} disabled={busy !== null} onChange={(event) => setForm({ ...form, end: event.target.value })} />
          </Field>
          <label className="flex items-start gap-2 text-sm text-fg sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-[#c6f54e]"
              checked={form.everyDay}
              disabled={busy !== null}
              onChange={(event) => setForm({ ...form, everyDay: event.target.checked })}
            />
            <span>Every day. A to date that matches the from date keeps these hours closed with no end date.</span>
          </label>
          <div className="sm:col-span-2">
            <Field label="Reason">
              <input className={control} type="text" placeholder="Early morning, public holiday, maintenance" value={form.reason} disabled={busy !== null} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
            </Field>
          </div>
          <div className="flex items-end">
            <Button loading={busy === "save"} disabled={busy !== null && busy !== "save"} onClick={() => {
              const toDate = form.toDate || form.date;
              if (toDate < form.date) {
                setMessage("The to date must be on or after the from date.");
                return;
              }
              void run("save", async () => {
                try {
                  const warning = await updateClosure(venueId, row.id, { courtId: form.courtId || null, date: form.date, toDate, start: form.start, end: form.end, reason: form.reason, everyDay: form.everyDay });
                  setEditing(false);
                  if (warning) setMessage(warning);
                  onChanged("Closure saved.");
                } catch (reason) {
                  setMessage(reason instanceof DashError ? reason.message : "The closure could not be saved.");
                }
              });
            }}>Save</Button>
          </div>
        </div>
      ) : null}
      <Notice message={message} />
    </li>
  );
}


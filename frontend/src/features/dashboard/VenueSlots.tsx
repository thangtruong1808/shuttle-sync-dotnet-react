import { useEffect, useState } from "react";
import { EmptyState, ErrorState, Money, formatVenueDay, formatVenueRange } from "../../components/format";
import { Button, PickerInput, Skeleton } from "../../components/ui";
import { control, Field, Notice, Success, useBusy } from "./dashboardUi";
import { today, venueLocalDate, venueLocalTime } from "./venueDeskTime";
import {
  createSocial,
  deleteSocial,
  listSocials,
  updateSocial,
  DashError,
  listCourts,
  type DashSocial,
} from "./dashboardApi";
export function Slots({ venueId, currency, timeZone }: { venueId: string; currency: string; timeZone?: string }) {
  const [date, setDate] = useState(() => today(timeZone));
  const [rows, setRows] = useState<DashSocial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [courtTotal, setCourtTotal] = useState<number | null>(null);
  const [draft, setDraft] = useState({ start: "18:00", end: "20:00", price: "", playersPerCourt: "8", courtLimit: "", repeatWeekly: false });
  const { busy, run } = useBusy();

  useEffect(() => {
    let active = true;
    listSocials(venueId)
      .then((socials) => {
        if (active) { setRows(socials); setError(null); }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "Social times could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    listCourts(venueId)
      .then((courts) => {
        if (active) setCourtTotal(courts.filter((court) => court.isActive).length);
      })
      .catch(() => {
        if (active) setCourtTotal(null);
      });
    return () => {
      active = false;
    };
  }, [attempt, venueId]);

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-3 rounded-2xl border border-fg/10 p-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          setSuccess(null);
          void run("create", async () => {
            try {
              await createSocial(venueId, {
                date,
                start: draft.start,
                end: draft.end,
                price: Number(draft.price),
                playersPerCourt: Number(draft.playersPerCourt),
                maxCourts: draft.courtLimit.trim() ? Number(draft.courtLimit) : null,
                repeatWeekly: draft.repeatWeekly,
              });
              setRows(await listSocials(venueId));
              setDraft((current) => ({ ...current, repeatWeekly: false }));
              setSuccess(draft.repeatWeekly
                ? "Drop-in social added. This slot repeats weekly after the session ends."
                : "Drop-in social added. Players register from the homepage, starting on court 1.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The social could not be created.");
            }
          });
        }}
      >
        <Field label="Date">
          <PickerInput className={control} type="date" value={date} disabled={busy !== null} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Start">
          <PickerInput className={control} type="time" value={draft.start} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
        </Field>
        <Field label="End">
          <PickerInput className={control} type="time" value={draft.end} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
        </Field>
        <Field label="Session price">
          <input className={control} type="number" min={0.01} step="0.01" required value={draft.price} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
        </Field>
        <Field label="Players per court">
          <input className={control} type="number" min={1} max={32} step={1} required value={draft.playersPerCourt} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, playersPerCourt: event.target.value })} />
        </Field>
        <Field label="Court limit">
          <input className={control} type="number" min={1} max={courtTotal ?? 50} step={1} placeholder="All courts" value={draft.courtLimit} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, courtLimit: event.target.value })} />
        </Field>
        <label className="flex items-start gap-2 text-sm text-fg sm:col-span-2 lg:col-span-3">
          <input
            type="checkbox"
            className="mt-0.5 accent-accent-text"
            checked={draft.repeatWeekly}
            disabled={busy !== null}
            onChange={(event) => setDraft({ ...draft, repeatWeekly: event.target.checked })}
          />
          <span>Repeat this slot weekly. After this session ends, the same hours and price are added for the next week.</span>
        </label>
        <p className="text-sm text-fg/70 sm:col-span-2 lg:col-span-3">
          Players pay this session price. Court bookings still use the hourly rate. Court 1 fills first, then the next court, up to the court limit.
          {courtTotal === null ? "" : ` This venue has ${courtTotal} court${courtTotal === 1 ? "" : "s"}. Leave the court limit blank to use all of them.`}
        </p>
        <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-2">
          <Notice message={message} />
          <Success message={success} />
          <Button type="submit" loading={busy === "create"} disabled={(busy !== null && busy !== "create") || !(Number(draft.price) > 0) || !(Number(draft.playersPerCourt) >= 1)}>
            Add public social
          </Button>
        </div>
      </form>
      {error ? (
        <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} />
      ) : rows === null ? (
        <div aria-busy="true"><span className="sr-only">Loading social times</span><Skeleton className="h-24" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="No drop-in social" body="Add the hours and the session price. Players pay that price to register." />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <SocialRow key={row.id} venueId={venueId} currency={currency} row={row} onChanged={(note) => { setSuccess(note); setAttempt((value) => value + 1); }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SocialRow({ venueId, currency, row, onChanged }: { venueId: string; currency: string; row: DashSocial; onChanged: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    date: venueLocalDate(row.startTime, row.timeZone),
    start: venueLocalTime(row.startTime, row.timeZone),
    end: venueLocalTime(row.endTime, row.timeZone),
    price: String(row.price ?? ""),
    playersPerCourt: String(row.playersPerCourt || 8),
    courtLimit: row.maxCourts == null ? "" : String(row.maxCourts),
    repeatWeekly: row.repeatWeekly,
  });
  const [message, setMessage] = useState<string | null>(null);
  const { busy, run } = useBusy();
  return (
    <li className="grid gap-3 rounded-2xl border border-fg/10 p-3 text-sm text-fg">
      <div className="grid gap-1">
        <p className="font-semibold text-fg">{formatVenueDay(row.startTime, row.timeZone)}</p>
        <div className="flex flex-wrap items-center gap-2">
        <span className="whitespace-nowrap">{formatVenueRange(row.startTime, row.endTime, row.timeZone)}</span>
        <span className="font-semibold text-fg"><Money amount={row.price} currency={currency} /></span>
        <span className="text-fg">{row.playerCount} player{row.playerCount === 1 ? "" : "s"}</span>
        <span>{row.playersPerCourt} per court · {row.maxCourts == null ? "all courts" : `${row.maxCourts} court${row.maxCourts === 1 ? "" : "s"}`}</span>
        <Button variant="secondary" disabled={busy !== null} onClick={() => { setMessage(null); setEditing((open) => !open); }}>Edit</Button>
        <Button variant="danger" loading={busy === "delete"} disabled={busy !== null && busy !== "delete"} onClick={() => {
          void run("delete", async () => {
            try {
              await deleteSocial(venueId, row.id);
              onChanged("Drop-in social removed.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The social could not be deleted.");
            }
          });
        }}>Delete</Button>
        </div>
        {row.repeatWeekly ? <p className="text-sm font-medium text-accent-text">This slot repeats weekly.</p> : null}
      </div>
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Date">
            <PickerInput className={control} type="date" value={form.date} disabled={busy !== null} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </Field>
          <Field label="Start">
            <PickerInput className={control} type="time" value={form.start} disabled={busy !== null} onChange={(event) => setForm({ ...form, start: event.target.value })} />
          </Field>
          <Field label="End">
            <PickerInput className={control} type="time" value={form.end} disabled={busy !== null} onChange={(event) => setForm({ ...form, end: event.target.value })} />
          </Field>
          <Field label="Session price">
            <input className={control} type="number" min={0.01} step="0.01" required value={form.price} disabled={busy !== null} onChange={(event) => setForm({ ...form, price: event.target.value })} />
          </Field>
          <Field label="Players per court">
            <input className={control} type="number" min={1} max={32} step={1} required value={form.playersPerCourt} disabled={busy !== null} onChange={(event) => setForm({ ...form, playersPerCourt: event.target.value })} />
          </Field>
          <Field label="Court limit">
            <input className={control} type="number" min={1} step={1} placeholder="All courts" value={form.courtLimit} disabled={busy !== null} onChange={(event) => setForm({ ...form, courtLimit: event.target.value })} />
          </Field>
          <label className="flex items-start gap-2 text-sm text-fg sm:col-span-2">
            <input type="checkbox" className="mt-0.5 accent-accent-text" checked={form.repeatWeekly} disabled={busy !== null} onChange={(event) => setForm({ ...form, repeatWeekly: event.target.checked })} />
            <span>Repeat this slot weekly</span>
          </label>
          <div className="flex items-end">
            <Button loading={busy === "save"} disabled={(busy !== null && busy !== "save") || !(Number(form.playersPerCourt) >= 1)} onClick={() => {
              void run("save", async () => {
                try {
                  await updateSocial(venueId, row.id, {
                    date: form.date,
                    start: form.start,
                    end: form.end,
                    price: Number(form.price),
                    playersPerCourt: Number(form.playersPerCourt),
                    maxCourts: form.courtLimit.trim() ? Number(form.courtLimit) : null,
                    repeatWeekly: form.repeatWeekly,
                  });
                  setEditing(false);
                  onChanged("Drop-in social saved.");
                } catch (reason) {
                  setMessage(reason instanceof DashError ? reason.message : "The social could not be saved.");
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


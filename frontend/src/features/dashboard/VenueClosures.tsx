import { useEffect, useState } from "react";
import { EmptyState, ErrorState, formatVenueRange } from "../../components/format";
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
export function Closures({ venueId }: { venueId: string }) {
  const [courts, setCourts] = useState<DashCourt[]>([]);
  const [rows, setRows] = useState<DashClosure[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [draft, setDraft] = useState({ courtId: "", date: today(), start: "09:00", end: "18:00", reason: "" });
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
          void run("create", async () => {
            try {
              await createClosure(venueId, { courtId: draft.courtId || null, date: draft.date, start: draft.start, end: draft.end, reason: draft.reason });
              setRows(await listClosures(venueId));
              setSuccess("Closure added.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The closure could not be saved.");
            }
          });
        }}
      >
        <Field label="Court">
          <select className={control} value={draft.courtId} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, courtId: event.target.value })}>
            <option value="">Whole venue</option>
            {courts.map((court) => <option key={court.id} value={court.id}>{court.courtName}</option>)}
          </select>
        </Field>
        <Field label="Date">
          <PickerInput className={control} type="date" value={draft.date} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, date: event.target.value })} />
        </Field>
        <Field label="Start">
          <PickerInput className={control} type="time" value={draft.start} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
        </Field>
        <Field label="End">
          <PickerInput className={control} type="time" value={draft.end} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
        </Field>
        <Field label="Reason">
          <input className={control} value={draft.reason} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" loading={busy === "create"} disabled={busy !== null && busy !== "create"}>Add closure</Button>
        </div>
        <div className="sm:col-span-2 flex flex-wrap gap-2"><Notice message={message} /><Success message={success} /></div>
      </form>
      {error ? <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /> : rows === null ? <Skeleton className="h-24" /> : rows.length === 0 ? <EmptyState title="No closures" body="Closures block bookings for a court or the whole venue." /> : (
        <ul className="grid gap-2">
          {rows.map((row) => <ClosureRow key={row.id} venueId={venueId} courts={courts} row={row} onChanged={(note) => { setSuccess(note); setAttempt((value) => value + 1); }} />)}
        </ul>
      )}
    </div>
  );
}

function ClosureRow({ venueId, courts, row, onChanged }: { venueId: string; courts: DashCourt[]; row: DashClosure; onChanged: (message: string) => void }) {
  const zone = row.timeZone || "Australia/Melbourne";
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    courtId: row.courtId ?? "",
    date: venueLocalDate(row.startTime, zone),
    start: venueLocalTime(row.startTime, zone),
    end: venueLocalTime(row.endTime, zone),
    reason: row.reason ?? "",
  });
  const [message, setMessage] = useState<string | null>(null);
  const { busy, run } = useBusy();
  return (
    <li className="grid gap-3 rounded-2xl border border-fg/10 p-3 text-sm text-fg">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg">{row.courtName}</span>
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
              <option value="">Whole venue</option>
              {courts.map((court) => <option key={court.id} value={court.id}>{court.courtName}</option>)}
            </select>
          </Field>
          <Field label="Date">
            <PickerInput className={control} type="date" value={form.date} disabled={busy !== null} onChange={(event) => setForm({ ...form, date: event.target.value })} />
          </Field>
          <Field label="Start">
            <PickerInput className={control} type="time" value={form.start} disabled={busy !== null} onChange={(event) => setForm({ ...form, start: event.target.value })} />
          </Field>
          <Field label="End">
            <PickerInput className={control} type="time" value={form.end} disabled={busy !== null} onChange={(event) => setForm({ ...form, end: event.target.value })} />
          </Field>
          <Field label="Reason">
            <input className={control} value={form.reason} disabled={busy !== null} onChange={(event) => setForm({ ...form, reason: event.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button loading={busy === "save"} disabled={busy !== null && busy !== "save"} onClick={() => {
              void run("save", async () => {
                try {
                  await updateClosure(venueId, row.id, { courtId: form.courtId || null, date: form.date, start: form.start, end: form.end, reason: form.reason });
                  setEditing(false);
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


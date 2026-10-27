import { useEffect, useState } from "react";
import { EmptyState, ErrorState } from "../../components/format";
import { Button, PickerInput, Skeleton } from "../../components/ui";
import { Check, control, Field, Notice, Success, useBusy } from "./dashboardUi";
import { today } from "./venueDeskTime";
import {
  DashError,
  createVenueIncentive,
  deleteVenueIncentive,
  listVenueIncentives,
  updateVenueIncentive,
  type DashVenueIncentive,
} from "./dashboardApi";
export function Incentives({ venueId }: { venueId: string }) {
  const [form, setForm] = useState({ startsOn: today(), endsOn: today(), points: "10", isActive: true });
  const [rows, setRows] = useState<DashVenueIncentive[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const { busy, run } = useBusy();

  useEffect(() => {
    let active = true;
    listVenueIncentives(venueId)
      .then((incentives) => {
        if (active) setRows(incentives);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "Incentives could not be loaded.");
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
      <p className="text-sm text-fg/75">Set the dates and points before anyone books. Every court at this venue uses the same points. A booking whose start date falls in an active range earns those points. Bookings already made keep the points they were given.</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault();
        void run("create", async () => {
          try {
            await createVenueIncentive(venueId, { startsOn: form.startsOn, endsOn: form.endsOn, points: Number(form.points), isActive: form.isActive });
            setSuccess("Incentive saved. New bookings in these dates earn the points.");
            setAttempt((value) => value + 1);
          } catch (reason) {
            setError(reason instanceof DashError ? reason.message : "The incentive could not be saved.");
          }
        });
      }}>
        <Field label="From">
          <PickerInput className={control} type="date" required value={form.startsOn} disabled={busy !== null} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} />
        </Field>
        <Field label="To">
          <PickerInput className={control} type="date" required value={form.endsOn} disabled={busy !== null} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} />
        </Field>
        <Field label="Points">
          <input className={control} type="number" min={1} required value={form.points} disabled={busy !== null} onChange={(event) => setForm({ ...form, points: event.target.value })} />
        </Field>
        <div className="flex items-end">
          <Check label="Active" checked={form.isActive} disabled={busy !== null} onChange={(isActive) => setForm({ ...form, isActive })} />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" loading={busy === "create"} disabled={busy !== null && busy !== "create"}>Add incentive</Button>
        </div>
      </form>
      <Success message={success} />
      {error ? <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /> : rows === null ? <Skeleton className="h-24" /> : rows.length === 0 ? <EmptyState title="No incentives" body="Add a date range so bookings in those dates earn points." /> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => <IncentiveRow key={row.id} venueId={venueId} row={row} onChanged={(note) => { setSuccess(note); setError(null); setAttempt((value) => value + 1); }} />)}
        </ul>
      )}
    </div>
  );
}

function IncentiveRow({ venueId, row, onChanged }: { venueId: string; row: DashVenueIncentive; onChanged: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ startsOn: row.startsOn, endsOn: row.endsOn, points: String(row.points), isActive: row.isActive });
  const [message, setMessage] = useState<string | null>(null);
  const { busy, run } = useBusy();
  return (
    <li className="grid gap-3 rounded-2xl border border-fg/10 p-3 text-sm text-fg">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-fg">+{row.points} pts</span>
        <span>{row.startsOn} to {row.endsOn}</span>
        <span>{row.isActive ? "Active" : "Off"}</span>
        <Button variant="secondary" disabled={busy !== null} onClick={() => { setMessage(null); setEditing((open) => !open); }}>Edit</Button>
        <Button variant="danger" loading={busy === "delete"} disabled={busy !== null && busy !== "delete"} onClick={() => {
          void run("delete", async () => {
            try {
              await deleteVenueIncentive(venueId, row.id);
              onChanged("Incentive removed. Bookings already made keep their points.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The incentive could not be deleted.");
            }
          });
        }}>Delete</Button>
      </div>
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="From">
            <PickerInput className={control} type="date" value={form.startsOn} disabled={busy !== null} onChange={(event) => setForm({ ...form, startsOn: event.target.value })} />
          </Field>
          <Field label="To">
            <PickerInput className={control} type="date" value={form.endsOn} disabled={busy !== null} onChange={(event) => setForm({ ...form, endsOn: event.target.value })} />
          </Field>
          <Field label="Points">
            <input className={control} type="number" min={1} value={form.points} disabled={busy !== null} onChange={(event) => setForm({ ...form, points: event.target.value })} />
          </Field>
          <div className="flex items-end">
            <Check label="Active" checked={form.isActive} disabled={busy !== null} onChange={(isActive) => setForm({ ...form, isActive })} />
          </div>
          <div>
            <Button loading={busy === "save"} disabled={busy !== null && busy !== "save"} onClick={() => {
              void run("save", async () => {
                try {
                  await updateVenueIncentive(venueId, row.id, { startsOn: form.startsOn, endsOn: form.endsOn, points: Number(form.points), isActive: form.isActive });
                  setEditing(false);
                  onChanged("Incentive saved.");
                } catch (reason) {
                  setMessage(reason instanceof DashError ? reason.message : "The incentive could not be saved.");
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


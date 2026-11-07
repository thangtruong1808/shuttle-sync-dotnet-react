import { useEffect, useState } from "react";
import { EmptyState, ErrorState, Money } from "../../components/format";
import { Button, PickerInput, Skeleton } from "../../components/ui";
import { control, Field, Notice, Success, useBusy } from "./dashboardUi";
import { weekDays } from "./venueDeskTime";
import {
  DashError,
  deleteRateWindow,
  listRateWindows,
  saveRateWindow,
  type DashRateWindow,
} from "./dashboardApi";
export function Rates({ venueId, currency, hourlyRate }: { venueId: string; currency: string; hourlyRate: number }) {
  const blankDays = [false, false, false, false, false, false, false];
  const [rows, setRows] = useState<DashRateWindow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [days, setDays] = useState(blankDays);
  const [start, setStart] = useState("18:00");
  const [end, setEnd] = useState("21:00");
  const [rate, setRate] = useState("");
  const { busy, run } = useBusy();

  useEffect(() => {
    let active = true;
    listRateWindows(venueId)
      .then((next) => {
        if (!active) return;
        setRows(next);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "Rates could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, venueId]);

  function resetForm() {
    setEditing(null);
    setDays(blankDays);
    setStart("18:00");
    setEnd("21:00");
    setRate("");
  }

  return (
    <div className="grid gap-4">
      <p className="max-w-3xl text-sm leading-relaxed text-fg/75">
        The standard rate is <Money amount={hourlyRate} currency={currency} /> per hour. Add a window for the days and hours that should cost something else. New bookings use these rates, and unpaid court holds are updated. Paid weeks stay at the price already paid. A window stays on the same day, so a late night that passes midnight needs two windows.
      </p>
      <form
        className="grid gap-3 rounded-2xl border border-fg/10 p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          setSuccess(null);
          void run("save", async () => {
            try {
              await saveRateWindow(venueId, { days, start, end, hourlyRate: Number(rate) }, editing ?? undefined);
              setRows(await listRateWindows(venueId));
              setSuccess(editing ? "Rate updated. Unpaid holds now use it." : "Rate added. Unpaid holds now use it.");
              resetForm();
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The rate could not be saved.");
            }
          });
        }}
      >
        <fieldset className="min-w-0">
          <legend className="text-sm text-fg/80">Days</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {weekDays.map((name, index) => (
              <label key={name} className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border px-3.5 py-2 text-sm transition-colors ${days[index] ? "border-accent-text/50 bg-accent/15 text-fg" : "border-fg/10 text-fg hover:bg-fg/10"} ${busy !== null ? "cursor-not-allowed opacity-60" : ""}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={days[index]}
                  disabled={busy !== null}
                  onChange={() => setDays((current) => current.map((selected, day) => day === index ? !selected : selected))}
                />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Start">
            <PickerInput className={control} type="time" required value={start} disabled={busy !== null} onChange={(event) => setStart(event.target.value)} />
          </Field>
          <Field label="End">
            <PickerInput className={control} type="time" required value={end} disabled={busy !== null} onChange={(event) => setEnd(event.target.value)} />
          </Field>
          <Field label="Hourly rate">
            <input className={control} type="number" min={0} step="0.01" required value={rate} disabled={busy !== null} onChange={(event) => setRate(event.target.value)} />
          </Field>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button type="submit" className="w-full sm:w-auto" loading={busy === "save"} disabled={(busy !== null && busy !== "save") || !days.some(Boolean) || !(Number(rate) >= 0)}>
            {editing ? "Update rate" : "Add rate"}
          </Button>
          {editing ? <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={busy !== null} onClick={resetForm}>Cancel edit</Button> : null}
        </div>
        <Notice message={message} />
        <Success message={success} />
      </form>
      {error ? <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} /> : rows === null ? (
        <div aria-busy="true"><span className="sr-only">Loading rates</span><Skeleton className="h-24" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="No special rates" body="Every court booking uses the standard hourly rate until you add a day and time." />
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-3 rounded-2xl border border-fg/10 px-3 py-3 transition-colors hover:bg-fg/5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium text-fg">{row.days.map((selected, index) => selected ? weekDays[index] : null).filter(Boolean).join(", ")}</p>
                <p className="text-sm text-fg/75">{row.start}–{row.end} · <Money amount={row.hourlyRate} currency={currency} /> / hour</p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="secondary" className="w-full sm:w-auto" disabled={busy !== null} onClick={() => { setEditing(row.id); setDays(row.days.length === 7 ? row.days : blankDays); setStart(row.start); setEnd(row.end); setRate(String(row.hourlyRate)); setMessage(null); setSuccess(null); }}>Edit</Button>
                <Button
                  type="button"
                  variant="danger"
                  className="w-full sm:w-auto"
                  loading={busy === row.id}
                  disabled={busy !== null && busy !== row.id}
                  onClick={() => {
                    setMessage(null);
                    setSuccess(null);
                    void run(row.id, async () => {
                      try {
                        await deleteRateWindow(venueId, row.id);
                        if (editing === row.id) resetForm();
                        setRows(await listRateWindows(venueId));
                        setSuccess("Rate removed. Unpaid holds use the remaining rates.");
                      } catch (reason) {
                        setMessage(reason instanceof DashError ? reason.message : "The rate could not be removed.");
                      }
                    });
                  }}
                >
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


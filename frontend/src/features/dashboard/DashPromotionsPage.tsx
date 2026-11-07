import { useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../../app/store";
import { Button, PickerInput } from "../../components/ui";
import type { Venue } from "../venues/venueApi";
import { DashError, deletePromotion, listPromotions, savePromotion, type DashPromo } from "./dashboardApi";
import { Check, control, Field, Notice, Success, useBusy } from "./dashboardUi";
import { Shell, useVenueOptions } from "./OpsShell";

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
  const [filtering, setFiltering] = useState(false);
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
      load={(page, pageSize) => listPromotions(applied, page, pageSize)}
      locked={filtering}
      onSettled={() => setFiltering(false)}
      extra={
        <div className="mt-4 grid gap-4">
          <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); setFiltering(true); setApplied(venueId); setRevision((value) => value + 1); setNote("Filters applied."); }}>
            <select className={`${control} sm:max-w-xs`} value={venueId} disabled={filtering} onChange={(event) => setVenueId(event.target.value)}>
              <option value="">All codes</option>
              {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
            </select>
            <Button type="submit" variant="secondary" className="w-full sm:w-auto" loading={filtering}>Filter</Button>
            <Success message={note} />
          </form>
          <form
            className="grid gap-3 rounded-2xl border border-border bg-surface p-4 shadow-card dark:shadow-none sm:grid-cols-2"
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
              <span className="mt-1 block text-xs text-fg/60">Starts at 00:01 on this day.</span>
            </Field>
            <Field label="Valid to">
              <PickerInput className={control} type="date" value={form.validTo} disabled={busy !== null} onChange={(event) => setForm({ ...form, validTo: event.target.value })} required />
              <span className="mt-1 block text-xs text-fg/60">Ends at 23:59 on this day.</span>
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
    <li className="rounded-2xl border border-border bg-surface p-3 text-sm text-fg shadow-card transition-colors hover:bg-surface-2 dark:shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-words font-medium text-fg">{row.code}</span>
        <span className="break-words">{row.discountType} {row.discountValue} · {row.usedCount} used · {row.isActive ? "active" : "inactive"} · {venueName}</span>
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
          className="mt-3 grid gap-3 border-t border-fg/10 pt-3 sm:grid-cols-2"
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
            <span className="mt-1 block text-xs text-fg/60">Starts at 00:01 on this day.</span>
          </Field>
          <Field label="Valid to">
            <PickerInput className={control} type="date" value={form.validTo} disabled={busy !== null} onChange={(event) => setForm({ ...form, validTo: event.target.value })} required />
            <span className="mt-1 block text-xs text-fg/60">Ends at 23:59 on this day.</span>
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

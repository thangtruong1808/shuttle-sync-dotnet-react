import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Spinner } from "../../components/ui";
import { currencyError, slugError, timeZoneError } from "../venues/slug";
import { Check, control, Field, Notice, Success, useBusy } from "./dashboardUi";
import { SlugField } from "./SlugField";
import {
  DashError,
  deleteVenue,
  saveVenue,
  uploadDashboardImage,
  type DashVenue,
} from "./dashboardApi";
export function Details({ venue, admin, onSaved }: { venue: DashVenue; admin: boolean; onSaved: () => void }) {
  const navigate = useNavigate();
  const [form, setForm] = useState(venue);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { busy, run } = useBusy();

  useEffect(() => setForm(venue), [venue]);

  function set<K extends keyof DashVenue>(key: K, value: DashVenue[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => {
        event.preventDefault();
        setMessage(null);
        setSuccess(null);
        const invalidSlug = slugError(form.slug);
        const invalidTimeZone = timeZoneError(form.timeZone);
        const invalidCurrency = currencyError(form.currency);
        if (invalidTimeZone) {
          setMessage(invalidTimeZone);
          return;
        }
        if (invalidCurrency) {
          setMessage(invalidCurrency);
          return;
        }
        if (invalidSlug) {
          setMessage(invalidSlug);
          return;
        }
        void run("save", async () => {
          try {
            const { id, ...body } = form;
            await saveVenue({
              ...body,
              latitude: typeof body.latitude === "number" && Number.isFinite(body.latitude) ? body.latitude : null,
              longitude: typeof body.longitude === "number" && Number.isFinite(body.longitude) ? body.longitude : null,
            }, id);
            setSuccess("Venue saved.");
            onSaved();
          } catch (reason) {
            setMessage(reason instanceof DashError ? reason.message : "The venue could not be saved.");
          }
        });
      }}
    >
      <Field label="Name">
        <input className={control} value={form.name} disabled={!admin || busy !== null} onChange={(event) => set("name", event.target.value)} />
      </Field>
      <SlugField value={form.slug} touched disabled={!admin || busy !== null} onChange={(slug) => set("slug", slug)} />
      <Field label="Description">
        <textarea className={control} value={form.description ?? ""} disabled={busy !== null} onChange={(event) => set("description", event.target.value)} />
      </Field>
      <Field label="Address">
        <input className={control} value={form.address ?? ""} disabled={busy !== null} onChange={(event) => set("address", event.target.value)} />
      </Field>
      <Field label="Suburb">
        <input className={control} value={form.suburb ?? ""} disabled={busy !== null} onChange={(event) => set("suburb", event.target.value)} />
      </Field>
      <Field label="State">
        <input className={control} value={form.state ?? ""} disabled={busy !== null} onChange={(event) => set("state", event.target.value)} />
      </Field>
      <Field label="Postcode">
        <input className={control} value={form.postcode ?? ""} disabled={busy !== null} onChange={(event) => set("postcode", event.target.value)} />
      </Field>
      <Field label="Country">
        <input className={control} value={form.country} disabled={!admin || busy !== null} onChange={(event) => set("country", event.target.value)} />
        <span className="mt-1 block text-xs text-fg/60">Use a 2-letter code, such as AU.</span>
      </Field>
      <Field label="Phone">
        <input className={control} value={form.phone ?? ""} disabled={busy !== null} onChange={(event) => set("phone", event.target.value)} />
      </Field>
      <Field label="Email">
        <input className={control} value={form.email ?? ""} disabled={busy !== null} onChange={(event) => set("email", event.target.value)} />
      </Field>
      <Field label="Timezone">
        <input className={control} value={form.timeZone} disabled={!admin || busy !== null} onChange={(event) => set("timeZone", event.target.value)} />
      </Field>
      <Field label="Currency">
        <input className={control} value={form.currency} disabled={!admin || busy !== null} onChange={(event) => set("currency", event.target.value)} />
      </Field>
      <Field label="Late cancel fee %">
        <input
          className={control}
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={form.lateCancelFeePercent ?? 0}
          disabled={!admin || busy !== null}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) set("lateCancelFeePercent", next);
          }}
        />
      </Field>
      <Field label="Standard hourly rate">
        <input
          className={control}
          type="number"
          min={0}
          step="0.01"
          value={form.hourlyRate ?? 0}
          disabled={!admin || busy !== null}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) set("hourlyRate", next);
          }}
        />
        <span className="mt-1 block text-xs text-fg/60">Used when a day and time has no special rate. Peak hours are set under Rates.</span>
      </Field>
      <Field label="Points per $1">
        <input
          className={control}
          type="number"
          min={1}
          step={1}
          value={form.pointsPerDollar ?? 100}
          disabled={!admin || busy !== null}
          onChange={(event) => {
            const next = Math.floor(Number(event.target.value));
            if (Number.isFinite(next)) set("pointsPerDollar", next);
          }}
        />
      </Field>
      <Field label="Latitude">
        <input className={control} value={form.latitude ?? ""} disabled={!admin || busy !== null} onChange={(event) => set("latitude", event.target.value ? Number(event.target.value) : null)} />
      </Field>
      <Field label="Longitude">
        <input className={control} value={form.longitude ?? ""} disabled={!admin || busy !== null} onChange={(event) => set("longitude", event.target.value ? Number(event.target.value) : null)} />
      </Field>
      <Field label="Photo URL">
        <input className={control} value={form.imageUrl ?? ""} disabled={busy !== null} onChange={(event) => set("imageUrl", event.target.value || null)} />
      </Field>
      <label className="block text-sm text-fg/80">
        <span className="inline-flex items-center gap-2">
          Upload photo
          {busy === "upload" ? <Spinner className="h-4 w-4" /> : null}
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          disabled={busy !== null}
          className="mt-1 block w-full text-sm text-fg file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-fg/10 file:px-3 file:py-2 disabled:opacity-60"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setMessage(null);
            setSuccess(null);
            void run("upload", async () => {
              try {
                set("imageUrl", await uploadDashboardImage(file, "venues"));
                setSuccess("Photo uploaded. Save the venue to keep this photo.");
              } catch (reason) {
                setMessage(reason instanceof DashError ? reason.message : "The photo could not be uploaded.");
              }
            });
          }}
        />
      </label>
      <Check label="Active" checked={form.isActive} disabled={!admin || busy !== null} onChange={(checked) => set("isActive", checked)} />
      <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
        <Notice message={message} />
        <Success message={success} />
        <Button type="submit" loading={busy === "save"} disabled={busy !== null && busy !== "save"}>
          Save
        </Button>
        {admin ? (
          confirming ? (
            <Button
              variant="danger"
              loading={busy === "delete"}
              disabled={busy !== null && busy !== "delete"}
              onClick={() => {
                void run("delete", async () => {
                  try {
                    await deleteVenue(venue.id);
                    navigate("/dashboard/venues", { state: { success: "Venue deleted." } });
                  } catch (reason) {
                    setMessage(reason instanceof DashError ? reason.message : "The venue could not be deleted.");
                  }
                });
              }}
            >
              Confirm delete
            </Button>
          ) : (
            <Button variant="danger" disabled={busy !== null} onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )
        ) : null}
      </div>
    </form>
  );
}


import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link, useLocation } from "react-router-dom";
import type { RootState } from "../../app/store";
import { EmptyState, ErrorState } from "../../components/format";
import { Button, Skeleton } from "../../components/ui";
import { dashboardVenues, type Venue } from "../venues/venueApi";
import { DashError, saveVenue, uploadDashboardImage } from "./dashboardApi";
import { Check, control, Field, Notice, Success, useBusy } from "./dashboardUi";

const blank = {
  name: "",
  slug: "",
  description: "",
  address: "",
  suburb: "",
  state: "",
  postcode: "",
  country: "AU",
  latitude: "",
  longitude: "",
  phone: "",
  email: "",
  imageUrl: "",
  timeZone: "Australia/Melbourne",
  currency: "AUD",
  lateCancelFeePercent: 0,
  pointsPerDollar: 100,
  hourlyRate: 0,
  isActive: true,
};

export default function VenuesPage() {
  const role = useSelector((state: RootState) => state.auth.user?.role);
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const location = useLocation();
  const arrived = location.state as { success?: string } | null;
  const [success, setSuccess] = useState<string | null>(arrived?.success ?? null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(blank);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { busy, run } = useBusy();

  useEffect(() => {
    let active = true;
    dashboardVenues()
      .then((list) => {
        if (active) {
          setVenues(list);
          setError(null);
        }
      })
      .catch(() => {
        if (active) setError("Venues could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl text-white">Venues</h1>
        {role === "admin" ? (
          <Button variant="secondary" onClick={() => setCreating((value) => !value)}>
            {creating ? "Close form" : "New venue"}
          </Button>
        ) : null}
      </div>
      {creating && role === "admin" ? (
        <form
          className="mt-4 grid gap-3 rounded-2xl border border-white/10 p-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setFormError(null);
            setSuccess(null);
            void run("save", async () => {
              try {
                await saveVenue({
                  ...form,
                  description: form.description || null,
                  address: form.address || null,
                  suburb: form.suburb || null,
                  state: form.state || null,
                  postcode: form.postcode || null,
                  latitude: form.latitude ? Number(form.latitude) : null,
                  longitude: form.longitude ? Number(form.longitude) : null,
                  phone: form.phone || null,
                  email: form.email || null,
                  imageUrl: form.imageUrl || null,
                });
                setForm(blank);
                setCreating(false);
                setVenues(await dashboardVenues());
                setSuccess("Venue created.");
              } catch (reason) {
                setFormError(reason instanceof DashError ? reason.message : "The venue could not be saved.");
              }
            });
          }}
        >
          <Field label="Name">
            <input className={control} value={form.name} disabled={busy !== null} onChange={(event) => set("name", event.target.value)} required />
          </Field>
          <Field label="Slug">
            <input className={control} value={form.slug} disabled={busy !== null} onChange={(event) => set("slug", event.target.value)} required />
          </Field>
          <Field label="Timezone">
            <input className={control} value={form.timeZone} disabled={busy !== null} onChange={(event) => set("timeZone", event.target.value)} />
          </Field>
          <Field label="Currency">
            <input className={control} value={form.currency} disabled={busy !== null} onChange={(event) => set("currency", event.target.value)} />
          </Field>
          <Field label="Photo URL">
            <input className={control} value={form.imageUrl} disabled={busy !== null} onChange={(event) => set("imageUrl", event.target.value)} />
          </Field>
          <label className="block text-sm text-mist/80">
            Upload photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy !== null}
              className="mt-1 block w-full text-sm text-mist file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-mist"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setFormError(null);
                setSuccess(null);
                void run("upload", async () => {
                  try {
                    set("imageUrl", await uploadDashboardImage(file, "venues"));
                    setSuccess("Photo uploaded.");
                  } catch (reason) {
                    setFormError(reason instanceof DashError ? reason.message : "The photo could not be uploaded.");
                  }
                });
              }}
            />
          </label>
          <div className="sm:col-span-2">
            <Check label="Active" checked={form.isActive} disabled={busy !== null} onChange={(checked) => set("isActive", checked)} />
          </div>
          <Notice message={formError} />
          <Success message={success} />
          <div className="sm:col-span-2">
            <Button type="submit" loading={busy === "save"} disabled={busy !== null && busy !== "save"}>
              {busy === "upload" ? "Uploading" : "Create venue"}
            </Button>
          </div>
        </form>
      ) : null}
      {success && !creating ? <div className="mt-4"><Success message={success} /></div> : null}
      {error ? (
        <div className="mt-6">
          <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} />
        </div>
      ) : venues === null ? (
        <div className="mt-6" aria-busy="true">
          <span className="sr-only">Loading venues</span>
          <Skeleton className="h-40" />
        </div>
      ) : venues.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No venues yet" body="Create a venue to add courts and slots." />
        </div>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {venues.map((venue) => (
            <li key={venue.id}>
              <Link to={`/dashboard/venues/${venue.id}`} className="block rounded-2xl border border-white/10 p-4 hover:bg-white/5">
                <p className="font-medium text-white">{venue.name}</p>
                <p className="text-sm text-mist/65">{venue.slug}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

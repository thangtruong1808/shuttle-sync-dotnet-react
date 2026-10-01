import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import type { RootState } from "../../app/store";
import { EmptyState, ErrorState, formatVenueRange, Money } from "../../components/format";
import { Button, PickerInput, Skeleton, Spinner } from "../../components/ui";
import {
  createClosure,
  createSessions,
  DashError,
  createVenueIncentive,
  deleteClosure,
  deleteCourt,
  deleteSession,
  deleteVenue,
  deleteVenueIncentive,
  listClosures,
  listCourts,
  listSessions,
  listVenueIncentives,
  saveCourt,
  saveVenue,
  updateClosure,
  updateSession,
  updateVenueIncentive,
  uploadDashboardImage,
  venueDetail,
  type DashClosure,
  type DashCourt,
  type DashSession,
  type DashVenue,
  type DashVenueIncentive,
} from "./dashboardApi";
import { Check, control, Field, Notice, Success, useBusy } from "./dashboardUi";

const sections = ["details", "courts", "slots", "closures", "incentives"] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function venueLocalDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "Australia/Melbourne",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function venueLocalTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timeZone || "Australia/Melbourne",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

export default function VenueDesk() {
  const { venueId = "", section = "details" } = useParams();
  const role = useSelector((state: RootState) => state.auth.user?.role);
  const admin = role === "admin";
  const [venue, setVenue] = useState<DashVenue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setVenue(null);
    venueDetail(venueId)
      .then((row) => {
        if (active) setVenue(row);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "That venue could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, venueId]);

  const current = sections.includes(section as (typeof sections)[number]) ? section : "details";

  return (
    <div>
      {error ? (
        <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} />
      ) : venue === null ? (
        <div aria-busy="true">
          <span className="sr-only">Loading venue</span>
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <h1 className="font-display text-3xl text-white">{venue.name}</h1>
          <nav className="mt-4 flex gap-2 overflow-auto" aria-label="Venue sections">
            {sections
              .filter((item) => item !== "incentives" || admin)
              .map((item) => (
                <NavLink
                  key={item}
                  to={item === "details" ? `/dashboard/venues/${venueId}` : `/dashboard/venues/${venueId}/${item}`}
                  end={item === "details"}
                  className={({ isActive }) => `rounded-xl px-3 py-2 text-sm capitalize ${isActive ? "bg-line/15 text-line" : "text-mist/80 hover:bg-white/5"}`}
                >
                  {item}
                </NavLink>
              ))}
          </nav>
          <div className="mt-6">
            {current === "details" ? <Details venue={venue} admin={admin} onSaved={() => setAttempt((value) => value + 1)} /> : null}
            {current === "courts" ? <Courts venueId={venueId} /> : null}
            {current === "slots" ? <Slots venueId={venueId} /> : null}
            {current === "closures" ? <Closures venueId={venueId} /> : null}
            {current === "incentives" && admin ? <Incentives venueId={venueId} /> : null}
            {current === "incentives" && !admin ? <EmptyState title="Admins only" body="Reward incentives are managed by an admin." /> : null}
          </div>
        </>
      )}
    </div>
  );
}

function Details({ venue, admin, onSaved }: { venue: DashVenue; admin: boolean; onSaved: () => void }) {
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
        void run("save", async () => {
          try {
            const { id, ...body } = form;
            await saveVenue(body, id);
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
      <Field label="Slug">
        <input className={control} value={form.slug} disabled={!admin || busy !== null} onChange={(event) => set("slug", event.target.value)} />
      </Field>
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
      <Field label="Latitude">
        <input className={control} value={form.latitude ?? ""} disabled={!admin || busy !== null} onChange={(event) => set("latitude", event.target.value ? Number(event.target.value) : null)} />
      </Field>
      <Field label="Longitude">
        <input className={control} value={form.longitude ?? ""} disabled={!admin || busy !== null} onChange={(event) => set("longitude", event.target.value ? Number(event.target.value) : null)} />
      </Field>
      <Field label="Photo URL">
        <input className={control} value={form.imageUrl ?? ""} disabled={busy !== null} onChange={(event) => set("imageUrl", event.target.value || null)} />
      </Field>
      <label className="block text-sm text-mist/80">
        <span className="inline-flex items-center gap-2">
          Upload photo
          {busy === "upload" ? <Spinner className="h-4 w-4" /> : null}
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          disabled={busy !== null}
          className="mt-1 block w-full text-sm text-mist file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 disabled:opacity-60"
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

function Courts({ venueId }: { venueId: string }) {
  const [courts, setCourts] = useState<DashCourt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const { busy, run } = useBusy();
  const [draft, setDraft] = useState({ courtName: "", courtNumber: "1", description: "", surfaceType: "", imageUrl: "", isActive: true });
  const loadId = useRef(0);

  useEffect(() => {
    const id = ++loadId.current;
    listCourts(venueId)
      .then((rows) => {
        if (loadId.current !== id) return;
        setCourts(rows);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (loadId.current !== id) return;
        setError(reason instanceof DashError ? reason.message : "Courts could not be loaded.");
      })
      .finally(() => {
        if (loadId.current === id) setRetrying(false);
      });
  }, [attempt, venueId]);

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-3 rounded-2xl border border-white/10 p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          setSuccess(null);
          void run("create", async () => {
            try {
              await saveCourt(venueId, {
                courtName: draft.courtName,
                courtNumber: Number(draft.courtNumber),
                description: draft.description || null,
                surfaceType: draft.surfaceType || null,
                imageUrl: draft.imageUrl || null,
                isActive: draft.isActive,
              });
              const rows = await listCourts(venueId);
              loadId.current += 1;
              setCourts(rows);
              setError(null);
              setDraft({ courtName: "", courtNumber: String(Number(draft.courtNumber) + 1), description: "", surfaceType: "", imageUrl: "", isActive: true });
              setSuccess("Court added.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The court could not be saved.");
            }
          });
        }}
      >
        <Field label="Court name">
          <input className={control} value={draft.courtName} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, courtName: event.target.value })} required />
        </Field>
        <Field label="Number">
          <input className={control} type="number" min={1} value={draft.courtNumber} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, courtNumber: event.target.value })} />
        </Field>
        <Field label="Surface">
          <input className={control} value={draft.surfaceType} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, surfaceType: event.target.value })} />
        </Field>
        <Field label="Photo URL">
          <input className={control} value={draft.imageUrl} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} />
        </Field>
        <label className="text-sm text-mist/80">
          <span className="inline-flex items-center gap-2">Upload photo {busy === "upload" ? <Spinner /> : null}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            disabled={busy !== null}
            className="mt-1 block w-full text-sm text-mist disabled:opacity-60"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setMessage(null);
              setSuccess(null);
              void run("upload", async () => {
                try {
                  const url = await uploadDashboardImage(file, "courts");
                  setDraft((current) => ({ ...current, imageUrl: url }));
                  setSuccess("Photo uploaded.");
                } catch (reason) {
                  setMessage(reason instanceof DashError ? reason.message : "The photo could not be uploaded.");
                }
              });
            }}
          />
        </label>
        <Check label="Active" checked={draft.isActive} disabled={busy !== null} onChange={(checked) => setDraft({ ...draft, isActive: checked })} />
        <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
          <Notice message={message} />
          <Success message={success} />
          <Button type="submit" loading={busy === "create"} disabled={busy !== null && busy !== "create"}>
            Add court
          </Button>
        </div>
      </form>
      {error ? (
        <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} />
      ) : courts === null ? (
        <Skeleton className="h-24" />
      ) : courts.length === 0 ? (
        <EmptyState title="No courts" body="Add a court before creating slots." />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {courts.map((court) => (
            <CourtRow key={court.id} venueId={venueId} court={court} onChanged={(note) => { setSuccess(note); setAttempt((value) => value + 1); }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CourtRow({ venueId, court, onChanged }: { venueId: string; court: DashCourt; onChanged: (message: string) => void }) {
  const [name, setName] = useState(court.courtName);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setName(court.courtName), [court.courtName]);
  const { busy, run } = useBusy();
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 p-3">
      <input className={`${control} max-w-xs`} value={name} disabled={busy !== null} onChange={(event) => setName(event.target.value)} />
      <span className="text-sm text-mist/65">#{court.courtNumber}</span>
      <Button
        variant="secondary"
        loading={busy === "save"}
        disabled={busy !== null && busy !== "save"}
        onClick={() => {
          void run("save", async () => {
            try {
              await saveCourt(venueId, { ...court, courtName: name }, court.id);
              onChanged("Court saved.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The court could not be saved.");
            }
          });
        }}
      >
        Save
      </Button>
      <Button
        variant="danger"
        loading={busy === "delete"}
        disabled={busy !== null && busy !== "delete"}
        onClick={() => {
          void run("delete", async () => {
            try {
              await deleteCourt(venueId, court.id);
              onChanged("Court removed.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The court could not be deleted.");
            }
          });
        }}
      >
        Delete
      </Button>
      <Notice message={message} />
    </li>
  );
}

function Slots({ venueId }: { venueId: string }) {
  const [date, setDate] = useState(today);
  const [courts, setCourts] = useState<DashCourt[]>([]);
  const [rows, setRows] = useState<DashSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [draft, setDraft] = useState({ courtId: "", start: "09:00", end: "10:00", price: "20" });
  const { busy, run } = useBusy();

  useEffect(() => {
    let active = true;
    Promise.all([listCourts(venueId), listSessions(venueId, date)])
      .then(([courtRows, sessions]) => {
        if (!active) return;
        setCourts(courtRows);
        setRows(sessions);
        setDraft((current) => ({ ...current, courtId: current.courtId || courtRows[0]?.id || "" }));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof DashError ? reason.message : "Slots could not be loaded.");
      })
      .finally(() => {
        if (active) setRetrying(false);
      });
    return () => {
      active = false;
    };
  }, [attempt, date, venueId]);

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-3 rounded-2xl border border-white/10 p-4 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          setMessage(null);
          setSuccess(null);
          void run("create", async () => {
            try {
              await createSessions(venueId, {
                courtId: draft.courtId,
                date,
                start: draft.start,
                end: draft.end,
                price: Number(draft.price),
              });
              setRows(await listSessions(venueId, date));
              setSuccess("Booking added.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The slot could not be created.");
            }
          });
        }}
      >
        <Field label="Date">
          <PickerInput className={control} type="date" value={date} disabled={busy !== null} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Court">
          <select className={control} value={draft.courtId} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, courtId: event.target.value })}>
            {courts.map((court) => (
              <option key={court.id} value={court.id}>{court.courtName}</option>
            ))}
          </select>
        </Field>
        <Field label="Start">
          <PickerInput className={control} type="time" value={draft.start} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
        </Field>
        <Field label="End">
          <PickerInput className={control} type="time" value={draft.end} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
        </Field>
        <Field label="Price">
          <input className={control} type="number" min={0} step="0.01" value={draft.price} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
        </Field>
        <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-2">
          <Notice message={message} />
          <Success message={success} />
          <Button type="submit" loading={busy === "create"} disabled={busy !== null && busy !== "create" || !draft.courtId}>
            Add booking
          </Button>
        </div>
      </form>
      {error ? (
        <ErrorState message={error} loading={retrying} onRetry={() => { setRetrying(true); setAttempt((value) => value + 1); }} />
      ) : rows === null ? (
        <div aria-busy="true"><span className="sr-only">Loading slots</span><Skeleton className="h-24" /></div>
      ) : rows.length === 0 ? (
        <EmptyState title="No bookings" body="Add a court, date, start, and end to book that time." />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <SlotRow key={row.id} venueId={venueId} courts={courts} row={row} onChanged={(note) => { setSuccess(note); setAttempt((value) => value + 1); }} />
          ))}
        </ul>
      )}
    </div>
  );
}

function SlotRow({ venueId, courts, row, onChanged }: { venueId: string; courts: DashCourt[]; row: DashSession; onChanged: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    courtId: row.courtId,
    date: venueLocalDate(row.startTime, row.timeZone),
    start: venueLocalTime(row.startTime, row.timeZone),
    end: venueLocalTime(row.endTime, row.timeZone),
    price: String(row.price),
  });
  const [message, setMessage] = useState<string | null>(null);
  const { busy, run } = useBusy();
  return (
    <li className="grid gap-3 rounded-2xl border border-white/10 p-3 text-sm text-mist">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-white">{row.courtName}</span>
        <span>{formatVenueRange(row.startTime, row.endTime, row.timeZone)}</span>
        <Money amount={row.price} currency="AUD" />
        <Button variant="secondary" disabled={busy !== null} onClick={() => { setMessage(null); setEditing((open) => !open); }}>Edit</Button>
        <Button variant="danger" loading={busy === "delete"} disabled={busy !== null && busy !== "delete"} onClick={() => {
          void run("delete", async () => {
            try {
              await deleteSession(venueId, row.id);
              onChanged("Slot removed.");
            } catch (reason) {
              setMessage(reason instanceof DashError ? reason.message : "The slot could not be deleted.");
            }
          });
        }}>Delete</Button>
      </div>
      {editing ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Court">
            <select className={control} value={form.courtId} disabled={busy !== null} onChange={(event) => setForm({ ...form, courtId: event.target.value })}>
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
          <Field label="Price">
            <input className={control} type="number" min={0} step="0.01" value={form.price} disabled={busy !== null} onChange={(event) => setForm({ ...form, price: event.target.value })} />
          </Field>
          <div className="flex items-end">
            <Button loading={busy === "save"} disabled={busy !== null && busy !== "save" || !form.courtId} onClick={() => {
              void run("save", async () => {
                try {
                  await updateSession(venueId, row.id, { courtId: form.courtId, date: form.date, start: form.start, end: form.end, price: Number(form.price) });
                  setEditing(false);
                  onChanged("Slot saved.");
                } catch (reason) {
                  setMessage(reason instanceof DashError ? reason.message : "The slot could not be saved.");
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

function Closures({ venueId }: { venueId: string }) {
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
        className="grid gap-3 rounded-2xl border border-white/10 p-4 sm:grid-cols-2"
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
    <li className="grid gap-3 rounded-2xl border border-white/10 p-3 text-sm text-mist">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-white">{row.courtName}</span>
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

function Incentives({ venueId }: { venueId: string }) {
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
      <p className="text-sm text-mist/75">Set the dates and points before anyone books. Every court at this venue uses the same points. A booking whose start date falls in an active range earns those points. Bookings already made keep the points they were given.</p>
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
    <li className="grid gap-3 rounded-2xl border border-white/10 p-3 text-sm text-mist">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-white">+{row.points} pts</span>
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

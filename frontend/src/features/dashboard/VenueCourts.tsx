import { useEffect, useRef, useState } from "react";
import { CourtImage, EmptyState, ErrorState } from "../../components/format";
import { Button, Skeleton, Spinner } from "../../components/ui";
import { Check, control, Field, Notice, Success, useBusy } from "./dashboardUi";
import {
  DashError,
  deleteCourt,
  generateCourtAiImage,
  listCourts,
  saveCourt,
  uploadDashboardImage,
  type DashCourt,
} from "./dashboardApi";

export function Courts({ venueId }: { venueId: string }) {
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
        className="grid gap-3 rounded-2xl border border-fg/10 p-4 sm:grid-cols-2"
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
        <Field label="Description">
          <input className={control} value={draft.description} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        </Field>
        <Field label="Photo URL">
          <input className={control} value={draft.imageUrl} disabled={busy !== null} onChange={(event) => setDraft({ ...draft, imageUrl: event.target.value })} />
        </Field>
        <label className="text-sm text-fg/80">
          <span className="inline-flex items-center gap-2">Upload photo {busy === "upload" ? <Spinner /> : null}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            disabled={busy !== null}
            className="mt-1 block w-full text-sm text-fg disabled:opacity-60"
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
                  setSuccess("Photo uploaded. Add the court to keep it.");
                } catch (reason) {
                  setMessage(reason instanceof DashError ? reason.message : "The photo could not be uploaded.");
                }
              });
            }}
          />
        </label>
        {draft.imageUrl ? (
          <div className="sm:col-span-2">
            <CourtImage src={draft.imageUrl} alt="New court" />
          </div>
        ) : null}
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

function courtForm(court: DashCourt) {
  return {
    courtName: court.courtName,
    courtNumber: String(court.courtNumber),
    surfaceType: court.surfaceType ?? "",
    description: court.description ?? "",
    imageUrl: court.imageUrl ?? "",
    isActive: court.isActive,
  };
}

function CourtRow({ venueId, court, onChanged }: { venueId: string; court: DashCourt; onChanged: (message: string) => void }) {
  const [form, setForm] = useState(() => courtForm(court));
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setForm(courtForm(court)), [court]);
  const { busy, run } = useBusy();
  return (
    <li className="grid gap-3 rounded-2xl border border-fg/10 p-3">
      <CourtImage src={court.imageUrl} alt={`${court.courtName} court`} />
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Court name">
          <input className={control} value={form.courtName} disabled={busy !== null} onChange={(event) => setForm({ ...form, courtName: event.target.value })} required />
        </Field>
        <Field label="Number">
          <input className={control} type="number" min={1} value={form.courtNumber} disabled={busy !== null} onChange={(event) => setForm({ ...form, courtNumber: event.target.value })} />
        </Field>
        <Field label="Surface">
          <input className={control} value={form.surfaceType} disabled={busy !== null} onChange={(event) => setForm({ ...form, surfaceType: event.target.value })} />
        </Field>
        <Field label="Description">
          <input className={control} value={form.description} disabled={busy !== null} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </Field>
      </div>
      <Check label="Active" checked={form.isActive} disabled={busy !== null} onChange={(isActive) => setForm({ ...form, isActive })} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          loading={busy === "save"}
          disabled={busy !== null && busy !== "save"}
          onClick={() => {
            setMessage(null);
            void run("save", async () => {
              try {
                await saveCourt(venueId, {
                  courtName: form.courtName,
                  courtNumber: Number(form.courtNumber),
                  surfaceType: form.surfaceType || null,
                  description: form.description || null,
                  imageUrl: form.imageUrl || null,
                  isActive: form.isActive,
                }, court.id);
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
          variant="secondary"
          loading={busy === "ai"}
          disabled={busy !== null && busy !== "ai"}
          onClick={() => {
            setMessage(null);
            void run("ai", async () => {
              try {
                const generated = await generateCourtAiImage(venueId, court.id);
                setForm((current) => ({ ...current, imageUrl: generated.url }));
                onChanged("AI court photo generated and saved to Cloudinary (shuttle-sync/court-ai).");
              } catch (reason) {
                setMessage(reason instanceof DashError ? reason.message : "The AI court photo could not be generated.");
              }
            });
          }}
        >
          {court.imageUrl ? "Regenerate AI photo" : "Generate AI photo"}
        </Button>
        {confirming ? (
          <>
            <Button
              variant="danger"
              loading={busy === "delete"}
              disabled={busy !== null && busy !== "delete"}
              onClick={() => {
                setMessage(null);
                void run("delete", async () => {
                  try {
                    await deleteCourt(venueId, court.id);
                    onChanged("Court removed.");
                  } catch (reason) {
                    setMessage(reason instanceof DashError ? reason.message : "The court could not be deleted.");
                    setConfirming(false);
                  }
                });
              }}
            >
              Confirm delete
            </Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button variant="danger" disabled={busy !== null} onClick={() => { setMessage(null); setConfirming(true); }}>
            Delete
          </Button>
        )}
      </div>
      <label className="text-sm text-fg/80">
        <span className="inline-flex items-center gap-2">
          {court.imageUrl ? "Change photo" : "Upload photo"}
          {busy === "upload" ? <Spinner /> : null}
        </span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
          disabled={busy !== null}
          className="mt-1 block w-full text-sm text-fg disabled:opacity-60"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setMessage(null);
            void run("upload", async () => {
              try {
                const url = await uploadDashboardImage(file, "courts");
                await saveCourt(venueId, {
                  courtName: form.courtName,
                  courtNumber: Number(form.courtNumber),
                  surfaceType: form.surfaceType || null,
                  description: form.description || null,
                  imageUrl: url,
                  isActive: form.isActive,
                }, court.id);
                onChanged("Photo saved. It now shows on this court and the homepage.");
              } catch (reason) {
                setMessage(reason instanceof DashError ? reason.message : "The photo could not be saved.");
              }
            });
          }}
        />
      </label>
      <Notice message={message} />
    </li>
  );
}

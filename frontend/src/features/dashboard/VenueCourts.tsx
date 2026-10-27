import { useEffect, useRef, useState } from "react";
import { CourtImage, EmptyState, ErrorState } from "../../components/format";
import { Button, Skeleton, Spinner } from "../../components/ui";
import { Check, control, Field, Notice, Success, useBusy } from "./dashboardUi";
import {
  DashError,
  deleteCourt,
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

function CourtRow({ venueId, court, onChanged }: { venueId: string; court: DashCourt; onChanged: (message: string) => void }) {
  const [name, setName] = useState(court.courtName);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setName(court.courtName), [court.courtName]);
  const { busy, run } = useBusy();
  return (
    <li className="grid gap-3 rounded-2xl border border-fg/10 p-3">
      <CourtImage src={court.imageUrl} alt={`${court.courtName} court`} />
      <div className="flex flex-wrap items-center gap-2">
      <input className={`${control} max-w-xs`} value={name} disabled={busy !== null} onChange={(event) => setName(event.target.value)} />
      <span className="text-sm text-fg/65">#{court.courtNumber}</span>
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
                await saveCourt(venueId, { ...court, courtName: name, imageUrl: url }, court.id);
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


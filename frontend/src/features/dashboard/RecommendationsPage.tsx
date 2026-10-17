import { useEffect, useState, type FormEvent } from "react";
import { formatVenueDateTime } from "../../components/format";
import { Button, Skeleton } from "../../components/ui";
import { dashboardVenues, type Venue } from "../venues/venueApi";
import {
  DashError,
  listRecommendations,
  listVenuePlayers,
  writeRecommendation,
  type DashPlayer,
  type DashRecommendation,
} from "./dashboardApi";
import { Field, Notice, Success, Tag, control } from "./dashboardUi";
import { Shell } from "./OpsPages";

function payloadRead(payload: string | null | undefined): string {
  if (!payload?.trim()) return "—";
  try {
    const parsed = JSON.parse(payload) as { title?: unknown; text?: unknown; source?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    const body = title && text ? `${title}. ${text}` : title || text;
    if (body) return parsed.source === "fallback" ? `${body} (fallback message)` : body;
  } catch {
    // Show the stored payload when it is not the next-visit shape.
  }
  return payload;
}

function playerLabel(player: { displayName?: string | null; email?: string | null; userEmail?: string | null; reason?: string | null }): string {
  const email = player.email || player.userEmail || "";
  const name = player.displayName?.trim();
  const who = name ? `${name} · ${email}` : email;
  return player.reason ? `${who} — ${player.reason}` : who;
}

export function RecommendationsPage() {
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [venueId, setVenueId] = useState("");
  const [players, setPlayers] = useState<DashPlayer[] | null>(null);
  const [userId, setUserId] = useState("");
  const [points, setPoints] = useState("500");
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    dashboardVenues()
      .then((next) => {
        if (!active) return;
        setVenues(next);
        setVenueId((current) => current || next[0]?.id || "");
      })
      .catch(() => {
        if (active) setVenues([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!venueId) {
      setPlayers([]);
      setUserId("");
      return;
    }
    let active = true;
    setPlayers(null);
    setUserId("");
    listVenuePlayers(venueId)
      .then((next) => {
        if (!active) return;
        setPlayers(next);
        setUserId(next[0]?.id ?? "");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setPlayers([]);
        setError(reason instanceof DashError ? reason.message : "Players could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [venueId]);

  const playersLoading = venueId !== "" && players === null;
  const venue = venues?.find((item) => item.id === venueId);
  const rate = venue && venue.pointsPerDollar > 0 ? venue.pointsPerDollar : 100;
  const maxPoints = rate * 10;
  const pointValue = Number(points);
  const dollar = Number.isFinite(pointValue) ? pointValue / rate : 0;

  async function onWrite(event: FormEvent) {
    event.preventDefault();
    if (!venueId || !userId || writing) return;
    setWriting(true);
    setNote(null);
    setError(null);
    try {
      const written = await writeRecommendation(venueId, userId, pointValue);
      const who = playerLabel(written);
      setNote(written.created
        ? `Wrote a note for ${who}. ${pointValue} points stay pending until their next completed visit.`
        : `${who} already has a note for this venue today. No extra points were added.`);
      setTick((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof DashError ? reason.message : "The recommendation could not be saved.");
    } finally {
      setWriting(false);
    }
  }

  return (
    <Shell
      title="Recommendations"
      refreshKey={`recommendations:${tick}`}
      load={(page) => listRecommendations(page)}
      rowKey={(row: DashRecommendation) => row.id}
      extra={
        <div className="mt-4 grid gap-3">
          <p className="max-w-2xl text-sm text-mist/75">Write one note for a player who should come back. The same points apply to anyone on this list, up to $10. The same player, venue, and day keeps a single row.</p>
          <Success message={note} />
          <Notice message={error} />
          {venues === null ? (
            <div aria-busy="true">
              <span className="sr-only">Loading venues</span>
              <Skeleton className="h-24" />
            </div>
          ) : venues.length === 0 ? (
            <Notice message="No venue is available for your account." />
          ) : (
            <form className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_10rem_auto] lg:items-end" onSubmit={(event) => { void onWrite(event); }}>
              <Field label="Venue">
                <select className={control} value={venueId} disabled={writing} onChange={(event) => setVenueId(event.target.value)}>
                  {venues.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </Field>
              <Field label="Player">
                <select className={control} value={userId} disabled={writing || playersLoading || (players?.length ?? 0) === 0} onChange={(event) => setUserId(event.target.value)} aria-busy={playersLoading}>
                  {playersLoading ? <option value="">Loading players</option> : null}
                  {!playersLoading && (players?.length ?? 0) === 0 ? <option value="">No players to invite back</option> : null}
                  {players?.map((player) => <option key={player.id} value={player.id}>{playerLabel(player)}</option>)}
                </select>
              </Field>
              <Field label="Points">
                <input className={control} type="number" min={1} max={maxPoints} step={1} value={points} disabled={writing} onChange={(event) => setPoints(event.target.value)} required />
                <span className="mt-1 block text-xs text-mist/60">{Number.isFinite(dollar) ? `$${dollar.toFixed(2)} · max $10` : "Enter a point amount"}</span>
              </Field>
              <Button type="submit" loading={writing} disabled={!venueId || !userId || playersLoading || !Number.isInteger(pointValue) || pointValue < 1 || pointValue > maxPoints}>Write recommendation</Button>
            </form>
          )}
        </div>
      }
      columns={[
        { label: "Type", className: "whitespace-nowrap", cell: (row) => <Tag value={row.recommendationType} /> },
        {
          label: "Player",
          cell: (row) => (
            <div className="min-w-0">
              <p className="text-white">{row.displayName?.trim() || row.userEmail}</p>
              {row.displayName?.trim() ? <p className="text-xs text-mist/55">{row.userEmail}</p> : null}
            </div>
          ),
        },
        { label: "Venue", className: "whitespace-nowrap", cell: (row) => row.venueName?.trim() ? <span className="text-white">{row.venueName}</span> : <span className="text-mist/50">Any venue</span> },
        { label: "Time", className: "whitespace-nowrap", cell: (row) => formatVenueDateTime(row.createdAt, row.timeZone || "UTC") },
        { label: "Payload", cell: (row) => <span className="text-mist">{payloadRead(row.payload)}</span> },
      ]}
    />
  );
}

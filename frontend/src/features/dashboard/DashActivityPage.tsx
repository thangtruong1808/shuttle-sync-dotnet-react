import { useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../../app/store";
import { formatVenueDateTime } from "../../components/format";
import { Button, PickerInput, Spinner } from "../../components/ui";
import { listActivity, type DashActivity } from "./dashboardApi";
import { control, Success, Tag } from "./dashboardUi";
import { Shell } from "./OpsShell";

function activityPage(detail: string | null): string {
  if (!detail) return "—";
  try {
    const parsed = JSON.parse(detail) as { title?: string; path?: string };
    return parsed.title || parsed.path || detail;
  } catch {
    return detail;
  }
}

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function activitySection(path: string | null | undefined): string {
  const part = (path ?? "").replace(/^\/dashboard\/?/, "").split(/[/?#]/)[0];
  if (!part) return "Overview";
  return part.replace(/-/g, " ");
}

function activityPath(row: DashActivity): string | null {
  if (row.path) return row.path;
  try {
    return (JSON.parse(row.detail ?? "") as { path?: string }).path ?? null;
  } catch {
    return null;
  }
}

function timeOnPage(start: string, next: string | null | undefined): string {
  if (next === undefined) return "—";
  if (!next) return "Last page viewed";
  const seconds = Math.round((new Date(next).getTime() - new Date(start).getTime()) / 1000);
  if (seconds < 0) return "—";
  if (seconds > 30 * 60) return "Over 30 min";
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} sec`;
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function ActivityPage() {
  const admin = useSelector((state: RootState) => state.auth.user?.role) === "admin";
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ userId: "", from: "", to: "" });
  const [tick, setTick] = useState(0);
  const [filtering, setFiltering] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <Shell
      title="Activity"
      refreshKey={`${applied.userId}:${applied.from}:${applied.to}:${tick}`}
      load={(page, pageSize) => listActivity(applied.userId, applied.from, applied.to, page, pageSize)}
      locked={filtering}
      onSettled={() => setFiltering(false)}
      rowKey={(row: DashActivity) => row.id}
      extra={
        <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); setFiltering(true); setApplied({ userId: admin ? userId.trim() : "", from, to }); setTick((value) => value + 1); setNote("Filters applied."); }}>
          {admin ? <input className={`${control} sm:max-w-xs`} placeholder="Staff user id" aria-label="Staff user id" value={userId} disabled={filtering} onChange={(event) => setUserId(event.target.value)} /> : null}
          <PickerInput className={`${control} sm:w-auto`} type="date" value={from} disabled={filtering} onChange={(event) => setFrom(event.target.value)} aria-label="From" />
          <PickerInput className={`${control} sm:w-auto`} type="date" value={to} disabled={filtering} onChange={(event) => setTo(event.target.value)} aria-label="To" />
          <Button type="submit" variant="secondary" className="w-full sm:w-auto" loading={filtering}>Filter</Button>
          <Success message={note} />
        </form>
      }
      columns={[
        {
          label: "Staff",
          cell: (row) => (
            <div className="min-w-0">
              <p className="break-all font-medium text-fg">{row.displayName || row.userEmail || "Staff"}</p>
              {row.displayName && row.userEmail ? <p className="break-all text-xs text-fg/60">{row.userEmail}</p> : null}
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {row.role ? <Tag value={row.role} /> : null}
                {admin && row.userId && (applied.userId !== row.userId || filtering) ? (
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-medium text-accent-text hover:bg-fg/5 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={filtering}
                    onClick={() => { setFiltering(true); setUserId(row.userId!); setApplied({ userId: row.userId!, from, to }); setTick((value) => value + 1); setNote(`Showing ${row.displayName || row.userEmail || "this staff member"} only.`); }}
                  >
                    {filtering && applied.userId === row.userId ? <Spinner className="h-3 w-3" /> : null}
                    Only this staff
                  </button>
                ) : null}
              </div>
            </div>
          ),
        },
        {
          label: "Page",
          cell: (row) => (
            <div className="min-w-0">
              <p className="break-words text-fg">{row.title || activityPage(row.detail)}</p>
              {activityPath(row) ? <p className="break-all font-mono text-xs text-fg/55">{activityPath(row)}</p> : null}
            </div>
          ),
        },
        { label: "Section", className: "whitespace-nowrap", cell: (row) => <Tag value={activitySection(activityPath(row))} /> },
        { label: "Venue", className: "whitespace-nowrap", cell: (row) => row.venueName?.trim() ? <span className="text-fg">{row.venueName}</span> : <span className="text-fg/50">N/A</span> },
        { label: "Time on page", className: "whitespace-nowrap", cell: (row) => timeOnPage(row.createdAt, row.nextViewAt) },
        { label: "IP address", className: "whitespace-nowrap", cell: (row) => <span className="font-mono text-xs">{row.ipAddress || "—"}</span> },
        {
          label: "When",
          className: "whitespace-nowrap",
          cell: (row) => (
            <div>
              <p>{formatVenueDateTime(row.createdAt, localZone)}</p>
              <p className="text-xs text-fg/55">{timeAgo(row.createdAt)}</p>
            </div>
          ),
        },
      ]}
    />
  );
}


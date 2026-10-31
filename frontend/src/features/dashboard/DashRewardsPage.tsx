import { useState } from "react";
import { formatVenueDateTime, formatVenueDay, formatVenueRange, Money } from "../../components/format";
import { Button } from "../../components/ui";
import { listAwards, listRedemptions, type DashAward, type DashRedemption } from "./dashboardApi";
import { control, Success } from "./dashboardUi";
import { Shell, useVenueOptions } from "./OpsShell";

function AwardPoints({ row }: { row: DashAward }) {
  const courts = row.courtCount ?? 1;
  const cancelled = row.cancelledCourts ?? 0;
  return (
    <span className="block min-w-[8rem] max-w-[14rem]">
      <span className="whitespace-nowrap font-semibold text-fg">+{row.points} pts</span>
      {courts > 1 ? <span className="mt-0.5 block whitespace-nowrap text-xs text-fg/60">Total for {courts} courts</span> : null}
      {cancelled > 0 ? (
        <span className="mt-0.5 block text-xs leading-5 text-amber-700 dark:text-amber-300">
          {cancelled} {cancelled === 1 ? "court" : "courts"} cancelled, no points
          {row.cancelledCourtNames ? `: ${row.cancelledCourtNames}` : ""}
        </span>
      ) : null}
    </span>
  );
}

export function RewardsPage() {
  const [tab, setTab] = useState<"awards" | "redemptions">("awards");
  const venues = useVenueOptions();
  const [venueId, setVenueId] = useState("");
  const [applied, setApplied] = useState("");
  const [tick, setTick] = useState(0);
  const [filtering, setFiltering] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div>
      <div className="flex gap-2">
        <Button variant={tab === "awards" ? "primary" : "secondary"} disabled={filtering} onClick={() => setTab("awards")}>Awards</Button>
        <Button variant={tab === "redemptions" ? "primary" : "secondary"} disabled={filtering} onClick={() => setTab("redemptions")}>Redemptions</Button>
      </div>
      <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); setFiltering(true); setApplied(venueId); setTick((value) => value + 1); setNote("Filters applied."); }}>
        <select className={`${control} max-w-xs`} value={venueId} disabled={filtering} onChange={(event) => setVenueId(event.target.value)}>
          <option value="">All venues</option>
          {venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
        </select>
        <Button type="submit" variant="secondary" loading={filtering}>Filter</Button>
        <Success message={note} />
      </form>
      {tab === "awards" ? (
        <Shell
          key="awards"
          title="Reward awards"
          refreshKey={`${applied}:${tick}`}
          load={(page, pageSize) => listAwards(applied, page, pageSize)}
          locked={filtering}
          onSettled={() => setFiltering(false)}
          rowKey={(row: DashAward) => row.id}
          columns={[
            { label: "Player", cell: (row) => <span className="text-fg">{row.userEmail}</span> },
            { label: "Venue", cell: (row) => row.venueName },
            {
              label: "Source",
              cell: (row) => (
                <span className="block min-w-[8rem] max-w-[14rem]">
                  {row.source || "Court booking"}
                  {row.courtNames ? <span className="mt-0.5 block text-xs leading-5 text-fg/60">{row.courtNames}</span> : null}
                </span>
              ),
            },
            { label: "Points", cell: (row) => <AwardPoints row={row} /> },
            { label: "Session", cell: (row) => <span className="whitespace-nowrap">{formatVenueDay(row.startTime, row.timeZone)}<span className="mt-0.5 block text-fg/70">{formatVenueRange(row.startTime, row.endTime, row.timeZone)}</span></span> },
            { label: "Awarded", className: "whitespace-nowrap", cell: (row) => formatVenueDateTime(row.awardedAt, row.timeZone) },
          ]}
        />
      ) : (
        <Shell
          key="redemptions"
          title="Redemptions"
          refreshKey={`${applied}:${tick}`}
          load={(page, pageSize) => listRedemptions(applied, page, pageSize)}
          locked={filtering}
          onSettled={() => setFiltering(false)}
          rowKey={(row: DashRedemption) => row.id}
          columns={[
            { label: "Code", cell: (row) => <span className="text-fg">{row.code}</span> },
            { label: "Player", cell: (row) => row.userEmail },
            { label: "Venue", cell: (row) => row.venueName },
            { label: "Discount", className: "whitespace-nowrap", cell: (row) => <Money amount={row.discountAmount} currency="AUD" /> },
            { label: "When", className: "whitespace-nowrap", cell: (row) => formatVenueDateTime(row.createdAt, "UTC") },
          ]}
        />
      )}
    </div>
  );
}

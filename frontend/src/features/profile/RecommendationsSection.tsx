import { useEffect, useState } from "react";
import { EmptyState, ErrorState, formatVenueDateTime } from "../../components/format";
import { Skeleton } from "../../components/ui";
import { Tag } from "../dashboard/dashboardUi";
import { ListPager } from "./ProfileLists";
import { myRecommendations, type Page, type RecommendationRow } from "./profileApi";

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

function typeLabel(value: string): string {
  return value.replace(/_/g, " ");
}

export function RecommendationsSection() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [data, setData] = useState<Page<RecommendationRow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pageMove, setPageMove] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    myRecommendations(page, pageSize)
      .then((next) => {
        if (active) {
          setData(next);
          setError(null);
        }
      })
      .catch(() => {
        if (active) setError("Recommendations could not be loaded.");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setPageMove(null);
        }
      });
    return () => {
      active = false;
    };
  }, [page, pageSize, attempt]);

  return (
    <div>
      <h1 className="font-display text-3xl text-white">Recommendations</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mist/75">Notes written for you. This list is only yours.</p>
      {error ? (
        <div className="mt-4"><ErrorState message={error} loading={loading} onRetry={() => { setLoading(true); setAttempt((value) => value + 1); }} /></div>
      ) : loading && pageMove === null ? (
        <div className="mt-4 space-y-3" aria-busy="true">
          <span className="sr-only">Loading recommendations</span>
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : data && data.items.length > 0 ? (
        <>
          <ul className="mt-4 grid gap-3">
            {data.items.map((row) => (
              <li key={row.id} className="rounded-2xl border border-white/10 bg-pine/80 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag value={typeLabel(row.recommendationType)} />
                  <span className="text-sm text-white">{row.venueName?.trim() || "Any venue"}</span>
                </div>
                <p className="mt-2 text-sm text-mist">{payloadRead(row.payload)}</p>
                <p className="mt-2 text-xs text-mist/55">{formatVenueDateTime(row.createdAt, row.timeZone || "UTC")}</p>
              </li>
            ))}
          </ul>
          <ListPager
            page={page}
            pageSize={data.pageSize || pageSize}
            total={data.total}
            loading={loading}
            pageMove={pageMove}
            onPage={(next, move) => { setLoading(true); setPageMove(move); setPage(next); }}
            onPageSize={(size) => { setLoading(true); setPageMove(`size-${size}`); setPageSize(size); setPage(1); }}
          />
        </>
      ) : (
        <div className="mt-4"><EmptyState title="No recommendations yet" body="When a venue writes a recommendation for you, it shows up here." /></div>
      )}
    </div>
  );
}

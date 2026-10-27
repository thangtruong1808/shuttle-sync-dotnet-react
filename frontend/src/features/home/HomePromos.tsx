import { useState } from "react";
import { Tag } from "lucide-react";
import { Money, formatVenueDateTime } from "../../components/format";
import { Skeleton } from "../../components/ui";
import type { Promotion } from "../venues/venueApi";

export function HomePromos({
  promotions,
  loading,
  currency,
  timeZone,
}: {
  promotions: Promotion[] | null;
  loading: boolean;
  currency: string;
  timeZone: string;
}) {
  return (
    <section id="promotions" className="mt-8" aria-labelledby="promotions-heading">
      <h2 id="promotions-heading" className="flex items-center gap-2 font-display text-lg text-fg">
        <Tag className="h-4 w-4 text-accent-text" aria-hidden="true" />
        Promotions
      </h2>
      {loading && promotions === null ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-busy="true">
          <span className="sr-only">Loading promotions</span>
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : promotions && promotions.length > 0 ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {promotions.map((promotion) => (
            <li key={promotion.id} className="flex items-center justify-between gap-3 rounded-2xl border border-accent-text/25 bg-surface px-4 py-3 shadow-card dark:shadow-none">
              <div className="min-w-0">
                <p className="break-all font-semibold tracking-wide text-fg">{promotion.code}</p>
                <p className="text-sm text-accent-text">
                  {promotion.discountType === "percent" ? `${promotion.discountValue}% off` : <Money amount={promotion.discountValue} currency={currency} />}
                  {promotion.venueId ? "" : " · all venues"}
                </p>
                {promotion.validFrom && promotion.validTo ? (
                  <p className="mt-1 text-xs leading-5 text-fg-muted">
                    Valid from {formatVenueDateTime(promotion.validFrom, timeZone)} to {formatVenueDateTime(promotion.validTo, timeZone)}.
                  </p>
                ) : null}
              </div>
              <CopyCode code={promotion.code} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-fg-muted">No active promotion codes right now.</p>
      )}
    </section>
  );
}

function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-semibold text-fg hover:bg-surface-2"
      onClick={() => {
        void navigator.clipboard.writeText(code).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy code"}
    </button>
  );
}
